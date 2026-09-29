/**
 * Behavior tests for the persistent usage archive in lib/usage-scan.js:
 * deleting a session log from disk must keep its statistics (the archive),
 * version rotation must not double count, and purge must remove the archive.
 *
 * Run: node test/usage-scan.test.mjs
 *
 * @module dsh-model-request-counter/test/usage-scan
 */
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

// A private DSH_HOME so the test never touches real usage data.
const home = await mkdtemp(join(tmpdir(), "mrc-test-"));
process.env.DSH_HOME = home;
const sessionsRoot = join(home, "sessions");

// Cache-busting query: each load gets a fresh module instance, which is how
// we simulate a host restart (the store must survive it).
const loadModule = (tag) => import(`../lib/usage-scan.js?test=${tag}`);

const T = 1730000000000;

/** Serialize one session log (header + events) as plain JSONL text. */
function sessionLog(events) {
  return JSON.stringify({ isSeeded: false, id: "s" }) + "\n"
    + events.map((e) => JSON.stringify(e)).join("\n") + "\n";
}

/** One successful assistant/message event. */
const messageEvent = (seq, time, inputTokens = 100) => ({
  type: "assistant/message", seq, time,
  data: {
    turn: 1, step: 1,
    usage: { inputTokens, outputTokens: 50, cacheReadTokens: 10, cacheWriteTokens: 5 },
    message: { source: { provider: "p1", model: "m1" } },
    stream: [],
  },
});

/** One failed assistant/attempt event (ECONNRESET / 502). */
const attemptEvent = (seq, time) => ({
  type: "assistant/attempt", seq, time,
  data: {
    turn: 1, step: 1,
    stream: [{
      type: "chunk", time: time + 100,
      chunk: { type: "finish", reason: { kind: "error", failure: { code: "ECONNRESET", status: 502, message: "boom" } } },
    }],
  },
});

const sessionDir = join(sessionsRoot, "proj", "sess-a");
await mkdir(sessionDir, { recursive: true });
const logPath = join(sessionDir, "session.jsonl");

let failures = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`ok   - ${name}`);
  } catch (error) {
    failures++;
    console.error(`FAIL - ${name}\n      ${error.message}`);
  }
}

// ── 1. live scan ─────────────────────────────────────────────────────────────
let mod = await loadModule(1);
await writeFile(logPath, sessionLog([messageEvent(1, T), attemptEvent(2, T + 5000)]));
await check("live scan folds one entry per request", async () => {
  const r = await mod.scanSessions(sessionsRoot);
  assert.equal(r.fileCount, 1);
  assert.equal(r.sessionCount, 1);
  assert.equal(r.archivedSessions, 0);
  assert.equal(r.entries.length, 2);
  assert.equal(r.entries.filter((e) => e.ok).length, 1);
  const failed = r.entries.find((e) => !e.ok);
  assert.equal(failed.code, "ECONNRESET");
  assert.equal(failed.status, 502);
});

// ── 2. delete from disk → archive ────────────────────────────────────────────
await rm(logPath);
await check("deleted session keeps its statistics (archive)", async () => {
  const r = await mod.scanSessions(sessionsRoot);
  assert.equal(r.fileCount, 0);
  assert.equal(r.sessionCount, 1);
  assert.equal(r.archivedSessions, 1);
  assert.equal(r.entries.length, 2);
});

// ── 3. rescan keeps the archive ──────────────────────────────────────────────
await check("rescan re-reads disk but keeps the archive", async () => {
  mod.clearScanCache();
  const r = await mod.scanSessions(sessionsRoot);
  assert.equal(r.entries.length, 2);
  assert.equal(r.archivedSessions, 1);
});

// ── 4. restart keeps the archive (persistent store) ──────────────────────────
mod = await loadModule(2);
await check("archive survives a restart (persistent store)", async () => {
  const r = await mod.scanSessions(sessionsRoot);
  assert.equal(r.entries.length, 2);
  assert.equal(r.archivedSessions, 1);
});
await check("store document is written under $DSH_HOME", async () => {
  const doc = JSON.parse(await readFile(join(home, "model-usage-archive.json"), "utf8"));
  assert.equal(doc.version, 1);
  assert.equal(Object.keys(doc.files).length, 1);
  assert.equal(doc.files["proj/sess-a/session.jsonl"].archived, true);
  assert.equal(doc.files["proj/sess-a/session.jsonl"].entries.length, 2);
});

// ── 5. purge removes the archive ─────────────────────────────────────────────
await check("purgeArchive removes archived data", async () => {
  mod.clearScanCache({ purgeArchive: true });
  const r = await mod.scanSessions(sessionsRoot);
  assert.equal(r.sessionCount, 0);
  assert.equal(r.archivedSessions, 0);
  assert.equal(r.entries.length, 0);
});

// ── 6. version rotation must not double count ────────────────────────────────
await writeFile(logPath, sessionLog([messageEvent(1, T), messageEvent(2, T + 1000)]));
await check("recreated session scans fresh", async () => {
  const r = await mod.scanSessions(sessionsRoot);
  assert.equal(r.entries.length, 2);
  assert.equal(r.archivedSessions, 0);
});
const v1Path = join(sessionDir, "session.v1.jsonl");
await writeFile(v1Path, sessionLog([
  messageEvent(1, T), messageEvent(2, T + 1000), messageEvent(3, T + 2000, 300),
]));
await rm(logPath);
await check("version rotation drops the superseded record (no double count)", async () => {
  const r = await mod.scanSessions(sessionsRoot);
  assert.equal(r.fileCount, 1);
  assert.equal(r.sessionCount, 1);
  assert.equal(r.archivedSessions, 0);
  assert.equal(r.entries.length, 3);
});

// ── 7. appended live log re-folds ────────────────────────────────────────────
await check("appended events re-fold on mtime/size change", async () => {
  const text = await readFile(v1Path, "utf8");
  await writeFile(v1Path, text + JSON.stringify(messageEvent(4, T + 3000)) + "\n");
  const r = await mod.scanSessions(sessionsRoot);
  assert.equal(r.entries.length, 4);
});

await rm(home, { recursive: true, force: true });
if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exitCode = 1;
} else {
  console.log("\nall checks passed");
}
