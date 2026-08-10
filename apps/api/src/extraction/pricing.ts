/**
 * What a model call costs, so a catalogue-wide run can be budgeted before it is
 * started rather than explained afterwards (#30).
 *
 * Pure and table-shaped, like `backoff.ts` and `link-liveness.ts`: the whole
 * decision is a rate lookup and two multiplications, and it wants to be
 * readable without a network.
 *
 * **A model we have no rate for gets no dollar figure.** Not zero — zero reads
 * as "this run was free", which is a worse answer than "we cannot tell you",
 * and this project has already been bitten once by a fabricated label (#24).
 * Token counts are exact and always reported; money is an estimate and is
 * withheld when the estimate would be invented.
 */

/** Anthropic's published per-million-token rates for the models we call. */
export interface ModelRates {
  inputUsdPerMTok: number;
  outputUsdPerMTok: number;
}

/**
 * Rates as published, with the date they were checked.
 *
 * Deliberately not fetched at runtime: a budget that changes under an operator
 * mid-run is not a budget. When these go stale the fix is to edit this table
 * and move `checkedOn`, which is a reviewable change rather than a silent one.
 *
 * Only the models this project realistically calls. Adding one is a line here;
 * calling one that is missing costs a dollar figure, not correctness.
 */
export const RATES_USD_PER_MTOK = {
  checkedOn: '2026-08-10',
  source: 'https://platform.claude.com/docs/en/pricing',
  models: {
    'claude-haiku-4-5': { inputUsdPerMTok: 1, outputUsdPerMTok: 5 },
    'claude-sonnet-5': { inputUsdPerMTok: 3, outputUsdPerMTok: 15 },
    'claude-opus-4-8': { inputUsdPerMTok: 5, outputUsdPerMTok: 25 },
    'claude-opus-5': { inputUsdPerMTok: 5, outputUsdPerMTok: 25 },
  } as Record<string, ModelRates>,
} as const;

/** What one model costs per million tokens, or null if we hold no rate. */
export function ratesFor(model: string): ModelRates | null {
  return RATES_USD_PER_MTOK.models[model.trim().toLowerCase()] ?? null;
}

export interface TokenCount {
  inputTokens: number;
  outputTokens: number;
}

export interface Cost {
  inputUsd: number;
  outputUsd: number;
  totalUsd: number;
}

/**
 * What those tokens cost on that model, or null when we hold no rate for it.
 *
 * Cache reads and writes are deliberately not modelled. Each Brand is drafted
 * in one short call with no shared prefix worth caching, so there is nothing
 * for a cache line to be right about — and a cost model with a term that is
 * always zero invites someone to trust it for a workload where it is not.
 */
export function costOf(model: string, tokens: TokenCount): Cost | null {
  const rates = ratesFor(model);
  if (!rates) return null;

  const inputUsd = (tokens.inputTokens / 1_000_000) * rates.inputUsdPerMTok;
  const outputUsd = (tokens.outputTokens / 1_000_000) * rates.outputUsdPerMTok;
  return { inputUsd, outputUsd, totalUsd: inputUsd + outputUsd };
}
