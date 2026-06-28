// Shared Zod contract for profiles. Validation starts in Phase 0 (CLAUDE.md §4)
// so every later mutation can validate against an explicit schema rather than
// trusting client input.
import { z } from 'zod';

export const roleSchema = z.enum(['admin', 'coach', 'client']);
export type Role = z.infer<typeof roleSchema>;

export const profileSchema = z.object({
  id: z.string().uuid(),
  role: roleSchema,
  coach_id: z.string().uuid().nullable(),
  full_name: z.string().min(1).max(120).nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Profile = z.infer<typeof profileSchema>;

// Fields a client may submit when creating their OWN profile. Allowlisted on
// purpose — never spread req.body into a write (CLAUDE.md §4). `role` and
// `coach_id` are server-controlled and deliberately excluded.
export const profileSelfInsertSchema = z.object({
  full_name: z.string().min(1).max(120),
});
export type ProfileSelfInsert = z.infer<typeof profileSelfInsertSchema>;

// Instagram-style @handle (U-6): unique identity anchor, lowercase, 3–20 chars of
// [a-z0-9_.]. Uniqueness + the 14-day rename cooldown are enforced server-side (0069);
// this is the client-side format gate. Lowercase the input before parsing.
export const handleSchema = z
  .string()
  .min(3)
  .max(20)
  .regex(/^[a-z0-9_.]+$/);
