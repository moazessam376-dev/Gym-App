// Zod contract for auth credentials. Per CLAUDE.md §4, validate input against an
// explicit schema before any mutation — here, before calling Supabase Auth.
import { z } from 'zod';

export const credentialsSchema = z.object({
  email: z.string().email(),
  // Supabase enforces its own minimum server-side; we keep the client strict.
  password: z.string().min(8),
});

export type Credentials = z.infer<typeof credentialsSchema>;
