// Read the server-issued `user_role` claim out of a Supabase access token.
//
// IMPORTANT: this is for UX/routing only. The real authorization boundary is
// RLS, which reads the same claim server-side (public.current_app_role) — so a
// user who tampered with their local token still cannot touch another role's
// data. We decode (never verify) here; verification is Supabase's job.
import type { Role } from '../schemas/profile';

const ROLES = new Set<string>(['admin', 'coach', 'client']);

// Decode a base64url JWT segment to a UTF-8 string. atob exists in Hermes
// (RN 0.74+) and on web; the percent-encoding step recovers any multi-byte chars.
function decodeSegment(seg: string): string {
  let b64 = seg.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4;
  if (pad) b64 += '='.repeat(4 - pad);
  const binary = atob(b64);
  let percent = '';
  for (let i = 0; i < binary.length; i++) {
    percent += '%' + binary.charCodeAt(i).toString(16).padStart(2, '0');
  }
  return decodeURIComponent(percent);
}

export function readUserRole(accessToken: string | null | undefined): Role | null {
  if (!accessToken) return null;
  const segment = accessToken.split('.')[1];
  if (!segment) return null;
  try {
    const payload = JSON.parse(decodeSegment(segment)) as { user_role?: unknown };
    const role = payload.user_role;
    return typeof role === 'string' && ROLES.has(role) ? (role as Role) : null;
  } catch {
    return null;
  }
}
