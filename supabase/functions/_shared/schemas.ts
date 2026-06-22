// Server-side Zod contracts for the assignment Edge Functions (§4). The app
// validates the same shapes before calling (src/schemas/invitation.ts), but the
// server NEVER trusts the client and re-validates here. Allowlist fields only —
// no req.body spread.
import { z } from 'zod';

export const acceptInvitationSchema = z.object({
  token: z.string().uuid(),
});

export const assignClientSchema = z.object({
  client_id: z.string().uuid(),
});

export const reviewApplicationSchema = z.object({
  application_id: z.string().uuid(),
  approve: z.boolean(),
});

// ── Media uploads (Phase 4, §7) ─────────────────────────────────────────────
// The allowlist is enforced here AND by magic-byte detection in media-finalize.
export const MEDIA_MIME_TYPES = ['image/jpeg', 'image/png', 'application/pdf'] as const;
export const MEDIA_KINDS = ['progress_photo', 'inbody', 'other'] as const;
const MEDIA_MAX_BYTES = 10 * 1024 * 1024; // 10 MB (§7)

// Request a signed upload URL into the locked inbox. No media row yet.
export const createUploadSchema = z.object({
  mime_type: z.enum(MEDIA_MIME_TYPES),
  size_bytes: z.number().int().positive().max(MEDIA_MAX_BYTES),
});

// Finalize: the inbox_path must be `{ownerUuid}/{uuid}.{ext}` (no traversal); the
// function re-checks the owner segment against the verified caller.
export const finalizeSchema = z.object({
  inbox_path: z.string().regex(/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|pdf)$/i),
  kind: z.enum(MEDIA_KINDS),
  progress_entry_id: z.string().uuid().optional(),
});

export const signedUrlSchema = z.object({
  media_id: z.string().uuid(),
});

// ── InBody OCR (Phase 12b, §9) ──────────────────────────────────────────────
// The athlete asks the server to read an already-uploaded InBody scan (a `media`
// row of kind 'inbody'). The function re-checks ownership/kind against the verified
// caller; nothing here is trusted beyond the shape.
export const inbodyOcrSchema = z.object({
  media_id: z.string().uuid(),
});
