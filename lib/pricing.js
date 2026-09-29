/**
 * Cost pricing for the usage dashboard: per-model token billing rules
 * (USD per million tokens), persisted as a user-editable JSON document at
 * $DSH_HOME/model-usage-pricing.json over built-in defaults.
 *
 * Rule matching: exact "provider/model" first, then "provider/*", then "*".
 *
 * @module dsh-model-request-counter/pricing
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

/** The Harness home directory (matches dsh-home-paths' default). */
export function dshHome() {
  return process.env.DSH_HOME ?? join(homedir(), ".dsh");
}

/** The pricing document path. */
export function pricingPath() {
  return join(dshHome(), "model-usage-pricing.json");
}

/** Built-in pricing defaults (USD per million tokens). */
export const DEFAULT_PRICING = {
  "deepseek-official/deepseek-chat": { input: 0.28, output: 0.42, cacheRead: 0.028, cacheWrite: 0.28 },
  "deepseek-official/deepseek-reasoner": { input: 0.55, output: 2.19, cacheRead: 0.14, cacheWrite: 0.55 },
  "deepseek-official/*": { input: 0.28, output: 0.42, cacheRead: 0.028, cacheWrite: 0.28 },
  "*": { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};

const ZERO = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

/**
 * Load the effective pricing rules: the user document when present and valid,
 * otherwise the built-in defaults.
 * @returns the rules map (pattern → per-million prices).
 */
export async function loadPricing() {
  try {
    const text = await readFile(pricingPath(), "utf8");
    const parsed = JSON.parse(text);
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      const rules = {};
      for (const [pattern, prices] of Object.entries(parsed)) {
        if (typeof pattern !== "string" || pattern === "") continue;
        if (prices === null || typeof prices !== "object" || Array.isArray(prices)) continue;
        rules[pattern] = {
          input: num(prices.input),
          output: num(prices.output),
          cacheRead: num(prices.cacheRead),
          cacheWrite: num(prices.cacheWrite),
        };
      }
      if (Object.keys(rules).length > 0) return rules;
    }
  } catch {
    // Absent or unreadable document — fall through to defaults.
  }
  return { ...DEFAULT_PRICING };
}

/**
 * Validate and persist the pricing rules document.
 * @param value - the parsed request body (a rules map).
 * @returns the saved rules.
 * @throws when the body is not a non-empty rules map.
 */
export async function savePricing(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("pricing body must be a JSON object of pattern → prices");
  }
  const rules = {};
  for (const [pattern, prices] of Object.entries(value)) {
    if (typeof pattern !== "string" || pattern === "") throw new Error(`invalid pricing pattern ${JSON.stringify(pattern)}`);
    if (prices === null || typeof prices !== "object" || Array.isArray(prices)) {
      throw new Error(`pricing pattern ${JSON.stringify(pattern)} must map to a prices object`);
    }
    rules[pattern] = {
      input: num(prices.input),
      output: num(prices.output),
      cacheRead: num(prices.cacheRead),
      cacheWrite: num(prices.cacheWrite),
    };
  }
  if (Object.keys(rules).length === 0) throw new Error("pricing body must contain at least one rule");
  await mkdir(dshHome(), { recursive: true });
  await writeFile(pricingPath(), `${JSON.stringify(rules, null, 2)}\n`, "utf8");
  return rules;
}

/**
 * Resolve the pricing rule for one provider/model route.
 * @param rules - the effective rules map.
 * @param provider - the entry's provider id.
 * @param model - the entry's model id.
 * @returns the matching prices (zero when no rule matches).
 */
export function matchRule(rules, provider, model) {
  return rules[`${provider}/${model}`] ?? rules[`${provider}/*`] ?? rules["*"] ?? ZERO;
}

/**
 * Compute one entry's cost in USD under the given rules.
 * @param rules - the effective rules map.
 * @param entry - one usage entry.
 * @returns the cost in USD.
 */
export function entryCost(rules, entry) {
  const rule = matchRule(rules, entry.provider, entry.model);
  return (entry.inputTokens / 1e6) * rule.input
    + (entry.outputTokens / 1e6) * rule.output
    + (entry.cacheReadTokens / 1e6) * rule.cacheRead
    + (entry.cacheWriteTokens / 1e6) * rule.cacheWrite;
}

/** Coerce one price field to a finite non-negative number. */
function num(value) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}