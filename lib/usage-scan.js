/**
 * Disk scanner for DSH session logs: locates every stored session artifact
 * under the sessions root, decodes it (zstd multi-frame or plain JSONL), and
 * folds its events into per-request usage entries.
 *
 * Folded data is mirrored into a persistent store at
 * $DSH_HOME/model-usage-archive.json: records for files still on disk act as
 * an mtime cache that survives restarts, and records for files that vanished
 * from disk become the archive — so deleting session logs never deletes
 * their statistics. Version rotation inside one session directory (a newer
 * session.vN.jsonl replacing session.jsonl) is detected and never archived.
 *
 * Storage layout (dsh-session-persistence-jsonl):
 *   <root>/<projectKey>/<encodedSessionId>/session[.vN].jsonl[.zstd]
 * The artifact is a concatenation of independent Zstandard frames (or plain
 * text); the first line is the session header, every following line one event.
 *
 * @module dsh-model-request-counter/usage-scan
 */
import { readdir, readFile, stat, writeFile, mkdir, rename } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { zstdDecompressSync } from "node:zlib";
import { dshHome } from "./pricing.js";

const ZSTD_MAGIC = 4247762216;

/**
 * Locate complete Zstandard frames without decompressing their blocks.
 * Mirrors the persistence layer's scanner: invalid structure throws, an
 * EOF inside the final frame returns it as a torn tail to be dropped.
 * @param buffer - complete bytes currently present in the artifact.
 * @returns complete frame ranges [start, end] and an optional torn-tail start.
 */
function scanZstdFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (offset < buffer.length) {
    const start = offset;
    const torn = () => ({ frames, tornStart: start });
    if (buffer.length - offset < 4) return torn();
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) {
      throw new Error(`corrupt Zstandard session log: invalid frame magic at byte ${offset}`);
    }
    offset += 4;
    if (offset === buffer.length) return torn();
    const descriptor = buffer.readUInt8(offset);
    offset += 1;
    if ((descriptor & 24) !== 0) {
      throw new Error(`corrupt Zstandard session log: reserved frame-header bit at byte ${offset - 1}`);
    }
    const contentSizeFlag = descriptor >>> 6;
    const singleSegment = (descriptor & 32) !== 0;
    const checksum = (descriptor & 4) !== 0;
    const dictionaryFlag = descriptor & 3;
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag;
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag;
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes;
    if (buffer.length - offset < remainingHeaderBytes) return torn();
    offset += remainingHeaderBytes;
    for (;;) {
      if (buffer.length - offset < 3) return torn();
      const blockHeader = buffer.readUIntLE(offset, 3);
      offset += 3;
      const lastBlock = (blockHeader & 1) !== 0;
      const blockType = (blockHeader >>> 1) & 3;
      const blockSize = blockHeader >>> 3;
      if (blockType === 3) {
        throw new Error(`corrupt Zstandard session log: reserved block type at byte ${offset - 3}`);
      }
      const payloadBytes = blockType === 1 ? 1 : blockSize;
      if (buffer.length - offset < payloadBytes) return torn();
      offset += payloadBytes;
      if (lastBlock) break;
    }
    if (checksum) {
      if (buffer.length - offset < 4) return torn();
      offset += 4;
    }
    frames.push([start, offset]);
  }
  return { frames };
}

/**
 * Decode one session artifact into its header line and event lines.
 * @param buffer - raw file bytes.
 * @param zstd - whether the artifact uses Zstandard frames.
 * @returns the parsed header object and the parsed event objects in log order.
 */
function decodeSessionLog(buffer, zstd) {
  let text;
  if (zstd) {
    const { frames } = scanZstdFrames(buffer);
    text = "";
    for (const [start, end] of frames) {
      text += zstdDecompressSync(buffer.subarray(start, end)).toString("utf8");
    }
  } else {
    text = buffer.toString("utf8");
  }
  const lines = text.split("\n");
  const header = JSON.parse(lines[0]);
  const events = [];
  for (let index = 1; index < lines.length; index++) {
    const line = lines[index];
    if (line === "") continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      // Torn or corrupt tail line — skip it rather than fail the whole scan.
    }
  }
  return { header, events };
}

/**
 * Resolve the first model-output token time from one compact Assistant stream.
 * @param stream - compact stream records embedded in an assistant event.
 * @returns the first token timestamp, or undefined when nothing streamed.
 */
function firstTokenTime(stream) {
  if (!Array.isArray(stream)) return undefined;
  for (const record of stream) {
    if (record.type === "text-chunks" || record.type === "reasoning-chunks") {
      let time = record.time0;
      for (let index = 0; index < record.texts.length; index++) {
        if (record.texts[index] !== "") return time;
        if (index + 1 < record.texts.length) time += record.dt[index] ?? 0;
      }
    } else if (record.type === "tool-call-chunks") {
      let time = record.time0;
      for (let index = 0; index < record.args.length; index++) {
        if (record.args[index] !== "" || (index === 0 && record.name !== undefined)) return time;
        if (index + 1 < record.args.length) time += record.dt[index] ?? 0;
      }
    } else if (record.type === "chunk") {
      const chunk = record.chunk;
      if ((chunk.type === "text-delta" || chunk.type === "reasoning-delta") && chunk.text !== "") {
        return record.time;
      }
      if (chunk.type === "tool-call-delta" && (chunk.argumentsDelta !== "" || chunk.name !== undefined)) {
        return record.time;
      }
    }
  }
  return undefined;
}

/**
 * Extract the terminal failure of one failed Assistant attempt.
 * @param stream - compact stream records embedded in an assistant/attempt event.
 * @returns the failure's code, HTTP status, and message, or null.
 */
function finishFailure(stream) {
  if (!Array.isArray(stream)) return null;
  for (let index = stream.length - 1; index >= 0; index--) {
    const record = stream[index];
    if (record.type !== "chunk") continue;
    const chunk = record.chunk;
    if (chunk.type !== "finish") continue;
    const reason = chunk.reason;
    if (reason !== null && typeof reason === "object"
      && (reason.kind === "error" || reason.kind === "aborted")
      && reason.failure !== null && typeof reason.failure === "object") {
      return {
        code: typeof reason.failure.code === "string" ? reason.failure.code : null,
        status: typeof reason.failure.status === "number" ? reason.failure.status : null,
        message: typeof reason.failure.message === "string" ? reason.failure.message : "",
      };
    }
    return null;
  }
  return null;
}

/** Coerce an optional usage field to a non-negative number. */
function num(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Fold one session's events into per-request usage entries.
 *
 * Every `assistant/message` (a settled model response, including interrupted
 * and max-tokens ones) and every `assistant/attempt` (a failed HTTP dispatch)
 * contributes exactly one entry — one entry per provider request, retries
 * included. In a seeded (forked) session the inherited prefix duplicates the
 * parent's log, so events up to and including the last `session/end-seed`
 * marker are skipped to avoid double counting.
 *
 * @param header - the session's stored header line.
 * @param events - the session's parsed events in seq order.
 * @returns the usage entries in log order.
 */
function foldSessionEvents(header, events) {
  const entries = [];
  let provider = null;
  let model = null;
  let openStep = null;
  let lastEndSeed = null;
  for (let index = 0; index < events.length; index++) {
    const event = events[index];
    const seq = typeof event.seq === "number" ? event.seq : index;
    switch (event.type) {
      case "session/end-seed":
        lastEndSeed = seq;
        break;
      case "request/header": {
        const config = event.data?.header?.config;
        if (config !== null && typeof config === "object") {
          if (typeof config.provider === "string" && config.provider !== "") provider = config.provider;
          if (typeof config.model === "string" && config.model !== "") model = config.model;
        }
        break;
      }
      case "step/start":
        openStep = { turn: event.data.turn, step: event.data.step, startTime: event.time };
        break;
      case "step/end":
        openStep = null;
        break;
      case "assistant/message":
      case "assistant/attempt": {
        if (header.isSeeded === true && lastEndSeed !== null && seq <= lastEndSeed) break;
        const data = event.data ?? {};
        const step = openStep !== null && openStep.turn === data.turn && openStep.step === data.step
          ? openStep
          : null;
        const usage = event.type === "assistant/message" ? data.usage : undefined;
        const source = data.message?.source;
        const entry = {
          time: event.time,
          provider: typeof source?.provider === "string" && source.provider !== ""
            ? source.provider
            : provider ?? "(unknown)",
          model: typeof source?.model === "string" && source.model !== ""
            ? source.model
            : model ?? "(unknown)",
          inputTokens: num(usage?.inputTokens),
          outputTokens: num(usage?.outputTokens),
          cacheReadTokens: num(usage?.cacheReadTokens),
          cacheWriteTokens: num(usage?.cacheWriteTokens),
          durationMs: step !== null ? Math.max(0, event.time - step.startTime) : 0,
          firstTokenMs: 0,
          ok: event.type === "assistant/message",
          code: null,
          status: null,
        };
        if (step !== null) {
          const first = firstTokenTime(data.stream);
          if (first !== undefined) entry.firstTokenMs = Math.max(0, first - step.startTime);
        }
        if (event.type === "assistant/attempt") {
          const failure = finishFailure(data.stream);
          entry.code = failure?.code ?? "ERROR";
          entry.status = failure?.status ?? null;
        }
        entries.push(entry);
        break;
      }
      default:
        break;
    }
  }
  return entries;
}

/** One session-directory log candidate: its path and format-version rank. */
function logCandidate(name) {
  const match = /^session(?:\.v(\d+))?\.jsonl(\.zstd)?$/.exec(name);
  if (match === null) return undefined;
  return { zstd: match[2] !== undefined, version: match[1] === undefined ? 0 : Number(match[1]) };
}

// ── persistent usage store ──────────────────────────────────────────────────
//
// The store mirrors every folded session, live and vanished, keyed by the log
// path relative to the sessions root (forward slashes, so a $DSH_HOME move
// keeps the keys stable). Records for files still on disk are a persistent
// mtime cache; records for files gone from disk are the archive.

/** Store document version; a mismatching document is discarded. */
const STORE_VERSION = 1;

/** The one-time store load (guards against concurrent first scans). */
let storeLoad = null;

/**
 * The loaded store: Map of relative log path → record.
 * @type {Map<string, {mtimeMs: number, size: number, entries: object[], archived: boolean}> | null}
 */
let store = null;

/** Serialized store writes so overlapping scans cannot interleave files. */
let storeWrite = Promise.resolve();

/** One-shot flags consumed by the next scan (set by clearScanCache). */
let rescanRequested = false;
let purgeArchiveRequested = false;

/** The store document path. */
function storePath() {
  return join(dshHome(), "model-usage-archive.json");
}

/** Load the persisted store once; a corrupt document starts fresh. */
function ensureStore() {
  storeLoad ??= (async () => {
    store = new Map();
    try {
      const parsed = JSON.parse(await readFile(storePath(), "utf8"));
      if (parsed === null || typeof parsed !== "object" || parsed.version !== STORE_VERSION) return;
      const files = parsed.files;
      if (files === null || typeof files !== "object" || Array.isArray(files)) return;
      for (const [key, record] of Object.entries(files)) {
        if (record === null || typeof record !== "object" || !Array.isArray(record.entries)) continue;
        if (typeof record.mtimeMs !== "number" || typeof record.size !== "number") continue;
        store.set(key, {
          mtimeMs: record.mtimeMs,
          size: record.size,
          entries: record.entries,
          archived: record.archived === true,
        });
      }
    } catch {
      // Absent or unreadable document — start fresh; live files re-scan from disk.
    }
  })();
  return storeLoad;
}

/** Persist the store atomically (temp file + rename); write errors are ignored. */
function saveStore() {
  const files = {};
  for (const [key, record] of store) {
    files[key] = {
      mtimeMs: record.mtimeMs, size: record.size,
      entries: record.entries, archived: record.archived,
    };
  }
  const body = JSON.stringify({ version: STORE_VERSION, files });
  const path = storePath();
  storeWrite = storeWrite.then(async () => {
    try {
      await mkdir(dshHome(), { recursive: true });
      const tmp = path + ".tmp";
      await writeFile(tmp, body, "utf8");
      await rename(tmp, path);
    } catch {
      // Unwritable store — the in-memory state still serves this process.
    }
  });
  return storeWrite;
}

/**
 * Drop the cached folds of every file still on disk (the 重新扫描 action), or
 * with purgeArchive, delete every record whose file is not on disk (the
 * 清除归档 action). The flag is consumed by the next scanSessions call.
 * @param opts - pass { purgeArchive: true } to remove archived data.
 */
export function clearScanCache(opts) {
  if (opts !== null && typeof opts === "object" && opts.purgeArchive) {
    purgeArchiveRequested = true;
  } else {
    rescanRequested = true;
  }
}

/**
 * Scan every stored session under the root and fold all usage entries.
 *
 * Live files are folded from disk (mtime-cached across restarts via the
 * persistent store). Files that vanished keep their folded entries as the
 * archive, so deleting session logs never deletes their statistics. A record
 * whose session directory still holds a newer artifact is superseded by
 * version rotation and dropped, never archived.
 *
 * @param root - the sessions root directory ($DSH_HOME/sessions).
 * @returns all entries across all sessions (live + archived) plus scan counts.
 */
export async function scanSessions(root) {
  await ensureStore();
  const forceRescan = rescanRequested;
  const purgeArchive = purgeArchiveRequested;
  rescanRequested = false;
  purgeArchiveRequested = false;

  // Enumerate the current best log candidate per session directory.
  const current = new Map(); // relKey → { path, zstd, version }
  const currentDirs = new Set(); // relKey prefixes of session dirs with a candidate
  const projects = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const project of projects) {
    if (!project.isDirectory()) continue;
    const projectPath = join(root, project.name);
    const sessionDirs = await readdir(projectPath, { withFileTypes: true }).catch(() => []);
    for (const sessionDir of sessionDirs) {
      if (!sessionDir.isDirectory()) continue;
      const sessionPath = join(projectPath, sessionDir.name);
      const files = await readdir(sessionPath, { withFileTypes: true }).catch(() => []);
      let best;
      for (const file of files) {
        if (!file.isFile()) continue;
        const candidate = logCandidate(file.name);
        if (candidate === undefined) continue;
        if (best === undefined || candidate.version > best.version) {
          best = { ...candidate, path: join(sessionPath, file.name) };
        }
      }
      if (best === undefined) continue;
      const rel = relative(root, best.path).split(sep).join("/");
      currentDirs.add(rel.slice(0, rel.lastIndexOf("/")));
      current.set(rel, best);
    }
  }

  let dirty = false;

  // Purge: remove every record whose file is not on disk right now.
  if (purgeArchive) {
    for (const key of store.keys()) {
      if (current.has(key)) continue;
      store.delete(key);
      dirty = true;
    }
  }

  // Refresh: fold every new, changed, or forced live file from disk.
  for (const [rel, best] of current) {
    const record = store.get(rel);
    let stats = null;
    try {
      stats = await stat(best.path);
    } catch {
      // Vanished between readdir and stat — the marking pass below archives it.
    }
    if (stats === null) continue;
    const cacheHit = !forceRescan && record !== undefined
      && record.mtimeMs === stats.mtimeMs && record.size === stats.size;
    if (cacheHit) {
      if (record.archived) {
        // The file came back with its old mtime (restored) — un-archive it.
        record.archived = false;
        dirty = true;
      }
      continue;
    }
    try {
      const buffer = await readFile(best.path);
      const { header, events } = decodeSessionLog(buffer, best.zstd);
      const folded = foldSessionEvents(header, events);
      store.set(rel, { mtimeMs: stats.mtimeMs, size: stats.size, entries: folded, archived: false });
      dirty = true;
    } catch {
      // Unreadable or corrupt artifact — keep the last good record so a
      // transient lock or torn write cannot lose the session's statistics.
    }
  }

  // Mark or drop: records whose file is gone from the enumeration.
  for (const [key, record] of store) {
    if (current.has(key)) continue;
    const dir = key.slice(0, key.lastIndexOf("/"));
    if (currentDirs.has(dir)) {
      // Version rotation: the session lives on in a newer artifact — the old
      // record is superseded (archiving it would double count the session).
      store.delete(key);
      dirty = true;
    } else if (!record.archived) {
      record.archived = true;
      dirty = true;
    }
  }

  // Collect: every record contributes its entries, live or archived.
  const entries = [];
  let sessionCount = 0;
  let archivedSessions = 0;
  for (const record of store.values()) {
    sessionCount++;
    if (record.archived) archivedSessions++;
    for (const entry of record.entries) entries.push(entry);
  }

  if (dirty) await saveStore();
  return { entries, fileCount: current.size, sessionCount, archivedSessions };
}