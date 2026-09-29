/**
 * Shared formatting helpers for the model-usage dashboard.
 *
 * This file is the single source of truth for the pure formatting functions
 * (integer/cost/duration/time/approximation formatting). It is a PLAIN
 * browser script — no module loader — so it can be served directly to the
 * standalone /usage page (dashboard.html) AND mirrored by the client-plugin
 * module (client/formatters.js) for the settings section.
 *
 * It attaches everything to `window.__MRC__`.
 *
 * IMPORTANT: keep these implementations in sync with client/formatters.js.
 * Any change to a formatter must be applied in both places.
 *
 * @module dsh-model-request-counter/shared
 */
(function (root) {
  "use strict";

  /** Format an integer with zh-CN locale (grouping separators). */
  function fmtInt(n) {
    return Math.round(n).toLocaleString("zh-CN");
  }

  /** Format a USD cost: $0, $0.xxxxx, $0.xx, $x.xx. */
  function fmtCost(n) {
    if (n === 0) return "$0";
    if (n < 0.01) return "$" + n.toFixed(5);
    if (n < 1) return "$" + n.toFixed(4);
    return "$" + n.toFixed(2);
  }

  /** Format milliseconds as human-readable duration. */
  function fmtMs(ms) {
    if (!ms) return "—";
    return ms >= 1000 ? (ms / 1000).toFixed(1) + "s" : Math.round(ms) + "ms";
  }

  /** Format an epoch-ms timestamp as MM-DD HH:MM:SS. */
  function fmtTime(ms) {
    var d = new Date(ms);
    var p = function (x) { return String(x).padStart(2, "0"); };
    return p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
  }

  /** Compact Chinese-unit form: 1.25亿 / 4.9万 / raw int. */
  function fmtCompact(n) {
    if (n >= 1e8) return (n / 1e8).toFixed(2) + "亿";
    if (n >= 1e4) return (n / 1e4).toFixed(1) + "万";
    return String(Math.round(n));
  }

  /** Chinese-unit approximation: ≈4.96万 / ≈1.2亿, or empty. */
  function fmtApprox(n) {
    if (n >= 1e8) return "≈" + (n / 1e8).toLocaleString("zh-CN", { maximumFractionDigits: 2 }) + "亿";
    if (n >= 1e4) return "≈" + (n / 1e4).toLocaleString("zh-CN", { maximumFractionDigits: 2 }) + "万";
    return "";
  }

  /** Parenthesized approximation: （≈4.96万） / empty. */
  function approxOf(n) {
    var a = fmtApprox(n);
    return a === "" ? "" : "（" + a + "）";
  }

  /** Compact Chinese-unit form for chart axis labels. */
  function fmtAxisTokens(n) {
    if (n >= 1e8) return (n / 1e8).toLocaleString("zh-CN", { maximumFractionDigits: 1 }) + "亿";
    if (n >= 1e4) return (n / 1e4).toLocaleString("zh-CN", { maximumFractionDigits: 1 }) + "万";
    return String(Math.round(n));
  }

  /** One token table cell (HTML string): exact count + muted approximation. */
  function tok(n) {
    var a = fmtApprox(n);
    return fmtInt(n) + (a === "" ? "" : ' <span class="approx-inline">' + a + "</span>");
  }

  root.__MRC__ = {
    fmtInt: fmtInt,
    fmtCost: fmtCost,
    fmtMs: fmtMs,
    fmtTime: fmtTime,
    fmtCompact: fmtCompact,
    fmtApprox: fmtApprox,
    approxOf: approxOf,
    fmtAxisTokens: fmtAxisTokens,
    tok: tok,
  };
})(typeof window !== "undefined" ? window : globalThis);
