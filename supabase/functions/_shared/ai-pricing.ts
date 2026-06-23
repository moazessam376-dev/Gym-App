// AI cost pricing (Phase 14c). List prices (USD per 1,000,000 tokens) used ONLY to
// compute the integer micro-USD cost stored in ai_usage_events.cost_micros. The
// stored value is an integer (money discipline §6); these float rates are just
// conversion factors, like an FX rate. Update when a provider changes pricing.
// An unpriced model returns null cost — we never pretend a call was free.

/** Token usage + the model that served a single AI call (from the provider response). */
export type AiUsage = {
  model: string;
  tokensIn: number | null;
  tokensOut: number | null;
};

type Price = { inPerMTok: number; outPerMTok: number };

const PRICES: Record<string, Price> = {
  // Anthropic (launch provider). Claude Sonnet 4.6 list price.
  'claude-sonnet-4-6': { inPerMTok: 3, outPerMTok: 15 },
  // Groq (free pilot) — Llama 4 Scout. Free tier today; the list price is kept so
  // cost_micros reflects true unit economics regardless of the free pilot.
  'meta-llama/llama-4-scout-17b-16e-instruct': { inPerMTok: 0.11, outPerMTok: 0.34 },
};

function priceFor(model: string): Price | null {
  if (PRICES[model]) return PRICES[model];
  // Tolerate a version suffix/prefix drift in the provider-returned model id.
  for (const key of Object.keys(PRICES)) {
    if (model.startsWith(key) || key.startsWith(model)) return PRICES[key];
  }
  return null;
}

/**
 * Integer micro-USD (1e-6 USD) cost of a call, or null if the model isn't priced.
 * micro-USD = tokens/1e6 * USD_per_Mtok * 1e6 = tokens * USD_per_Mtok.
 */
export function costMicros(
  model: string | null,
  tokensIn: number | null,
  tokensOut: number | null,
): number | null {
  if (!model) return null;
  const p = priceFor(model);
  if (!p) return null;
  return Math.round((tokensIn ?? 0) * p.inPerMTok + (tokensOut ?? 0) * p.outPerMTok);
}
