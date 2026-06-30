// Achievement catalog (Engagement E1). The DB (0073) stores only which achievement_keys a
// user has earned; the presentation — title, description, icon, rarity tint — lives HERE so
// it stays tunable without a migration (same philosophy as the league bands in leagues.ts).
//
// Two kinds of "achievement" exist in the app:
//   * SYSTEM-MINTED trophies (this file) — earned automatically by progressing; unlimited.
//   * SELF-ASSIGNED notes (athlete_profile.public_achievements / coach_profile.achievements)
//     — user-typed free text, capped at 3 (0074). Those are NOT in this catalog.
//
// Body-derived trophies (bodyDerived: true) reveal body-composition progress, so on a public
// profile they are gated behind share_body_metrics_publicly (enforced server-side in 0073's
// get_public_app_achievements; mirror the flag here for any client-side filtering/labelling).
import type { IconName } from '@/components/ui/Icon';

// Visual rarity tint of the trophy badge (PlayStation-style bronze→platinum). This is the
// trophy's prestige, distinct from the FFMI league TierId in leagues.ts.
export type AchievementRarity = 'bronze' | 'silver' | 'gold' | 'platinum';

export interface AchievementDef {
  key: string;
  /** i18n key: achievements.<key>.title */
  titleKey: string;
  /** i18n key: achievements.<key>.desc */
  descKey: string;
  icon: IconName;
  rarity: AchievementRarity;
  /** Reveals body-composition progress → share-gated on public profiles. */
  bodyDerived?: boolean;
}

const def = (
  key: string,
  icon: IconName,
  rarity: AchievementRarity,
  bodyDerived = false,
): AchievementDef => ({
  key,
  titleKey: `achievements.${key}.title`,
  descKey: `achievements.${key}.desc`,
  icon,
  rarity,
  bodyDerived,
});

// Order = display order in the trophy grid (grouped: volume → streak → PRs → body → league).
export const ACHIEVEMENTS: AchievementDef[] = [
  // Volume
  def('first_workout', 'flag-outline', 'bronze'),
  def('workouts_10', 'barbell-outline', 'bronze'),
  def('workouts_50', 'barbell', 'silver'),
  def('workouts_100', 'trophy', 'gold'),
  // Streak
  def('streak_7', 'flame', 'bronze'),
  def('streak_30', 'flame', 'silver'),
  def('streak_100', 'flash', 'platinum'),
  // PRs
  def('pr_first', 'trending-up-outline', 'bronze'),
  def('pr_10', 'trending-up', 'silver'),
  def('pr_25', 'ribbon', 'gold'),
  // Body composition (all share-gated)
  def('first_inbody', 'body-outline', 'bronze', true),
  def('inbody_10', 'body', 'silver', true),
  def('body_fat_drop_1', 'trending-down', 'bronze', true),
  def('body_fat_drop_5', 'trending-down', 'gold', true),
  def('lean_gain_1kg', 'sparkles-outline', 'bronze', true),
  def('lean_gain_5kg', 'sparkles', 'gold', true),
  def('goal_hit', 'checkmark-circle', 'platinum', true),
  // League tier (share-gated — derived from verified body comp)
  def('tier_bronze', 'award', 'bronze', true),
  def('tier_silver', 'award', 'silver', true),
  def('tier_gold', 'award', 'gold', true),
  def('tier_platinum', 'award', 'platinum', true),
  def('tier_diamond', 'award', 'platinum', true),
  def('tier_master', 'award', 'platinum', true),
  def('tier_grandmaster', 'award', 'platinum', true),
  def('tier_apex', 'award', 'platinum', true),
];

export const ACHIEVEMENT_BY_KEY: Record<string, AchievementDef> = Object.fromEntries(
  ACHIEVEMENTS.map((a) => [a.key, a]),
);

// Brand tint per rarity — keep in sync with theme tones (cyan-primary brand). Bronze/silver/
// gold/platinum read as escalating prestige; callers map these to theme colors.
export const RARITY_RANK: Record<AchievementRarity, number> = {
  bronze: 0,
  silver: 1,
  gold: 2,
  platinum: 3,
};

/** An earned trophy row from get_public_app_achievements / the owner's own read. */
export type EarnedAchievement = {
  achievement_key: string;
  awarded_at: string;
  metadata: Record<string, unknown>;
};
