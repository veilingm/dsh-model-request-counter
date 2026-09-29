/**
 * Projection unit for per-model (provider/model) request counts: one durable,
 * replayable fold over Session events that increments a counter per
 * `assistant/message` and `assistant/attempt` event.
 *
 * @module dsh-model-request-counter/types
 */
import { z } from "zod";

// ── route key builder ──────────────────────────────────────────────────────
/**
 * Build a stable route key from provider and model ids.
 * `\0` cannot appear in a package name or a model id, so it is a
 * consumer-decoupled delimiter that survives sync'ing.
 */
function routeKey(provider, model) {
  return `${provider}\x00${model}`;
}

/**
 * Parse a stable route key into its provider and model components.
 * Values stored before this key was introduced have exactly one `\0` separator.
 */
function parseRouteKey(key) {
  const index = key.indexOf("\0");
  if (index === -1) return { provider: key, model: "?" };
  return { provider: key.slice(0, index), model: key.slice(index + 1) };
}

// ── schemas ─────────────────────────────────────────────────────────────────

/** Wire view: flat record of route-key → request count. */
const modelRequestCountsWireSchema = z
  .object({
    counts: z.record(z.string(), z.number().int().nonnegative()),
  })
  .strict();

/**
 * Internal state carries the current request-header route so failed attempts
 * (which lack their own provider/model) can still be attributed.
 */
const modelRequestCountsStateSchema = modelRequestCountsWireSchema.extend({
  currentProvider: z.string().nullable(),
  currentModel: z.string().nullable(),
});

// ── projection definition ───────────────────────────────────────────────────

export const modelRequestCountsProjectionDefinition = {
  key: "modelRequestCounts",
  stateVersion: 1,
  stateSchema: modelRequestCountsStateSchema,
  init: () => ({
    counts: {},
    currentProvider: null,
    currentModel: null,
  }),
  apply(state, event) {
    switch (event.type) {
      case "request/header": {
        const config = event.data.header.config;
        const provider =
          typeof config.provider === "string" ? config.provider : null;
        const model =
          typeof config.model === "string" ? config.model : null;
        if (
          provider === state.currentProvider &&
          model === state.currentModel
        ) {
          return state;
        }
        return { ...state, currentProvider: provider, currentModel: model };
      }
      case "assistant/message": {
        const source = event.data.message.source;
        const key = routeKey(source.provider, source.model);
        const prev = state.counts[key] ?? 0;
        return {
          ...state,
          counts: { ...state.counts, [key]: prev + 1 },
        };
      }
      case "assistant/attempt": {
        // Failed HTTP dispatch — attribute to the current header route.
        if (state.currentProvider === null || state.currentModel === null) {
          return state;
        }
        const key = routeKey(state.currentProvider, state.currentModel);
        const prev = state.counts[key] ?? 0;
        return {
          ...state,
          counts: { ...state.counts, [key]: prev + 1 },
        };
      }
      default:
        return state;
    }
  },
  wire: {
    viewSchema: modelRequestCountsWireSchema,
    view(state) {
      return { counts: state.counts };
    },
  },
};

// ── helpers for consumers ───────────────────────────────────────────────────

/**
 * Sort entries by total requests descending, then provider, then model.
 */
export function sortedEntries(counts) {
  return Object.entries(counts)
    .map(([key, requests]) => ({ ...parseRouteKey(key), key, requests }))
    .sort((a, b) =>
      b.requests - a.requests ||
      a.provider.localeCompare(b.provider) ||
      a.model.localeCompare(b.model),
    );
}