// Tiered-league math for the public physique leaderboard (Phase 20).
//
// The board ranks athletes by FFMI (fat-free mass index = lean mass / height²) computed
// from their LATEST coach-VERIFIED InBody. The DB (0045) returns the FFMI number; the
// tier BANDS live here so they stay tunable without a migration. Bands are sex-specific
// (men and women have different body-composition norms) and are a product heuristic —
// NOT a security boundary (the anti-cheat boundary is verified-only metrics in 0045).
import { getMyAthleteProfile } from './athlete-profile';
import { listBodyMetrics } from './body-metrics';
import { tier } from '../theme';
import type { Sex } from '../schemas/athlete-profile';

// Bronze (entry) → Apex (top). Order matters: index = relative rank of the tier.
export const TIERS = [
  'bronze',
  'silver',
  'gold',
  'platinum',
  'diamond',
  'master',
  'grandmaster',
  'apex',
] as const;
export type TierId = (typeof TIERS)[number];

// Lower-bound FFMI for each tier, per sex (highest first for the lookup). An athlete is
// placed in the highest tier whose threshold they meet. Women's bands sit ~3.5 FFMI below
// men's. Natural FFMI tops out around 25 (men) — Apex is deliberately elite.
const FFMI_BANDS: Record<Sex, { tier: TierId; min: number }[]> = {
  male: [
    { tier: 'apex', min: 25 },
    { tier: 'grandmaster', min: 23.5 },
    { tier: 'master', min: 22 },
    { tier: 'diamond', min: 21 },
    { tier: 'platinum', min: 20 },
    { tier: 'gold', min: 19 },
    { tier: 'silver', min: 18 },
    { tier: 'bronze', min: 0 },
  ],
  female: [
    { tier: 'apex', min: 21.5 },
    { tier: 'grandmaster', min: 20 },
    { tier: 'master', min: 18.5 },
    { tier: 'diamond', min: 17.5 },
    { tier: 'platinum', min: 16.5 },
    { tier: 'gold', min: 15.5 },
    { tier: 'silver', min: 14.5 },
    { tier: 'bronze', min: 0 },
  ],
};

// Accent color per tier — the single source of truth is the brand `theme.tier`
// ramp (Bronze → Apex). Never hardcode a tier hex (brand rule).
export const TIER_COLORS: Record<TierId, string> = tier;

/**
 * FFMI from verified body-comp + height — mirrors the SQL in migration 0045 exactly
 * (weight_grams → kg, body_fat_bp → fraction, height_cm → m), rounded to 1 decimal.
 * Returns null if any input is missing so callers can show a "needs a reading" state.
 */
export function computeFfmi(
  weightGrams?: number | null,
  bodyFatBp?: number | null,
  heightCm?: number | null,
): number | null {
  if (!weightGrams || bodyFatBp == null || !heightCm) return null;
  const leanKg = (weightGrams / 1000) * (1 - bodyFatBp / 10000);
  const heightM = heightCm / 100;
  if (heightM <= 0) return null;
  return Math.round((leanKg / (heightM * heightM)) * 10) / 10;
}

/** Map an FFMI to its league tier for the given sex (highest tier whose min is met). */
export function ffmiTier(ffmi: number, sex: Sex): TierId {
  for (const band of FFMI_BANDS[sex]) {
    if (ffmi >= band.min) return band.tier;
  }
  return 'bronze';
}

export type LeagueStanding = {
  sex: Sex | null;
  ffmi: number | null;
  tier: TierId | null;
  hasVerifiedReading: boolean; // a verified InBody WITH a body-fat number exists
  optedIn: boolean; // leaderboard_opt_in
  isPublic: boolean; // is_public (required for the board to link to a profile)
};

/**
 * The signed-in athlete's OWN league standing — computed app-side from their own data
 * (no RPC needed; RLS already lets a user read their own profile + verified metrics).
 * Powers the Home CTA ("You're Gold tier" / "Log a verified InBody" / "Opt in to compete")
 * shown even before opting in. Reuses the same FFMI math as the board so the number agrees.
 */
export async function getMyLeagueStanding(userId: string): Promise<LeagueStanding> {
  const [profile, metrics] = await Promise.all([getMyAthleteProfile(userId), listBodyMetrics(userId)]);
  // listBodyMetrics returns verified rows oldest→newest; take the latest WITH a body-fat reading.
  const latest = [...metrics].reverse().find((m) => m.body_fat_bp != null) ?? null;
  const ffmi = computeFfmi(latest?.weight_grams, latest?.body_fat_bp, profile?.height_cm);
  const sex = profile?.sex ?? null;
  return {
    sex,
    ffmi,
    tier: ffmi != null && sex ? ffmiTier(ffmi, sex) : null,
    hasVerifiedReading: latest != null,
    optedIn: profile?.leaderboard_opt_in ?? false,
    isPublic: profile?.is_public ?? false,
  };
}
