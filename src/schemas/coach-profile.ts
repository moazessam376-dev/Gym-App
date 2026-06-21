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

export const upsertCoachProfileSchema = z.object({
  bio: z.string().max(2000).nullable().optional(),
  specialties: z.array(specialtySchema).max(20).optional(),
  years_experience: z.number().int().min(0).max(79).nullable().optional(),
  certifications: z.string().max(2000).nullable().optional(),
});
export type UpsertCoachProfile = z.infer<typeof upsertCoachProfileSchema>;
