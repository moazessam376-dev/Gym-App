// Zod contract for athlete → coach workout feedback (migration 0021), per §4.
// Allowlist only — user_id is forced from auth.uid() by the DB identity trigger,
// never client-supplied.
import { z } from 'zod';

// Lenient UUID (matches src/schemas/session.ts) — seeded ids aren't RFC-versioned.
const uuid = z
  .string()
  .regex(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/, 'Invalid id');

export const noteCategorySchema = z.enum(['challenge', 'compliment']);
export type NoteCategory = z.infer<typeof noteCategorySchema>;

export const createWorkoutNoteSchema = z.object({
  session_id: uuid.nullable().optional(),
  plan_exercise_id: uuid.nullable().optional(),
  exercise_name: z.string().min(1).max(120).nullable().optional(),
  category: noteCategorySchema,
  body: z.string().trim().min(1).max(2000),
});
export type CreateWorkoutNote = z.infer<typeof createWorkoutNoteSchema>;
