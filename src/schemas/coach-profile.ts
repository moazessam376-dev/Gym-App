// Zod contract for a coach's profile (migration 0017), per CLAUDE.md §4.
// Allowlist only — user_id from auth.uid(); onboarded_at server-set.
import { z } from 'zod';

// Allowlisted specialties — a closed set, not free text.
export const specialtySchema = z.enum([
  'hypertrophy',
  'powerlifting',
  'weight_loss',
  'nutrition',
  'strength',
  'bodybuilding',
  'general_fitness',
  'sport_performance',
  'mobility',
  'womens_training',
]);
export type Specialty = z.infer<typeof specialtySchema>;

// A single portfolio achievement line (Phase 19) — short free text, closed length.
export const achievementSchema = z.string().trim().min(1).max(200);

export const upsertCoachProfileSchema = z.object({
  bio: z.string().max(2000).nullable().optional(),
  specialties: z.array(specialtySchema).max(20).optional(),
  years_experience: z.number().int().min(0).max(79).nullable().optional(),
  certifications: z.string().max(2000).nullable().optional(),
  // Phase 19 — opt-in public portfolio fields (default private; server-owned read path).
  is_public: z.boolean().optional(),
  achievements: z.array(achievementSchema).max(20).optional(),
});
export type UpsertCoachProfile = z.infer<typeof upsertCoachProfileSchema>;
