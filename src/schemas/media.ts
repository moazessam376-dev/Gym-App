// Shared Zod contract for media uploads (CLAUDE.md §4, §7). These mirror the
// server schemas in supabase/functions/_shared/schemas.ts — the app validates
// before the network call, but the Edge Functions ALWAYS re-validate and the real
// type is decided by magic bytes server-side. Allowlist-only; sender/owner is
// never client-supplied (set from the verified JWT server-side).
import { z } from 'zod';

export const MEDIA_MIME_TYPES = [
  'image/jpeg', 'image/png', 'application/pdf',
  'audio/mp4', 'audio/mpeg', 'audio/wav', // voice notes (Phase 18)
] as const;
export const MEDIA_KINDS = ['progress_photo', 'inbody', 'other', 'audio'] as const;
export const MEDIA_MAX_BYTES = 10 * 1024 * 1024; // 10 MB (§7)

export const mediaKindSchema = z.enum(MEDIA_KINDS);
export type MediaKind = z.infer<typeof mediaKindSchema>;

export const mediaMimeSchema = z.enum(MEDIA_MIME_TYPES);
export type MediaMime = z.infer<typeof mediaMimeSchema>;

// Step 1: ask for a signed upload URL (no media row yet).
export const createUploadSchema = z.object({
  mime_type: mediaMimeSchema,
  size_bytes: z.number().int().positive().max(MEDIA_MAX_BYTES),
});
export type CreateUpload = z.infer<typeof createUploadSchema>;

// Step 3: finalize. inbox_path must be `{ownerUuid}/{uuid}.{ext}` (no traversal).
export const finalizeSchema = z.object({
  inbox_path: z.string().regex(/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|pdf|m4a|mp3|wav)$/i),
  kind: mediaKindSchema,
  progress_entry_id: z.string().uuid().optional(),
});
export type FinalizeUpload = z.infer<typeof finalizeSchema>;

export const signedUrlSchema = z.object({
  media_id: z.string().uuid(),
});
