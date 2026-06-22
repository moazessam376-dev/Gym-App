// Weight unit conversions. Load is ALWAYS stored as integer grams (money.md
// discipline); these helpers only translate to/from the athlete's display unit.
import type { WeightUnit } from '../schemas/athlete-profile';

export type { WeightUnit } from '../schemas/athlete-profile';

const GRAMS_PER_LB = 453.59237;

/** Parse a display-unit weight string → canonical integer grams (null if blank/invalid). */
export function displayToGrams(value: string, unit: WeightUnit): number | null {
  const n = Number(value.trim());
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(unit === 'kg' ? n * 1000 : n * GRAMS_PER_LB);
}

/** Integer grams → a display-unit number rounded to 1 decimal (null if no value). */
export function gramsToDisplay(grams: number | null | undefined, unit: WeightUnit): number | null {
  if (grams == null) return null;
  const v = unit === 'kg' ? grams / 1000 : grams / GRAMS_PER_LB;
  return Math.round(v * 10) / 10;
}

/** Display-unit input string for grams (empty string when there's no value). */
export function gramsToInput(grams: number | null | undefined, unit: WeightUnit): string {
  const v = gramsToDisplay(grams, unit);
  return v == null ? '' : String(v);
}

/** "60 kg" / "—" for read-only display. */
export function formatWeight(grams: number | null | undefined, unit: WeightUnit): string {
  const v = gramsToDisplay(grams, unit);
  return v == null ? '—' : `${v} ${unit}`;
}

/** Convert a display string between units, preserving the underlying weight. */
export function convertDisplay(value: string, from: WeightUnit, to: WeightUnit): string {
  if (from === to || value.trim() === '') return value;
  return gramsToInput(displayToGrams(value, from), to);
}
