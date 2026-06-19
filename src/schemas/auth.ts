// Zod contract for auth inputs (CLAUDE.md §4 — validate every input).
import { z } from 'zod';

export const credentialsSchema = z.object({
  email: z.string().email('Enter a valid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});
export type Credentials = z.infer<typeof credentialsSchema>;
