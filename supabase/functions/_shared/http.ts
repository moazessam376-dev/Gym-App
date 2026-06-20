// Tiny HTTP helpers shared by every Edge Function.
//
// CORS is permissive on origin because the app ships to native + web (Expo) and
// auth is carried by the bearer token, not cookies. Only POST/OPTIONS are used.

export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/** JSON response with CORS headers. Never include internal details (§4). */
export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
