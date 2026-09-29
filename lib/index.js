/**
 * Host plugin: registers the `modelRequestCounts` session-projection unit and
 * serves the model usage dashboard:
 *
 *   GET  /usage                      — the statistics page (HTML)
 *   GET  /api/model-usage            — usage detail (single day or date range)
 *                                      ?rescan=1 re-reads every disk log,
 *                                      ?purgeArchive=1 drops archived data
 *   GET  /api/model-usage/summary    — compact today card for the dock
 *   GET  /api/model-usage/export     — CSV/JSON export of the request log or
 *                                      per-model aggregates
 *   GET  /api/model-usage/pricing    — current pricing rules
 *   PUT  /api/model-usage/pricing    — replace the pricing rules document
 *
 * The dashboard data is folded from the stored session logs under
 * $DSH_HOME/sessions (auto-scan, mtime-cached), so it covers every session
 * ever recorded, not only the live ones. Folded data is mirrored into
 * $DSH_HOME/model-usage-archive.json: sessions deleted from disk keep their
 * statistics (the archive) until purged.
 *
 * @module dsh-model-request-counter
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { exec } from "node:child_process";
import { modelRequestCountsProjectionDefinition } from "./types/index.js";
import { scanSessions, clearScanCache } from "./usage-scan.js";
import { dshHome, loadPricing, savePricing, entryCost } from "./pricing.js";

/** Cordis plugin name. */
export const name = "model-request-counter";

/** The projection registry is the plugin's one required dependency. */
export const inject = ["sessionProjections"];

/** One window cap served to the page (a day's requests stay well below). */
const MAX_ENTRIES_PER_WINDOW = 1000;

/** Local YYYY-MM-DD of one epoch-ms timestamp. */
function localDay(ms) {
  const d = new Date(ms);
  const p = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** True when a value is a valid YYYY-MM-DD string. */
function isDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/** A zeroed per-day totals object. */
function zeroTotals() {
  return {
    requests: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, cost: 0,
  };
}

/** Sum several totals-shaped objects into one. */
function sumTotals(list) {
  const out = zeroTotals();
  for (const t of list) {
    out.requests += t.requests;
    out.inputTokens += t.inputTokens;
    out.outputTokens += t.outputTokens;
    out.cacheReadTokens += t.cacheReadTokens;
    out.cacheWriteTokens += t.cacheWriteTokens;
    out.cost += t.cost;
  }
  return out;
}

/** Send one JSON response. */
function sendJson(res, code, value) {
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-cache",
  });
  res.end(JSON.stringify(value));
}

/** Send a plain-text response (CSV export). */
function sendText(res, code, type, value) {
  res.writeHead(code, {
    "content-type": type,
    "cache-control": "no-cache",
  });
  res.end(value);
}

/** Read one request's full body as text. */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/** The lazily loaded dashboard page. */
let dashboardHtml = null;

/**
 * Scan the session logs once and fold every event into per-day totals plus a
 * dated entry list (each entry annotated with its cost and local day).
 * Shared by the detail, summary, and export payload builders.
 */
async function loadUsageData() {
  const root = join(dshHome(), "sessions");
  const { entries, fileCount, sessionCount, archivedSessions } = await scanSessions(root);
  const pricing = await loadPricing();
  const days = {};
  const dated = [];
  for (const entry of entries) {
    const cost = entryCost(pricing, entry);
    const day = localDay(entry.time);
    const totals = days[day] ?? zeroTotals();
    totals.requests += 1;
    totals.inputTokens += entry.inputTokens;
    totals.outputTokens += entry.outputTokens;
    totals.cacheReadTokens += entry.cacheReadTokens;
    totals.cacheWriteTokens += entry.cacheWriteTokens;
    totals.cost += cost;
    days[day] = totals;
    dated.push({ ...entry, cost, day });
  }
  return { days, dated, pricing, scan: { files: fileCount, sessions: sessionCount, archived: archivedSessions } };
}

/**
 * Resolve a query's window into { date, from, to }.
 * A `from`+`to` pair (both valid and from <= to) yields a range window;
 * otherwise a single `date` (or the latest populated day) is used.
 */
function resolveWindow(query, days) {
  const from = isDate(query.get("from")) ? query.get("from") : null;
  const to = isDate(query.get("to")) ? query.get("to") : null;
  if (from !== null && to !== null && from <= to) {
    return { date: null, from, to };
  }
  const date = isDate(query.get("date"))
    ? query.get("date")
    : Object.keys(days).sort().pop() ?? localDay(Date.now());
  return { date, from: null, to: null };
}

/**
 * Register the projection unit, subscribe to its live change feed for a
 * lightweight real-time counts snapshot, and in the web profile, serve the
 * dashboard routes.
 */
export function apply(ctx) {
  ctx.sessionProjections.register(modelRequestCountsProjectionDefinition);

  // --- real-time live-session request counts (projection change feed) ------
  /** Per-session latest view of {counts: {routeKey: count}}. */
  const liveCounts = new Map(); // SessionId → {counts: {...}}

  // onChanged is itself an effect on the calling fiber (like register), so no
  // ctx.effect() wrapper is needed — and none is used, to avoid relying on
  // effect() being present on the bare registrant context.
  ctx.sessionProjections.onChanged(
    /** @param value — the raw wire view ({counts: {…}}) when it changed by Object.is. */
    (session, key, value) => {
      if (key !== "modelRequestCounts") return;
      if (value !== null && typeof value === "object" && value.counts !== null) {
        liveCounts.set(session.id, value.counts);
      }
    },
  );

  /** Aggregate liveCounts into a single flat total per route-key. */
  function liveCountsTotal() {
    const total = {};
    for (const counts of liveCounts.values()) {
      if (counts === null || typeof counts !== "object") continue;
      for (const [route, n] of Object.entries(counts)) {
        total[route] = (total[route] ?? 0) + n;
      }
    }
    return total;
  }

  /** Aggregate every scanned entry into the dashboard payload. */
  async function usagePayload(query) {
    const { days, dated, pricing, scan } = await loadUsageData();
    const window = resolveWindow(query, days);

    const inWindow = (day) => {
      if (window.from !== null && window.to !== null) return day >= window.from && day <= window.to;
      return day === window.date;
    };

    // Per-day totals inside the window (for the daily chart + range cards).
    const windowDays = {};
    for (const [day, totals] of Object.entries(days)) {
      if (inWindow(day)) windowDays[day] = totals;
    }
    const totals = sumTotals(Object.values(windowDays));

    const windowEntries = dated
      .filter((entry) => inWindow(entry.day))
      .sort((a, b) => b.time - a.time)
      .slice(0, MAX_ENTRIES_PER_WINDOW);

    return {
      date: window.date,
      from: window.from,
      to: window.to,
      days: windowDays,
      totals,
      entries: windowEntries,
      pricing,
      scan,
    };
  }

  /**
   * Compact per-provider aggregates for one day (default: today, server-local)
   * — the payload behind the main-interface floating dock.
   */
  async function summaryPayload(query) {
    const { dated } = await loadUsageData();
    // Default to today (server-local) — the dock is a "今日" snapshot.
    const date = isDate(query.get("date")) ? query.get("date") : localDay(Date.now());
    const providers = new Map();
    const totals = { requests: 0, tokens: 0, cost: 0 };
    for (const entry of dated) {
      if (entry.day !== date) continue;
      const tokens = entry.inputTokens + entry.outputTokens + entry.cacheReadTokens + entry.cacheWriteTokens;
      const g = providers.get(entry.provider) ?? {
        provider: entry.provider, requests: 0, tokens: 0, cost: 0,
        inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, models: new Set(),
      };
      g.requests += 1;
      g.tokens += tokens;
      g.cost += entry.cost;
      g.inputTokens += entry.inputTokens;
      g.outputTokens += entry.outputTokens;
      g.cacheReadTokens += entry.cacheReadTokens;
      g.cacheWriteTokens += entry.cacheWriteTokens;
      g.models.add(entry.model);
      providers.set(entry.provider, g);
      totals.requests += 1;
      totals.tokens += tokens;
      totals.cost += entry.cost;
    }
    const list = [...providers.values()]
      .map((g) => ({ ...g, models: g.models.size }))
      .sort((a, b) => b.tokens - a.tokens || b.requests - a.requests);
    return { date, ...totals, providers: list };
  }

  /** Escape one CSV cell. */
  function csvCell(value) {
    const s = String(value ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  /** Aggregate entries per provider/model (matches the models table). */
  function modelGroups(entries) {
    const groups = new Map();
    for (const entry of entries) {
      const key = `${entry.provider}\x00${entry.model}`;
      const g = groups.get(key) ?? {
        provider: entry.provider, model: entry.model, requests: 0,
        inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
        cost: 0, durationMs: 0, firstTokenMs: 0, timed: 0, ok: 0,
      };
      g.requests += 1;
      g.inputTokens += entry.inputTokens;
      g.outputTokens += entry.outputTokens;
      g.cacheReadTokens += entry.cacheReadTokens;
      g.cacheWriteTokens += entry.cacheWriteTokens;
      g.cost += entry.cost;
      g.durationMs += entry.durationMs;
      g.firstTokenMs += entry.firstTokenMs;
      if (entry.durationMs > 0) g.timed += 1;
      if (entry.ok) g.ok += 1;
      groups.set(key, g);
    }
    return [...groups.values()].sort((a, b) => b.cost - a.cost || b.requests - a.requests);
  }

  /** Build the export body (CSV or JSON) for the request log or model scope. */
  async function exportPayload(query) {
    const { days, dated } = await loadUsageData();
    const window = resolveWindow(query, days);
    const inWindow = (day) => {
      if (window.from !== null && window.to !== null) return day >= window.from && day <= window.to;
      return day === window.date;
    };
    const entries = dated
      .filter((entry) => inWindow(entry.day))
      .sort((a, b) => b.time - a.time);

    const format = query.get("format") === "csv" ? "csv" : "json";
    const scope = query.get("scope") === "models" ? "models" : "log";

    if (format === "json") {
      return { type: "application/json; charset=utf-8", body: JSON.stringify(scope === "models" ? modelGroups(entries) : entries) };
    }

    // CSV
    let csv;
    if (scope === "models") {
      const head = ["provider", "model", "requests", "inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens", "cost", "avgDurationMs", "avgFirstTokenMs", "successRate"];
      csv = head.join(",") + "\n";
      for (const g of modelGroups(entries)) {
        csv += [
          csvCell(g.provider), csvCell(g.model), g.requests, g.inputTokens, g.outputTokens,
          g.cacheReadTokens, g.cacheWriteTokens, g.cost,
          g.timed ? (g.durationMs / g.timed).toFixed(1) : "",
          g.timed ? (g.firstTokenMs / g.timed).toFixed(1) : "",
          ((g.ok / g.requests) * 100).toFixed(1) + "%",
        ].join(",") + "\n";
      }
    } else {
      const head = ["time", "date", "provider", "model", "inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens", "cost", "durationMs", "firstTokenMs", "status"];
      csv = head.join(",") + "\n";
      for (const e of entries) {
        csv += [
          new Date(e.time).toISOString(), e.day, csvCell(e.provider), csvCell(e.model),
          e.inputTokens, e.outputTokens, e.cacheReadTokens, e.cacheWriteTokens,
          e.cost, e.durationMs, e.firstTokenMs, e.ok ? "200" : (e.status ?? e.code ?? "ERROR"),
        ].join(",") + "\n";
      }
    }
    return { type: "text/csv; charset=utf-8", body: csv };
  }

  const registerRoutes = (webCtx) => {
    webCtx.effect(() => webCtx.webServer.register({
      kind: "exact",
      path: "/usage",
      handler: async (_req, res) => {
        dashboardHtml ??= await readFile(new URL("./dashboard.html", import.meta.url), "utf8");
        res.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-cache",
        });
        res.end(dashboardHtml);
      },
    }), "model-request-counter: dashboard page");

    webCtx.effect(() => webCtx.webServer.register({
      kind: "exact",
      path: "/static/model-usage-shared.js",
      handler: async (_req, res) => {
        const shared = await readFile(new URL("./static/shared.js", import.meta.url), "utf8");
        res.writeHead(200, {
          "content-type": "text/javascript; charset=utf-8",
          "cache-control": "no-cache",
        });
        res.end(shared);
      },
    }), "model-request-counter: shared formatters");

    webCtx.effect(() => webCtx.webServer.register({
      kind: "exact",
      path: "/api/open-external",
      handler: async (req, res) => {
        const query = new URL(req.url ?? "/", "http://x").searchParams;
        // The renderer runs on a dsh-app:// origin in the desktop shell, so it
        // cannot know the HTTP origin. Accept a pathname and rebuild the URL
        // from this request's own Host header.
        const path = query.get("path") ?? "/usage";
        if (!path.startsWith("/")) {
          sendJson(res, 400, { error: "path must start with /" });
          return;
        }
        const host = req.headers.host ?? "127.0.0.1";
        const url = `http://${host}${path}`;
        const cmd = process.platform === "win32"
          ? `start "" "${url}"`
          : process.platform === "darwin"
            ? `open "${url}"`
            : `xdg-open "${url}"`;
        exec(cmd);
        sendJson(res, 200, { ok: true, url });
      },
    }), "model-request-counter: open external");

    webCtx.effect(() => webCtx.webServer.register({
      kind: "exact",
      path: "/api/model-usage",
      handler: async (req, res) => {
        try {
          const query = new URL(req.url ?? "/", "http://x").searchParams;
          if (query.get("rescan") === "1") clearScanCache();
          if (query.get("purgeArchive") === "1") clearScanCache({ purgeArchive: true });
          sendJson(res, 200, await usagePayload(query));
        } catch (error) {
          sendJson(res, 500, { error: String(error) });
        }
      },
    }), "model-request-counter: usage api");

    webCtx.effect(() => webCtx.webServer.register({
      kind: "exact",
      path: "/api/model-usage/summary",
      handler: async (req, res) => {
        try {
          const query = new URL(req.url ?? "/", "http://x").searchParams;
          sendJson(res, 200, await summaryPayload(query));
        } catch (error) {
          sendJson(res, 500, { error: String(error) });
        }
      },
    }), "model-request-counter: usage summary api");

    webCtx.effect(() => webCtx.webServer.register({
      kind: "exact",
      path: "/api/model-usage/counts",
      handler: async (_req, res) => {
        try {
          sendJson(res, 200, {
            counts: liveCountsTotal(),
            liveSessions: liveCounts.size,
            note: "real-time request counts from live sessions only (projection feed); historical sessions use /api/model-usage",
          });
        } catch (error) {
          sendJson(res, 500, { error: String(error) });
        }
      },
    }), "model-request-counter: live counts api");

    webCtx.effect(() => webCtx.webServer.register({
      kind: "exact",
      path: "/api/model-usage/export",
      handler: async (req, res) => {
        try {
          const query = new URL(req.url ?? "/", "http://x").searchParams;
          const { type, body } = await exportPayload(query);
          const filename = `model-usage.${query.get("format") === "csv" ? "csv" : "json"}`;
          res.writeHead(200, {
            "content-type": type,
            "cache-control": "no-cache",
            "content-disposition": `attachment; filename="${filename}"`,
          });
          res.end(body);
        } catch (error) {
          sendJson(res, 500, { error: String(error) });
        }
      },
    }), "model-request-counter: usage export api");

    webCtx.effect(() => webCtx.webServer.register({
      kind: "exact",
      path: "/api/model-usage/pricing",
      handler: async (req, res) => {
        try {
          if (req.method === "GET" || req.method === "HEAD") {
            sendJson(res, 200, await loadPricing());
            return;
          }
          if (req.method !== "PUT") {
            res.writeHead(405, { allow: "GET, PUT" });
            res.end();
            return;
          }
          const body = JSON.parse(await readBody(req));
          sendJson(res, 200, await savePricing(body));
        } catch (error) {
          sendJson(res, 400, { error: String(error) });
        }
      },
    }), "model-request-counter: pricing api");
  };

  // Always inject — ctx.get("webServer") returns the service value without
  // setting ctx.webServer, so dot-access on the bare ctx fails. ctx.inject is
  // the canonical way to obtain a sub-context with the service on the prototype.
  ctx.inject(["webServer"], registerRoutes);
}