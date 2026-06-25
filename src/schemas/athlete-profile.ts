// Zod contract for an athlete's goals/profile (migration 0017), per CLAUDE.md §4.
// Allowlist only — user_id is set from auth.uid() in the data layer, never the
// client; onboarded_at is server-set. Integer units (foundations.md §3).
import { z } from 'zod';

export const athleteGoalSchema = z.enum([
  'lose_fat',
  'build_muscle',
  'maintain',
  'gain_strength',
  'improve_health',
  'sport_performance',
]);
export type AthleteGoal = z.infer<typeof athleteGoalSchema>;

export const experienceLevelSchema = z.enum(['beginner', 'intermediate', 'advanced']);
export type ExperienceLevel = z.infer<typeof experienceLevelSchema>;

export const activityLevelSchema = z.enum(['sedentary', 'light', 'moderate', 'active', 'very_active']);
export type ActivityLevel = z.infer<typeof activityLevelSchema>;

// Biological sex (male/female only) — tracked for accurate calorie/TDEE estimates.
export const sexSchema = z.enum(['male', 'female']);
export type Sex = z.infer<typeof sexSchema>;

// Preferred DISPLAY unit for weight (load is always stored as integer grams).
export const weightUnitSchema = z.enum(['kg', 'lb']);
export type WeightUnit = z.infer<typeof weightUnitSchema>;

// Allowlisted dietary tags — never free-form (keeps the array a closed set).
export const dietaryTagSchema = z.enum([
  'vegetarian',
  'vegan',
  'halal',
  'kosher',
  'pescatarian',
  'dairy_free',
  'gluten_free',
  'nut_allergy',
  'lactose_intolerant',
]);
export type DietaryTag = z.infer<typeof dietaryTagSchema>;

// 'YYYY-MM-DD' birth date.
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date');

// Partial: the questionnaire saves incrementally, so every field is optional.
export const upsertAthleteProfileSchema = z.object({
  primary_goal: athleteGoalSchema.nullable().optional(),
  experience_level: experienceLevelSchema.nullable().optional(),
  sex: sexSchema.nullable().optional(),
  birth_date: isoDate.nullable().optional(),
  height_cm: z.number().int().min(1).max(299).nullable().optional(),
  target_weight_grams: z.number().int().min(1).max(500_000).nullable().optional(),
  activity_level: activityLevelSchema.nullable().optional(),
  training_days: z.number().int().min(0).max(7).nullable().optional(),
  dietary_tags: z.array(dietaryTagSchema).max(20).optional(),
  injuries_notes: z.string().max(2000).nullable().optional(),
  // Phase 19 — opt-in public profile fields (default private). The PUBLIC read path
  // (get_public_athlete_profile) deliberately exposes only name/avatar/goal/these
  // achievements — never the sensitive fields above.
  is_public: z.boolean().optional(),
  public_achievements: z.array(z.string().trim().min(1).max(200)).max(20).optional(),
});
export type UpsertAthleteProfile = z.infer<typeof upsertAthleteProfileSchema>;
