/**
 * Browser half of dsh-model-request-counter: a Cordis client plugin that
 * registers the 使用统计 (model usage) section in the Settings panel and the
 * floating usage dock in the main interface.
 *
 * Supports two query modes in the section — single-day (hourly chart) and
 * date-range (daily chart) — plus CSV/JSON export of the current window.
 *
 * NOTE: the DSH client module loader serves exactly ONE entry file per plugin
 * (client/index.js). All code lives here in clearly delimited regions rather
 * than in physically separate files, because sibling-file `require()` ids are
 * not resolved by the loader.
 *
 * @module dsh-model-request-counter/client
 */
window.__ModuleLoader__.load({
	id: "dsh-model-request-counter",
	factory(require) {
		var module = { exports: {} };
		var exports = module.exports;
		const React = require("react");
		const { useState, useEffect, useCallback, useRef } = React;
		const h = React.createElement;

		//#region styles
		const CSS_TAG = "dsh-model-request-counter/usage.css";
		const CSS = [
			".mrc-section{flex-direction:column;width:100%;display:flex;gap:14px;color:var(--dsw-alias-label-primary);padding-bottom:8px}",
			".mrc-tools{display:flex;align-items:center;gap:8px;flex-wrap:wrap}",
			".mrc-tools .mrc-title{font-size:16px;font-weight:600;margin-right:auto}",
			".mrc-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(138px,1fr));gap:10px}",
			".mrc-card{border:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);border-radius:12px;padding:11px 13px}",
			".mrc-card .mrc-label{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.4}",
			".mrc-card .mrc-value{font-size:19px;font-weight:600;margin-top:3px;font-variant-numeric:tabular-nums;line-height:1.3}",
			".mrc-card .mrc-approx{color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:400;margin-top:1px;line-height:1.4}",
			".mrc-approx-inline{color:var(--dsw-alias-label-secondary);font-size:11px;margin-left:1px}",
			".mrc-panel{border:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);border-radius:12px;padding:13px 15px}",
			".mrc-panel h3{margin:0 0 10px;font-size:14px;font-weight:600}",
			".mrc-legend{display:flex;gap:14px;flex-wrap:wrap;color:var(--dsw-alias-label-secondary);font-size:12px;margin-top:8px}",
			".mrc-dot{width:10px;height:10px;border-radius:3px;display:inline-block;margin-right:5px;vertical-align:-1px}",
			".mrc-tabs{display:flex;gap:20px;align-items:flex-end;border-bottom:.5px solid var(--dsw-alias-border-l2)}",
			".mrc-tab{color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer;background:0 0;border:0;padding:7px 1px 9px;font-size:13px;line-height:20px;position:relative}",
			".mrc-tab:hover,.mrc-tab[data-active=true]{color:var(--dsw-alias-label-primary)}",
			".mrc-tab[data-active=true]:after{background:var(--dsw-alias-label-primary);content:\"\";border-radius:2px 2px 0 0;height:2px;position:absolute;bottom:-1px;left:0;right:0}",
			".mrc-tablewrap{max-height:420px;overflow:auto}",
			"table.mrc-table{width:100%;border-collapse:collapse;font-size:13px}",
			".mrc-table th,.mrc-table td{text-align:right;padding:6px 9px;border-bottom:.5px solid var(--dsw-alias-border-l2);white-space:nowrap}",
			".mrc-table th{color:var(--dsw-alias-label-secondary);font-weight:500;position:sticky;top:0;background:var(--dsw-alias-bg-layer-2)}",
			".mrc-table th:first-child,.mrc-table td:first-child{text-align:left}",
			".mrc-table td.num{font-variant-numeric:tabular-nums}",
			".mrc-table tbody tr:hover{background:var(--dsw-alias-bg-overlay)}",
			".mrc-badge{display:inline-block;padding:1px 8px;border-radius:999px;font-size:12px}",
			".mrc-badge.ok{background:rgba(34,197,94,.15);color:#22c55e}",
			".mrc-badge.err{background:rgba(239,68,68,.15);color:#ef4444}",
			".mrc-empty{color:var(--dsw-alias-label-secondary);text-align:center;padding:26px 0;font-size:13px}",
			".mrc-hint{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.6;margin:8px 0 0}",
			".mrc-btn{font:inherit;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-primary);cursor:pointer;background:var(--dsw-alias-bg-layer-2);border:.5px solid var(--dsw-alias-border-l2);border-radius:8px;padding:5px 12px}",
			".mrc-btn:hover{border-color:var(--dsw-alias-brand-primary)}",
			".mrc-btn.primary{background:var(--dsw-alias-brand-primary);color:#fff;border-color:transparent}",
			".mrc-input{font:inherit;font-size:13px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);border:.5px solid var(--dsw-alias-border-l2);border-radius:8px;padding:5px 10px}",
			".mrc-input:focus-visible{border-color:var(--dsw-alias-brand-primary);outline:none}",
			".mrc-err{color:var(--dsw-alias-state-error-primary);font-size:12px;margin:0}",
			".mrc-priceinput{width:78px}",
			".mrc-patterninput{width:200px}",
			".mrc-actions{display:flex;gap:8px;margin-top:10px}",
			".mrc-providers{display:flex;gap:8px;flex-wrap:wrap;align-items:center}",
			".mrc-chip{font:inherit;font-size:12px;line-height:1.6;cursor:pointer;background:var(--dsw-alias-bg-layer-2);border:.5px solid var(--dsw-alias-border-l2);border-radius:999px;padding:3px 12px;color:var(--dsw-alias-label-secondary)}",
			".mrc-chip:hover{border-color:var(--dsw-alias-brand-primary)}",
			".mrc-chip[data-active=true]{background:var(--dsw-alias-brand-primary);color:#fff;border-color:transparent}",
			".mrc-chip .mrc-chipStats{opacity:.75;margin-left:5px}",
			".mrc-chartwrap{position:relative;width:100%}",
			".mrc-chartwrap svg{display:block;width:100%;height:auto}",
			".mrc-tooltip{position:absolute;pointer-events:none;background:var(--dsw-alias-bg-overlay);border:.5px solid var(--dsw-alias-border-l2);border-radius:8px;padding:8px 11px;font-size:12px;line-height:1.7;color:var(--dsw-alias-label-primary);box-shadow:0 4px 16px rgba(0,0,0,.3);z-index:5;white-space:nowrap}",
			".mrc-tooltip .mrc-ttTitle{font-weight:600;margin-bottom:2px}",
			".mrc-tooltip .mrc-ttRow{display:flex;align-items:center;gap:6px}",
			".mrc-tooltip .mrc-ttDot{width:8px;height:8px;border-radius:2px;flex:none}",
			// Floating dock (shell.overlay)
			".mrc-dock{position:absolute;right:16px;bottom:16px;font-size:12px;color:var(--dsw-alias-label-primary)}",
			".mrc-dockPill{display:flex;align-items:center;gap:7px;cursor:pointer;font:inherit;color:inherit;background:var(--dsw-alias-bg-layer-2);border:.5px solid var(--dsw-alias-border-l2);border-radius:999px;padding:6px 13px;box-shadow:0 4px 16px rgba(0,0,0,.28);transition:border-color .15s}",
			".mrc-dockPill:hover{border-color:var(--dsw-alias-brand-primary)}",
			".mrc-dockPill[data-open=true]{border-color:var(--dsw-alias-brand-primary)}",
			".mrc-dockPill .mrc-dockDot{width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-brand-primary);flex:none}",
			".mrc-dockPill b{font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap}",
			".mrc-dockPill .mrc-dockSub{color:var(--dsw-alias-label-secondary);white-space:nowrap}",
			".mrc-dockPanel{position:absolute;right:0;bottom:calc(100% + 10px);width:316px;max-width:calc(100vw - 32px);background:var(--dsw-alias-bg-overlay);border:.5px solid var(--dsw-alias-border-l2);border-radius:12px;padding:12px 14px;box-shadow:0 8px 30px rgba(0,0,0,.38)}",
			".mrc-dockHead{display:flex;align-items:center;gap:6px;margin-bottom:9px}",
			".mrc-dockHead .mrc-dockTitle{font-weight:600;font-size:13px;margin-right:auto}",
			".mrc-dockTotal{color:var(--dsw-alias-label-secondary);margin-bottom:9px;line-height:1.6}",
			".mrc-dockTotal b{color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}",
			".mrc-dockProv{padding:7px 0;border-top:.5px solid var(--dsw-alias-border-l2)}",
			".mrc-dockProvTop{display:flex;align-items:baseline;gap:8px}",
			".mrc-dockProvTop .mrc-dockProvName{font-weight:600;margin-right:auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
			".mrc-dockProvTop .mrc-dockProvStats{color:var(--dsw-alias-label-secondary);white-space:nowrap;font-variant-numeric:tabular-nums}",
			".mrc-dockProvTokens{margin-top:2px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}",
			".mrc-dockProvTokens .mrc-approx-inline{margin-left:3px}",
			".mrc-dockProvDetail{margin-top:1px;color:var(--dsw-alias-label-secondary);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
			".mrc-dockBar{display:flex;height:5px;border-radius:3px;overflow:hidden;background:var(--dsw-alias-bg-layer-2);margin-top:6px}",
			".mrc-dockBar i{display:block;height:100%}",
			".mrc-dockFoot{display:flex;align-items:center;gap:8px;margin-top:10px}",
			".mrc-dockFoot .mrc-dockHint{color:var(--dsw-alias-label-secondary);font-size:11px;margin-right:auto}",
			".mrc-dockHead .mrc-btn{padding:2px 9px;font-size:12px;line-height:1.5}",
			".mrc-dockFoot .mrc-btn{padding:4px 10px;font-size:12px}",
			".mrc-settingsStack{display:flex;flex-direction:column;gap:14px}",
			".mrc-toggleRow{display:flex;align-items:center;gap:9px;cursor:pointer;font-size:13px}",
			".mrc-toggleRow input{accent-color:var(--dsw-alias-brand-primary);cursor:pointer;width:15px;height:15px;flex:none}",
			".mrc-dateStack{display:flex;align-items:center;gap:6px;flex-wrap:wrap}",
			".mrc-dateStack span{color:var(--dsw-alias-label-secondary);font-size:12px}",
			".mrc-export{display:flex;gap:6px}",
		].join("\n");
		if (typeof document !== "undefined" && document.querySelector('style[data-plugin-css="' + CSS_TAG + '"]') === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-model-request-counter";
			tag.dataset.pluginCss = CSS_TAG;
			tag.textContent = CSS;
			document.head.appendChild(tag);
		}
		//#endregion

		//#region formatting helpers
		const fmtInt = (n) => Math.round(n).toLocaleString("zh-CN");
		function fmtCost(n) {
			if (n === 0) return "$0";
			if (n < 0.01) return "$" + n.toFixed(5);
			if (n < 1) return "$" + n.toFixed(4);
			return "$" + n.toFixed(2);
		}
		function fmtMs(ms) {
			if (!ms) return "—";
			return ms >= 1000 ? (ms / 1000).toFixed(1) + "s" : Math.round(ms) + "ms";
		}
		function fmtTime(ms) {
			const d = new Date(ms);
			const p = (x) => String(x).padStart(2, "0");
			return p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
		}
		function fmtCompact(n) {
			if (n >= 1e8) return (n / 1e8).toFixed(2) + "亿";
			if (n >= 1e4) return (n / 1e4).toFixed(1) + "万";
			return String(Math.round(n));
		}
		function fmtApprox(n) {
			if (n >= 1e8) return "≈" + (n / 1e8).toLocaleString("zh-CN", { maximumFractionDigits: 2 }) + "亿";
			if (n >= 1e4) return "≈" + (n / 1e4).toLocaleString("zh-CN", { maximumFractionDigits: 2 }) + "万";
			return "";
		}
		function approxOf(n) {
			const a = fmtApprox(n);
			return a === "" ? "" : "（" + a + "）";
		}
		function fmtAxisTokens(n) {
			if (n >= 1e8) return (n / 1e8).toLocaleString("zh-CN", { maximumFractionDigits: 1 }) + "亿";
			if (n >= 1e4) return (n / 1e4).toLocaleString("zh-CN", { maximumFractionDigits: 1 }) + "万";
			return String(Math.round(n));
		}
		function fmtLocalDate(d) {
			const p = (x) => String(x).padStart(2, "0");
			return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
		}
		function tok(n) {
			const approx = fmtApprox(n);
			return h("span", null, fmtInt(n),
				approx === "" ? null : h("span", { className: "mrc-approx-inline" }, " " + approx));
		}
		function openUsagePage() {
			const usageUrl = "/usage";
			if (typeof location !== "undefined" && /^dsh-app:/i.test(location.origin || "")) {
				// Desktop (Electron): ask the host to open the system default browser.
				// The renderer's origin is dsh-app://, so pass only the pathname and
				// let the host rebuild the HTTP URL from the request's Host header.
				fetch("/api/open-external?path=" + encodeURIComponent(usageUrl));
				return;
			}
			// Web: already in a browser — open a new tab.
			try {
				const w = window.open(usageUrl, "_blank", "noopener");
				if (w === null) window.location.href = usageUrl;
			} catch {
				window.location.href = usageUrl;
			}
		}
		async function downloadExport(scope, format, query) {
			const params = new URLSearchParams();
			params.set("scope", scope);
			params.set("format", format);
			if (query) {
				if (query.from) params.set("from", query.from);
				if (query.to) params.set("to", query.to);
				if (query.date) params.set("date", query.date);
			}
			const resp = await fetch("/api/model-usage/export?" + params.toString());
			if (!resp.ok) throw new Error("HTTP " + resp.status);
			const blob = await resp.blob();
			const url = URL.createObjectURL(blob);
			const a = document.createElement("a");
			a.href = url;
			a.download = "model-usage." + format;
			document.body.appendChild(a);
			a.click();
			a.remove();
			URL.revokeObjectURL(url);
		}
		//#endregion

		//#region data helpers
		function dayTotals(entries) {
			const t = { requests: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, cost: 0 };
			for (const e of entries) {
				t.requests++;
				t.inputTokens += e.inputTokens;
				t.outputTokens += e.outputTokens;
				t.cacheReadTokens += e.cacheReadTokens;
				t.cacheWriteTokens += e.cacheWriteTokens;
				t.cost += e.cost;
			}
			return t;
		}
		function hourBuckets(entries) {
			const buckets = Array.from({ length: 24 }, () => ({ input: 0, output: 0, cacheWrite: 0, cacheRead: 0, cost: 0, requests: 0 }));
			for (const e of entries) {
				const b = buckets[new Date(e.time).getHours()];
				b.input += e.inputTokens;
				b.output += e.outputTokens;
				b.cacheWrite += e.cacheWriteTokens;
				b.cacheRead += e.cacheReadTokens;
				b.cost += e.cost;
				b.requests++;
			}
			return buckets;
		}
		function groupModels(entries) {
			const groups = new Map();
			for (const e of entries) {
				const g = groups.get(e.provider + "\0" + e.model) ?? {
					provider: e.provider, model: e.model, requests: 0,
					inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
					cost: 0, durationMs: 0, firstTokenMs: 0, timed: 0, ok: 0,
				};
				g.requests++;
				g.inputTokens += e.inputTokens;
				g.outputTokens += e.outputTokens;
				g.cacheReadTokens += e.cacheReadTokens;
				g.cacheWriteTokens += e.cacheWriteTokens;
				g.cost += e.cost;
				g.durationMs += e.durationMs;
				g.firstTokenMs += e.firstTokenMs;
				if (e.durationMs > 0) g.timed++;
				if (e.ok) g.ok++;
				groups.set(e.provider + "\0" + e.model, g);
			}
			return [...groups.values()].sort((a, b) => b.cost - a.cost || b.requests - a.requests);
		}
		function groupProviders(entries) {
			const groups = new Map();
			for (const e of entries) {
				const g = groups.get(e.provider) ?? { provider: e.provider, requests: 0, tokens: 0, cost: 0 };
				g.requests++;
				g.tokens += e.inputTokens + e.outputTokens + e.cacheReadTokens + e.cacheWriteTokens;
				g.cost += e.cost;
				groups.set(e.provider, g);
			}
			return [...groups.values()].sort((a, b) => b.tokens - a.tokens || b.requests - a.requests);
		}
		//#endregion

		//#region dock visibility preference
		const DOCK_VISIBLE_KEY = "dsh-model-request-counter:dock-visible";
		const DOCK_TOGGLE_EVENT = "dsh-model-request-counter:dock-toggle";
		function dockVisiblePref() {
			try {
				const v = window.localStorage.getItem(DOCK_VISIBLE_KEY);
				return v === null ? true : v === "1";
			} catch {
				return true;
			}
		}
		function setDockVisiblePref(visible) {
			try {
				window.localStorage.setItem(DOCK_VISIBLE_KEY, visible ? "1" : "0");
			} catch {
				// Private mode etc.
			}
			window.dispatchEvent(new CustomEvent(DOCK_TOGGLE_EVENT, { detail: { visible } }));
		}
		//#endregion

		//#region chart
		const CHART_COLORS = ["#3b82f6", "#22c55e", "#f59e0b", "#a855f7"];
		const COST_COLOR = "#ef4444";

		function Chart({ entries, emptyLabel }) {
			const [hover, setHover] = useState(null);
			if (entries.length === 0) return h("div", { className: "mrc-empty" }, emptyLabel ?? "当日无请求数据");

			const W = 1120, H = 260, ML = 64, MR = 64, MT = 16, MB = 30;
			const IW = W - ML - MR, IH = H - MT - MB;
			const buckets = hourBuckets(entries);
			const maxTokens = Math.max(1, ...buckets.map((b) => b.input + b.output + b.cacheWrite + b.cacheRead));
			const maxCost = Math.max(...buckets.map((b) => b.cost));
			const x = (hr) => ML + (IW / 24) * hr;
			const bw = IW / 24 - 6;
			const yT = (v) => MT + IH - (v / maxTokens) * IH;
			const yC = (v) => MT + IH - (maxCost > 0 ? (v / maxCost) * IH : 0);

			const children = [];
			for (let i = 0; i <= 4; i++) {
				const v = (maxTokens / 4) * i;
				const y = yT(v);
				children.push(h("line", { key: "g" + i, x1: ML, y1: y, x2: W - MR, y2: y, strokeWidth: 1, style: { stroke: "var(--dsw-alias-border-l2)" } }));
				children.push(h("text", { key: "gl" + i, x: ML - 8, y: y + 4, fontSize: 11, textAnchor: "end", style: { fill: "var(--dsw-alias-label-secondary)" } }, fmtAxisTokens(v)));
			}
			if (maxCost > 0) {
				for (let i = 0; i <= 4; i++) {
					const v = (maxCost / 4) * i;
					children.push(h("text", { key: "cr" + i, x: W - MR + 8, y: yC(v) + 4, fontSize: 11, style: { fill: COST_COLOR } }, fmtCost(v)));
				}
			}
			for (let hr = 0; hr <= 24; hr += 3) {
				children.push(h("text", { key: "x" + hr, x: hr === 24 ? W - MR : x(hr), y: H - 8, fontSize: 11, textAnchor: "middle", style: { fill: "var(--dsw-alias-label-secondary)" } }, hr + "时"));
			}
			if (hover !== null) {
				children.push(h("rect", {
					key: "hl", x: x(hover.hour), y: MT, width: IW / 24, height: IH,
					fill: "var(--dsw-alias-label-primary)", opacity: 0.06,
				}));
			}
			const costPts = [];
			buckets.forEach((b, hr) => {
				const bx = x(hr) + 3;
				const parts = [b.input, b.output, b.cacheWrite, b.cacheRead];
				const rects = [];
				let base = 0;
				parts.forEach((value, idx) => {
					if (value <= 0) return;
					const y = yT(base + value);
					const height = yT(base) - y;
					rects.push(h("rect", {
						key: idx, x: bx, y, width: bw, height: Math.max(height, 1),
						fill: CHART_COLORS[idx], rx: 1,
						opacity: hover === null || hover.hour === hr ? 1 : 0.45,
					}));
					base += value;
				});
				children.push(h("g", { key: "b" + hr }, rects));
				costPts.push([x(hr) + 3 + bw / 2, yC(b.cost)]);
			});
			if (maxCost > 0) {
				children.push(h("polyline", { key: "cost", points: costPts.map((p) => p[0] + "," + p[1]).join(" "), fill: "none", stroke: COST_COLOR, strokeWidth: 1.8, strokeLinejoin: "round" }));
				costPts.forEach(([px, py], i) => children.push(h("circle", { key: "c" + i, cx: px, cy: py, r: hover !== null && hover.hour === i ? 3.4 : 2.4, fill: COST_COLOR })));
			}
			if (hover !== null) {
				const cx = x(hover.hour) + (IW / 24) / 2;
				children.push(h("line", {
					key: "cross", x1: cx, y1: MT, x2: cx, y2: MT + IH,
					stroke: "var(--dsw-alias-label-secondary)", strokeWidth: 1, strokeDasharray: "3 3",
				}));
			}
			const onMove = (e) => {
				const rect = e.currentTarget.getBoundingClientRect();
				const vx = ((e.clientX - rect.left) / rect.width) * W;
				const hour = Math.floor((vx - ML) / (IW / 24));
				if (hour < 0 || hour > 23 || vx < ML || vx > W - MR) {
					setHover(null);
					return;
				}
				setHover({ hour, px: e.clientX - rect.left, py: e.clientY - rect.top, ww: rect.width, wh: rect.height });
			};
			let tooltip = null;
			if (hover !== null) {
				const b = buckets[hover.hour];
				const row = (color, label, value) => h("div", { className: "mrc-ttRow" },
					h("i", { className: "mrc-ttDot", style: { background: color } }),
					h("span", null, label + " " + fmtInt(value) + approxOf(value)));
				const flip = hover.px > hover.ww - 200;
				tooltip = h("div", {
					className: "mrc-tooltip",
					style: {
						left: flip ? undefined : hover.px + 14,
						right: flip ? hover.ww - hover.px + 14 : undefined,
						top: Math.max(4, Math.min(hover.py - 30, hover.wh - 130)),
					},
				}, [
					h("div", { key: "t", className: "mrc-ttTitle" }, hover.hour + "时 · " + b.requests + " 次请求"),
					row(CHART_COLORS[0], "输入", b.input),
					row(CHART_COLORS[1], "输出", b.output),
					row(CHART_COLORS[2], "缓存创建", b.cacheWrite),
					row(CHART_COLORS[3], "缓存命中", b.cacheRead),
					h("div", { key: "c", className: "mrc-ttRow" },
						h("i", { className: "mrc-ttDot", style: { background: COST_COLOR } }),
						h("span", null, "成本 " + fmtCost(b.cost))),
				]);
			}
			return h("div", { className: "mrc-chartwrap" }, [
				h("svg", {
					key: "svg", viewBox: "0 0 " + W + " " + H, xmlns: "http://www.w3.org/2000/svg", role: "img",
					onMouseMove: onMove, onMouseLeave: () => setHover(null),
				}, children),
				tooltip,
			]);
		}

		function DailyChart({ days, emptyLabel }) {
			const [hover, setHover] = useState(null);
			if (days.length === 0) return h("div", { className: "mrc-empty" }, emptyLabel ?? "该范围无请求数据");

			const W = 1120, H = 260, ML = 64, MR = 64, MT = 16, MB = 40;
			const IW = W - ML - MR, IH = H - MT - MB;
			let maxTokens = 1, maxCost = 0;
			for (const [, t] of days) {
				const sum = t.inputTokens + t.outputTokens + t.cacheReadTokens + t.cacheWriteTokens;
				if (sum > maxTokens) maxTokens = sum;
				if (t.cost > maxCost) maxCost = t.cost;
			}
			const slot = IW / days.length;
			const bw = Math.max(4, slot - 8);
			const x = (idx) => ML + slot * idx;
			const yT = (v) => MT + IH - (v / maxTokens) * IH;
			const yC = (v) => MT + IH - (maxCost > 0 ? (v / maxCost) * IH : 0);

			const children = [];
			for (let i = 0; i <= 4; i++) {
				const v = (maxTokens / 4) * i;
				const y = yT(v);
				children.push(h("line", { key: "g" + i, x1: ML, y1: y, x2: W - MR, y2: y, strokeWidth: 1, style: { stroke: "var(--dsw-alias-border-l2)" } }));
				children.push(h("text", { key: "gl" + i, x: ML - 8, y: y + 4, fontSize: 11, textAnchor: "end", style: { fill: "var(--dsw-alias-label-secondary)" } }, fmtAxisTokens(v)));
			}
			if (maxCost > 0) {
				for (let i = 0; i <= 4; i++) {
					const v = (maxCost / 4) * i;
					children.push(h("text", { key: "cr" + i, x: W - MR + 8, y: yC(v) + 4, fontSize: 11, style: { fill: COST_COLOR } }, fmtCost(v)));
				}
			}
			const labelStep = Math.max(1, Math.ceil(days.length / 12));
			days.forEach(([date], di) => {
				if (di % labelStep !== 0 && di !== days.length - 1) return;
				children.push(h("text", {
					key: "x" + di, x: x(di) + slot / 2, y: H - 12, fontSize: 11, textAnchor: "middle",
					style: { fill: "var(--dsw-alias-label-secondary)" },
				}, date.slice(5)));
			});
			if (hover !== null) {
				children.push(h("rect", {
					key: "hl", x: x(hover.idx), y: MT, width: slot, height: IH,
					fill: "var(--dsw-alias-label-primary)", opacity: 0.06,
				}));
			}
			const costPts = [];
			days.forEach(([date, t], idx) => {
				const bx = x(idx) + (slot - bw) / 2;
				const parts = [t.inputTokens, t.outputTokens, t.cacheWriteTokens, t.cacheReadTokens];
				const rects = [];
				let base = 0;
				parts.forEach((value, pi) => {
					if (value <= 0) return;
					const y = yT(base + value);
					const height = yT(base) - y;
					rects.push(h("rect", {
						key: pi, x: bx, y, width: bw, height: Math.max(height, 1),
						fill: CHART_COLORS[pi], rx: 1,
						opacity: hover === null || hover.idx === idx ? 1 : 0.45,
					}));
					base += value;
				});
				children.push(h("g", { key: "b" + idx }, rects));
				costPts.push([bx + bw / 2, yC(t.cost)]);
			});
			if (maxCost > 0) {
				children.push(h("polyline", { key: "cost", points: costPts.map((p) => p[0] + "," + p[1]).join(" "), fill: "none", stroke: COST_COLOR, strokeWidth: 1.8, strokeLinejoin: "round" }));
				costPts.forEach(([px, py], i) => children.push(h("circle", { key: "c" + i, cx: px, cy: py, r: hover !== null && hover.idx === i ? 3.4 : 2.4, fill: COST_COLOR })));
			}
			if (hover !== null) {
				const cx = x(hover.idx) + slot / 2;
				children.push(h("line", {
					key: "cross", x1: cx, y1: MT, x2: cx, y2: MT + IH,
					stroke: "var(--dsw-alias-label-secondary)", strokeWidth: 1, strokeDasharray: "3 3",
				}));
			}
			const onMove = (e) => {
				const rect = e.currentTarget.getBoundingClientRect();
				const vx = ((e.clientX - rect.left) / rect.width) * W;
				const idx = Math.floor((vx - ML) / slot);
				if (idx < 0 || idx >= days.length || vx < ML || vx > W - MR) {
					setHover(null);
					return;
				}
				setHover({ idx, px: e.clientX - rect.left, py: e.clientY - rect.top, ww: rect.width, wh: rect.height });
			};
			let tooltip = null;
			if (hover !== null) {
				const [date, t] = days[hover.idx];
				const row = (color, label, value) => h("div", { className: "mrc-ttRow" },
					h("i", { className: "mrc-ttDot", style: { background: color } }),
					h("span", null, label + " " + fmtInt(value) + approxOf(value)));
				const flip = hover.px > hover.ww - 200;
				tooltip = h("div", {
					className: "mrc-tooltip",
					style: {
						left: flip ? undefined : hover.px + 14,
						right: flip ? hover.ww - hover.px + 14 : undefined,
						top: Math.max(4, Math.min(hover.py - 30, hover.wh - 130)),
					},
				}, [
					h("div", { key: "t", className: "mrc-ttTitle" }, date + " · " + t.requests + " 次请求"),
					row(CHART_COLORS[0], "输入", t.inputTokens),
					row(CHART_COLORS[1], "输出", t.outputTokens),
					row(CHART_COLORS[2], "缓存创建", t.cacheWriteTokens),
					row(CHART_COLORS[3], "缓存命中", t.cacheReadTokens),
					h("div", { key: "c", className: "mrc-ttRow" },
						h("i", { className: "mrc-ttDot", style: { background: COST_COLOR } }),
						h("span", null, "成本 " + fmtCost(t.cost))),
				]);
			}
			return h("div", { className: "mrc-chartwrap" }, [
				h("svg", {
					key: "svg", viewBox: "0 0 " + W + " " + H, xmlns: "http://www.w3.org/2000/svg", role: "img",
					onMouseMove: onMove, onMouseLeave: () => setHover(null),
				}, children),
				tooltip,
			]);
		}
		//#endregion

		//#region tables
		function statusBadge(e) {
			if (e.ok) return h("span", { className: "mrc-badge ok" }, "200");
			return h("span", { className: "mrc-badge err" }, e.status ?? e.code ?? "ERR");
		}

		function LogTable({ entries, emptyLabel }) {
			if (entries.length === 0) return h("div", { className: "mrc-empty" }, emptyLabel ?? "当日无请求数据");
			const rows = entries.map((e, i) => h("tr", { key: i }, [
				h("td", { key: "t" }, fmtTime(e.time)),
				h("td", { key: "p" }, e.provider),
				h("td", { key: "m" }, e.model),
				h("td", { key: "i", className: "num" }, tok(e.inputTokens)),
				h("td", { key: "o", className: "num" }, tok(e.outputTokens)),
				h("td", { key: "cr", className: "num" }, tok(e.cacheReadTokens)),
				h("td", { key: "cw", className: "num" }, tok(e.cacheWriteTokens)),
				h("td", { key: "c", className: "num" }, fmtCost(e.cost)),
				h("td", { key: "d", className: "num" }, fmtMs(e.durationMs)),
				h("td", { key: "f", className: "num" }, fmtMs(e.firstTokenMs)),
				h("td", { key: "s" }, statusBadge(e)),
			]));
			const head = ["时间", "供应商", "模型", "输入", "输出", "缓存读", "缓存写", "成本", "耗时", "首字", "状态"]
				.map((label, i) => h("th", { key: i }, label));
			return h("div", { className: "mrc-tablewrap" },
				h("table", { className: "mrc-table" },
					h("thead", null, h("tr", null, head)),
					h("tbody", null, rows)));
		}

		function ModelsTable({ entries, emptyLabel }) {
			if (entries.length === 0) return h("div", { className: "mrc-empty" }, emptyLabel ?? "当日无请求数据");
			const groups = groupModels(entries);
			const rows = groups.map((g, i) => h("tr", { key: i }, [
				h("td", { key: "p" }, g.provider),
				h("td", { key: "m" }, g.model),
				h("td", { key: "n", className: "num" }, fmtInt(g.requests)),
				h("td", { key: "i", className: "num" }, tok(g.inputTokens)),
				h("td", { key: "o", className: "num" }, tok(g.outputTokens)),
				h("td", { key: "cr", className: "num" }, tok(g.cacheReadTokens)),
				h("td", { key: "cw", className: "num" }, tok(g.cacheWriteTokens)),
				h("td", { key: "c", className: "num" }, fmtCost(g.cost)),
				h("td", { key: "d", className: "num" }, g.timed ? fmtMs(g.durationMs / g.timed) : "—"),
				h("td", { key: "f", className: "num" }, g.timed ? fmtMs(g.firstTokenMs / g.timed) : "—"),
				h("td", { key: "s", className: "num" }, Math.round((g.ok / g.requests) * 100) + "%"),
			]));
			const head = ["供应商", "模型", "请求数", "输入", "输出", "缓存读", "缓存写", "成本", "平均耗时", "平均首字", "成功率"]
				.map((label, i) => h("th", { key: i }, label));
			return h("div", { className: "mrc-tablewrap" },
				h("table", { className: "mrc-table" },
					h("thead", null, h("tr", null, head)),
					h("tbody", null, rows)));
		}
		//#endregion

		//#region pricing tab
		function PricingTab({ data, pricingRows, mutatePricing, removePricingRow, addPricingRow, onSave, saving }) {
			if (pricingRows === null) return h("div", { className: "mrc-empty" }, "加载定价规则…");
			const rows = pricingRows.patterns.map((pattern, i) => {
				const p = pricingRows.prices[i];
				return h("tr", { key: i }, [
					h("td", { key: "k" }, h("input", { className: "mrc-input mrc-patterninput", value: pattern, onChange: (e) => mutatePricing(i, "pattern", e.target.value) })),
					h("td", { key: "i" }, h("input", { className: "mrc-input mrc-priceinput", type: "number", step: "any", min: "0", value: p.input, onChange: (e) => mutatePricing(i, "input", e.target.value) })),
					h("td", { key: "o" }, h("input", { className: "mrc-input mrc-priceinput", type: "number", step: "any", min: "0", value: p.output, onChange: (e) => mutatePricing(i, "output", e.target.value) })),
					h("td", { key: "cr" }, h("input", { className: "mrc-input mrc-priceinput", type: "number", step: "any", min: "0", value: p.cacheRead, onChange: (e) => mutatePricing(i, "cacheRead", e.target.value) })),
					h("td", { key: "cw" }, h("input", { className: "mrc-input mrc-priceinput", type: "number", step: "any", min: "0", value: p.cacheWrite, onChange: (e) => mutatePricing(i, "cacheWrite", e.target.value) })),
					h("td", { key: "x" }, h("button", { className: "mrc-btn", onClick: () => removePricingRow(i) }, "删除")),
				]);
			});
			const head = ["匹配规则", "输入 $/M", "输出 $/M", "缓存读 $/M", "缓存写 $/M", ""]
				.map((label, i) => h("th", { key: i }, label));
			return h("div", null, [
				h("div", { key: "table", className: "mrc-tablewrap" },
					h("table", { className: "mrc-table" },
						h("thead", null, h("tr", null, head)),
						h("tbody", null, rows))),
				h("div", { key: "actions", className: "mrc-actions" }, [
					h("button", { key: "add", className: "mrc-btn", onClick: addPricingRow }, "＋ 添加规则"),
					h("button", { key: "save", className: "mrc-btn primary", disabled: saving, onClick: onSave }, saving ? "保存中…" : "保存定价"),
				]),
				h("p", { key: "hint", className: "mrc-hint" },
					"规则格式：provider/model 精确匹配、provider/* 供应商通配、* 兜底；价格为每百万 tokens 的美元数。保存后立即生效，并按新定价重新计算全部历史成本。"),
				h("p", { key: "scan", className: "mrc-hint" },
					"数据来源：自动扫描 " + data.scan.files + " 个会话文件（" + data.scan.sessions + " 个会话"
					+ ((data.scan.archived ?? 0) > 0 ? "，其中 " + data.scan.archived + " 个已归档——磁盘上已删除但统计保留" : "")
					+ "）；「重新扫描」重读磁盘上的会话文件并保留归档，「清除归档」删除已归档会话的统计数据。"
					+ "归档文档保存在 $DSH_HOME/model-usage-archive.json，定价文档保存在 $DSH_HOME/model-usage-pricing.json。"),
			]);
		}

		function providerChip(p, active, onClick) {
			return h("button", {
				key: p.provider, className: "mrc-chip", "data-active": active, onClick,
				title: p.provider + "：" + fmtInt(p.requests) + " 次请求 · " + fmtInt(p.tokens) + " tokens · " + fmtCost(p.cost),
			}, [
				p.provider,
				h("span", { key: "stats", className: "mrc-chipStats" },
					fmtInt(p.requests) + " 次 · " + fmtCompact(p.tokens) + (p.cost > 0 ? " · " + fmtCost(p.cost) : "")),
			]);
		}
		//#endregion

		//#region floating dock (shell.overlay)
		function UsageDock() {
			const [summary, setSummary] = useState(null);
			const [open, setOpen] = useState(false);
			const [error, setError] = useState("");
			const rootRef = useRef(null);
			const [visible, setVisible] = useState(dockVisiblePref);

			const load = useCallback(async () => {
				try {
					const resp = await fetch("/api/model-usage/summary");
					if (!resp.ok) throw new Error("HTTP " + resp.status);
					setSummary(await resp.json());
					setError("");
				} catch (e) {
					setError("加载失败：" + e.message);
				}
			}, []);

			useEffect(() => {
				if (!visible) return undefined;
				load();
				const timer = setInterval(load, 60000);
				return () => clearInterval(timer);
			}, [load, visible]);

			useEffect(() => {
				if (open) load();
			}, [open, load]);

			useEffect(() => {
				if (!open) return undefined;
				const onDown = (e) => {
					if (rootRef.current !== null && !rootRef.current.contains(e.target)) setOpen(false);
				};
				const onKey = (e) => {
					if (e.key === "Escape") setOpen(false);
				};
				document.addEventListener("mousedown", onDown);
				document.addEventListener("keydown", onKey);
				return () => {
					document.removeEventListener("mousedown", onDown);
					document.removeEventListener("keydown", onKey);
				};
			}, [open]);

			useEffect(() => {
				const onToggle = (e) => {
					setVisible(e.detail.visible);
					if (!e.detail.visible) setOpen(false);
				};
				window.addEventListener(DOCK_TOGGLE_EVENT, onToggle);
				return () => window.removeEventListener(DOCK_TOGGLE_EVENT, onToggle);
			}, []);

			if (!visible) return null;

			const pill = h("button", {
				className: "mrc-dockPill",
				"data-open": open,
				title: "今日模型用量（点击查看各供应商明细）",
				onClick: () => setOpen((v) => !v),
			}, [
				h("i", { key: "dot", className: "mrc-dockDot" }),
				summary === null
					? h("span", { key: "s" }, error === "" ? "今日用量…" : "今日用量不可用")
					: h("span", { key: "s" },
						h("b", null, "今日 ", fmtInt(summary.requests), " 次"),
						h("span", { className: "mrc-dockSub" }, " · ", fmtCompact(summary.tokens), " tok")),
			]);

			let panel = null;
			if (open) {
				const provRows = summary === null || summary.providers.length === 0
					? h("div", { key: "empty", className: "mrc-empty" }, summary === null ? "加载中…" : "今日暂无请求")
					: summary.providers.map((p) => {
						const segs = [
							[p.inputTokens, CHART_COLORS[0]],
							[p.outputTokens, CHART_COLORS[1]],
							[p.cacheWriteTokens, CHART_COLORS[2]],
							[p.cacheReadTokens, CHART_COLORS[3]],
						].filter(([v]) => v > 0);
						const approx = fmtApprox(p.tokens);
						return h("div", { key: p.provider, className: "mrc-dockProv" }, [
							h("div", { key: "top", className: "mrc-dockProvTop" }, [
								h("span", { key: "n", className: "mrc-dockProvName", title: p.provider }, p.provider),
								h("span", { key: "s", className: "mrc-dockProvStats" },
									fmtInt(p.requests) + " 次 · " + p.models + " 模型" + (p.cost > 0 ? " · " + fmtCost(p.cost) : "")),
							]),
							h("div", { key: "tok", className: "mrc-dockProvTokens" },
								fmtInt(p.tokens),
								approx === "" ? null : h("span", { className: "mrc-approx-inline" }, " " + approx)),
							h("div", { key: "d", className: "mrc-dockProvDetail" },
								"输入 " + fmtCompact(p.inputTokens) + " · 输出 " + fmtCompact(p.outputTokens)
								+ " · 命中 " + fmtCompact(p.cacheReadTokens) + " · 创建 " + fmtCompact(p.cacheWriteTokens)),
							h("div", { key: "bar", className: "mrc-dockBar" },
								segs.map(([v, c], i) => h("i", { key: i, style: { width: (v / Math.max(1, p.tokens)) * 100 + "%", background: c } }))),
						]);
					});
				const approx = summary === null ? "" : fmtApprox(summary.tokens);
				panel = h("div", { className: "mrc-dockPanel" }, [
					h("div", { key: "head", className: "mrc-dockHead" }, [
						h("span", { key: "t", className: "mrc-dockTitle" }, "今日模型用量"),
						h("button", { key: "r", className: "mrc-btn", title: "刷新", onClick: load }, "↻"),
						h("button", { key: "x", className: "mrc-btn", title: "关闭", onClick: () => setOpen(false) }, "×"),
					]),
					error ? h("p", { key: "err", className: "mrc-err" }, error) : null,
					summary !== null ? h("div", { key: "total", className: "mrc-dockTotal" }, [
						h("b", { key: "n" }, fmtInt(summary.requests)), " 次请求 · ",
						h("b", { key: "tk" }, fmtInt(summary.tokens)), " tokens",
						approx === "" ? null : "（" + approx + "）",
						summary.cost > 0 ? " · 成本 " + fmtCost(summary.cost) : "",
						h("div", { key: "d", className: "mrc-dockSub" }, summary.date),
					]) : null,
					h("div", { key: "provs" }, provRows),
					h("div", { key: "foot", className: "mrc-dockFoot" }, [
						h("span", { key: "hint", className: "mrc-dockHint" }, "每分钟自动刷新"),
						h("button", {
							key: "open", className: "mrc-btn",
							title: "打开完整统计面板（桌面版在当前窗口打开）",
							onClick: openUsagePage,
						}, "打开完整统计 ↗"),
					]),
				]);
			}

			return h("div", { ref: rootRef, className: "mrc-dock" }, [pill, panel]);
		}
		//#endregion

		//#region section component
		function UsageSection() {
			const [data, setData] = useState(null);
			const [error, setError] = useState("");
			const [tab, setTab] = useState("log");
			const [providerFilter, setProviderFilter] = useState("");
			const [pricingRows, setPricingRows] = useState(null);
			const [saving, setSaving] = useState(false);
			const [dockVisible, setDockVisibleState] = useState(dockVisiblePref);
			const [rangeMode, setRangeMode] = useState(false);
			const [from, setFrom] = useState(fmtLocalDate(new Date()));
			const [to, setTo] = useState(fmtLocalDate(new Date()));

			const load = useCallback(async (opts) => {
				const params = new URLSearchParams();
				if (opts && opts.date) params.set("date", opts.date);
				if (opts && opts.from) params.set("from", opts.from);
				if (opts && opts.to) params.set("to", opts.to);
				if (opts && opts.rescan) params.set("rescan", "1");
				if (opts && opts.purgeArchive) params.set("purgeArchive", "1");
				const qs = params.toString();
				try {
					const resp = await fetch("/api/model-usage" + (qs ? "?" + qs : ""));
					if (!resp.ok) throw new Error("HTTP " + resp.status);
					setData(await resp.json());
					setError("");
					setPricingRows(null);
				} catch (e) {
					setError("加载失败：" + e.message);
				}
			}, []);

			useEffect(() => { load(); }, [load]);

			const currentQuery = () => {
				if (rangeMode) return { from, to };
				return { date: data ? data.date : undefined };
			};
			const refresh = () => load(currentQuery());
			const rescan = () => load(Object.assign({ rescan: true }, currentQuery()));
			const purgeArchive = () => {
				const archived = (data && data.scan && data.scan.archived) || 0;
				if (!window.confirm("确定清除已归档的统计数据？（磁盘上已删除的 " + archived + " 个会话）此操作不可恢复。")) return;
				load(Object.assign({ purgeArchive: true }, currentQuery()));
			};

			const shiftDay = useCallback((delta) => {
				if (!data || rangeMode) return;
				const d = new Date(data.date + "T12:00:00");
				d.setDate(d.getDate() + delta);
				load({ date: fmtLocalDate(d) });
			}, [data, rangeMode, load]);

			const quickRange = (daysAgo) => {
				const end = new Date();
				const start = new Date();
				start.setDate(start.getDate() - (daysAgo - 1));
				const f = fmtLocalDate(start);
				const t = fmtLocalDate(end);
				setFrom(f);
				setTo(t);
				setRangeMode(true);
				load({ from: f, to: t });
			};

			const exportData = async (scope, format) => {
				try {
					await downloadExport(scope, format, currentQuery());
				} catch (e) {
					setError("导出失败：" + e.message);
				}
			};

			const savePricing = useCallback(async () => {
				if (!pricingRows) return;
				const rules = {};
				pricingRows.patterns.forEach((pattern, i) => {
					const key = pattern.trim();
					if (key === "") return;
					rules[key] = pricingRows.prices[i];
				});
				if (Object.keys(rules).length === 0) {
					setError("至少需要一条定价规则");
					return;
				}
				setSaving(true);
				try {
					const resp = await fetch("/api/model-usage/pricing", {
						method: "PUT",
						headers: { "content-type": "application/json" },
						body: JSON.stringify(rules),
					});
					if (!resp.ok) throw new Error("HTTP " + resp.status);
					await load(currentQuery());
				} catch (e) {
					setError("保存失败：" + e.message);
				} finally {
					setSaving(false);
				}
			}, [pricingRows, data, load, rangeMode, from, to]);

			useEffect(() => {
				if (tab === "settings" && pricingRows === null && data !== null) {
					setPricingRows({
						patterns: Object.keys(data.pricing),
						prices: Object.entries(data.pricing).map(([, prices]) => ({ ...prices })),
					});
				}
			}, [tab, pricingRows, data]);

			const mutatePricing = useCallback((i, field, value) => {
				setPricingRows((rows) => {
					if (rows === null) return rows;
					const next = { patterns: [...rows.patterns], prices: rows.prices.map((p) => ({ ...p })) };
					if (field === "pattern") next.patterns[i] = value;
					else next.prices[i][field] = Number(value) || 0;
					return next;
				});
			}, []);

			const removePricingRow = useCallback((i) => {
				setPricingRows((rows) => rows === null ? rows : {
					patterns: rows.patterns.filter((_, at) => at !== i),
					prices: rows.prices.filter((_, at) => at !== i),
				});
			}, []);

			const addPricingRow = useCallback(() => {
				setPricingRows((rows) => rows === null ? rows : {
					patterns: [...rows.patterns, "*"],
					prices: [...rows.prices, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }],
				});
			}, []);

			if (data === null) {
				return h("div", { className: "mrc-section" },
					error ? h("p", { className: "mrc-err" }, error) : h("div", { className: "mrc-empty" }, "加载中…"));
			}

			const entries = providerFilter === ""
				? data.entries
				: data.entries.filter((e) => e.provider === providerFilter);
			const providers = groupProviders(data.entries);
			const emptyLabel = rangeMode
				? (providerFilter === "" ? "该范围无请求数据" : "该供应商在该范围无请求")
				: (providerFilter === "" ? "当日无请求数据" : "该供应商当日无请求");
			const t = rangeMode && providerFilter === "" ? data.totals : dayTotals(entries);
			const totalTokens = t.inputTokens + t.outputTokens + t.cacheReadTokens + t.cacheWriteTokens;
			const hitRate = (t.inputTokens + t.cacheReadTokens) > 0
				? (t.cacheReadTokens / (t.inputTokens + t.cacheReadTokens) * 100).toFixed(1) + "%"
				: "—";

			const sortedDays = Object.entries(data.days).sort((a, b) => (a[0] < b[0] ? -1 : 1));
			const rangeLabel = rangeMode && data.from && data.to ? data.from + " ~ " + data.to : "";

			const card = (label, value, approx) => h("div", { className: "mrc-card" },
				h("div", { className: "mrc-label" }, label),
				h("div", { className: "mrc-value" }, value),
				approx ? h("div", { className: "mrc-approx" }, approx) : null);

			const modeChip = (label, active, onClick) =>
				h("button", { key: label, className: "mrc-chip", "data-active": active, onClick }, label);

			const onFromChange = (e) => {
				const v = e.target.value;
				setFrom(v);
				if (v && to && v <= to) load({ from: v, to });
			};
			const onToChange = (e) => {
				const v = e.target.value;
				setTo(v);
				if (from && v && from <= v) load({ from, to: v });
			};

			const dateControls = rangeMode
				? h("span", { key: "range", className: "mrc-dateStack" }, [
					h("input", { key: "from", className: "mrc-input", type: "date", value: from, onChange: onFromChange }),
					h("span", { key: "sep" }, "~"),
					h("input", { key: "to", className: "mrc-input", type: "date", value: to, onChange: onToChange }),
					h("button", { key: "q7", className: "mrc-btn", onClick: () => quickRange(7) }, "近7天"),
					h("button", { key: "q30", className: "mrc-btn", onClick: () => quickRange(30) }, "近30天"),
				])
				: [
					h("button", { key: "prev", className: "mrc-btn", title: "前一天", onClick: () => shiftDay(-1) }, "←"),
					h("input", { key: "date", className: "mrc-input", type: "date", value: data.date, onChange: (e) => load({ date: e.target.value }) }),
					h("button", { key: "next", className: "mrc-btn", title: "后一天", onClick: () => shiftDay(1) }, "→"),
				];

			return h("div", { className: "mrc-section" }, [
				h("div", { key: "tools", className: "mrc-tools" }, [
					h("span", { key: "title", className: "mrc-title" }, "模型使用统计"),
					modeChip("单日", !rangeMode, () => { if (rangeMode) { setRangeMode(false); load({ date: data.date }); } }),
					modeChip("范围", rangeMode, () => { if (!rangeMode) { setRangeMode(true); load({ from, to }); } }),
				].concat(dateControls).concat([
					h("button", { key: "refresh", className: "mrc-btn", onClick: refresh }, "刷新"),
					h("button", { key: "rescan", className: "mrc-btn", onClick: rescan }, "重新扫描"),
					h("button", {
						key: "purge", className: "mrc-btn",
						title: "删除已归档（磁盘上已删除会话）的统计数据，不可恢复",
						disabled: !data || !data.scan || !data.scan.archived,
						onClick: purgeArchive,
					}, "清除归档"),
					h("span", { key: "export", className: "mrc-export" }, [
						h("button", { key: "csv", className: "mrc-btn", title: "导出请求日志为 CSV", onClick: () => exportData("log", "csv") }, "导出 CSV"),
						h("button", { key: "json", className: "mrc-btn", title: "导出请求日志为 JSON", onClick: () => exportData("log", "json") }, "导出 JSON"),
					]),
				])),
				error ? h("p", { key: "err", className: "mrc-err" }, error) : null,
				rangeLabel !== "" ? h("p", { key: "range", className: "mrc-hint" }, "统计范围：" + rangeLabel) : null,
				h("div", { key: "providers", className: "mrc-providers" }, [
					h("button", {
						key: "__all", className: "mrc-chip", "data-active": providerFilter === "",
						onClick: () => setProviderFilter(""),
					}, "全部供应商"),
					...providers.map((p) => providerChip(
						p,
						p.provider === providerFilter,
						() => setProviderFilter(p.provider === providerFilter ? "" : p.provider),
					)),
				]),
				h("div", { key: "cards", className: "mrc-cards" }, [
					card("真实消耗 Tokens", fmtInt(totalTokens), fmtApprox(totalTokens)),
					card("总请求数", fmtInt(t.requests)),
					card("总成本", fmtCost(t.cost)),
					card("输入 Tokens", fmtInt(t.inputTokens), fmtApprox(t.inputTokens)),
					card("输出 Tokens", fmtInt(t.outputTokens), fmtApprox(t.outputTokens)),
					card("缓存创建", fmtInt(t.cacheWriteTokens), fmtApprox(t.cacheWriteTokens)),
					card("缓存命中", fmtInt(t.cacheReadTokens), fmtApprox(t.cacheReadTokens)),
					card("缓存命中率", hitRate),
				]),
				h("div", { key: "chart", className: "mrc-panel" }, [
					h("h3", { key: "title" }, rangeMode ? "使用趋势（按天）" : "使用趋势（按小时）"),
					rangeMode
						? h(DailyChart, { key: "svg", days: sortedDays, emptyLabel })
						: h(Chart, { key: "svg", entries, emptyLabel }),
					h("div", { key: "legend", className: "mrc-legend" }, [
						h("span", { key: "c" }, h("i", { className: "mrc-dot", style: { background: COST_COLOR } }), "成本"),
						h("span", { key: "cw" }, h("i", { className: "mrc-dot", style: { background: CHART_COLORS[2] } }), "缓存创建"),
						h("span", { key: "cr" }, h("i", { className: "mrc-dot", style: { background: CHART_COLORS[3] } }), "缓存命中"),
						h("span", { key: "i" }, h("i", { className: "mrc-dot", style: { background: CHART_COLORS[0] } }), "输入 Token"),
						h("span", { key: "o" }, h("i", { className: "mrc-dot", style: { background: CHART_COLORS[1] } }), "输出 Token"),
					]),
				]),
				h("div", { key: "tabs", className: "mrc-tabs" }, [
					h("button", { key: "log", className: "mrc-tab", "data-active": tab === "log", onClick: () => setTab("log") }, "请求日志"),
					h("button", { key: "models", className: "mrc-tab", "data-active": tab === "models", onClick: () => setTab("models") }, "按模型汇总"),
					h("button", { key: "settings", className: "mrc-tab", "data-active": tab === "settings", onClick: () => setTab("settings") }, "设置"),
				]),
				h("div", { key: "body", className: tab === "settings" ? "mrc-settingsStack" : "mrc-panel" },
					tab === "log" ? h(LogTable, { entries, emptyLabel })
						: tab === "models" ? h(ModelsTable, { entries, emptyLabel })
							: [
								h("div", { key: "ui", className: "mrc-panel" }, [
									h("h3", { key: "t" }, "界面"),
									h("label", { key: "row", className: "mrc-toggleRow" }, [
										h("input", {
											key: "cb", type: "checkbox", checked: dockVisible,
											onChange: (e) => {
												const next = e.target.checked;
												setDockVisibleState(next);
												setDockVisiblePref(next);
											},
										}),
										h("span", { key: "lbl" }, "在主界面显示悬浮用量入口（右下角「今日 N 次」胶囊）"),
									]),
									h("p", { key: "hint", className: "mrc-hint" },
										"关闭后主界面右下角不再显示悬浮入口，立即生效；本统计面板不受影响，随时可重新打开。"),
								]),
								h("div", { key: "price", className: "mrc-panel" }, [
									h("h3", { key: "t" }, "成本定价"),
									h(PricingTab, { key: "pt", data, pricingRows, mutatePricing, removePricingRow, addPricingRow, onSave: savePricing, saving }),
								]),
							]),
			]);
		}
		//#endregion

		//#region plugin face
		const inject = ["slots"];

		function apply(ctx) {
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "model-usage",
				order: 20,
				label: () => "使用统计",
			}, UsageSection));

			ctx.slots.inject("shell.overlay", () => ctx.slots.register({
				name: "shell.overlay",
				id: "model-usage-dock",
				order: 100,
				label: () => "模型用量",
			}, UsageDock));
		}

		exports.UsageSection = UsageSection;
		exports.UsageDock = UsageDock;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});
