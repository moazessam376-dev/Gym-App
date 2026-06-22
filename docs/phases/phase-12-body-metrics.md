# Phase 12 — Body-metrics + InBody ranking (anti-cheat)

> Replaces the dashboard's SAMPLE body-composition data with **verified** metrics
> and a **goal-relative, per-coach** leaderboard. The anti-cheat pillar
> (foundations.md §4): the numbers that drive ranks are **server-verified, never
> client-asserted**. Split into two slices so value ships without waiting on AI.

Roadmap row: `docs/phases/README.md` Phase 12.

---

## 12a — Foundation (this slice, no AI, $0)

**Data — migration `0026_body_metrics.sql`:**
- `body_metrics` (athlete-owned read, **coach/admin-only write**): `weight_grams`,
  `body_fat_bp` (basis points, 1850 = 18.50%), `skeletal_muscle_mass_grams`,
  `body_fat_mass_grams`, `visceral_fat_level`, `bmr_kcal` — all **integers**
  (foundations §3). Provenance: `source` (`coach_entered | inbody_ocr | device |
  self_reported`), `verified_at`, `verified_by`, `media_id` (link to the source
  InBody scan, **UNIQUE** → dedupe). `measured_at` = the scan date.
- **RLS:** read = owner / `is_coach_of` / admin (mirrors `progress_entries`).
  **Write = the client's coach or admin only** — the athlete never self-writes a
  verified metric. A `BEFORE INSERT` trigger **server-stamps** `verified_by =
  auth.uid()` + `verified_at = now()` on `coach_entered` rows (can't be forged).
- **`coach_body_metrics_board()`** — `SECURITY DEFINER`, fenced by `p.coach_id =
  auth.uid()` (same shape as `coach_leaderboard`). Returns each client's earliest +
  latest **verified** reading + their goal; **the app computes the goal-relative
  score/ranking** (kept out of trusted SQL — it's a product choice, not a boundary).
  Non-coach callers rejected; anon can't execute it.

**Ranking — goal-relative (`src/lib/body-metrics.ts` `goalProgress`/`rankBoard`):**
each athlete is scored on the change that matters for **their** goal so a cutter and
a bulker aren't judged on one axis — `lose_fat` → body-fat % dropped; `build_muscle`/
`gain_strength` → muscle gained; else recomposition (both). Transparent headline
states exactly what earned the rank.

**UI:**
- **Coach enters a reading** (`app/coach/body-metric.tsx`) — kg/% form → integer
  grams/bp; saved coach-verified. Linked from the client-detail Progress card
  ("Add InBody reading").
- **Body-composition trends** (`app/client/progress/body-comp.tsx`) — weight/fat/
  muscle chart + history; read-only; works for athlete (own) + coach (`?clientId=`).
  Surfaced on the athlete progress hub.
- **Mock data removed:** the coach Home "Top performers" board is now the **real**
  goal-relative ranking; the client-detail **lean-mass delta** is real when verified
  readings exist. `MOCK_TOP_PERFORMERS`/`MOCK_TEAM_MOMENTUM` deleted. (Still demo:
  per-client streak/adherence fallback + the recent-activity feed.)

**Security checklist (foundations §8):** new table ships deny-by-default RLS in the
same migration; cross-tenant denial + coach-verified-write + forged-verifier +
board-fence tests added to the harness; Zod-allowlisted; integer units; no client
writes; `get_advisors` expected clean (only the known SECURITY-DEFINER-helper WARN).

## 12b — InBody OCR (built; free vision LLM behind a swap-by-config adapter)

Layers auto-extraction on top of 12a, writing the **same** rows. **No schema change to
0026** — additive. One new table (`0027_ai_usage_events`) is the rate-limit ledger.

**Provider — a `VisionProvider` adapter** (`supabase/functions/_shared/vision.ts`),
provider chosen by the `VISION_PROVIDER` env var (same philosophy as the PaymentProvider
stub — no Groq-specific calls scattered around):
- **Pilot → Groq** (Llama 4 Scout vision). Free, and Groq processes API data as a
  data-processor under its DPA (**not used to train**) — the right fit for sensitive
  health data (§7), unlike Gemini's free tier which trains on inputs.
- **Launch → Claude Sonnet 4.6** (written now; switch = `VISION_PROVIDER=anthropic` +
  `ANTHROPIC_API_KEY`, no code change). ~2¢/scan; pilot $0.
- Keys in Supabase secrets via `Deno.env.get` (§3). (CLAUDE.md §1 names OpenAI as the
  planned provider — the adapter makes the actual provider a config detail.)

**Flow (anti-cheat anchor preserved):** athlete captures/picks the InBody sheet (Phase 11
media pipeline) → taps **Auto-read** → `inbody-ocr` Edge Function verifies the scan is the
caller's own ready image, dedupes (one reading per `media_id`), rate-limits, then calls
`VisionProvider.extractInBody` → returns fields as **Zod-validated JSON** → inserts a
`body_metrics` row **unverified** (`source='inbody_ocr'`; the 0026 trigger forces
`verified_*=null`) → **coach reviews against the scan and confirms** (a plain UPDATE
`source→coach_entered`, which makes the 0026 trigger stamp `verified_by`/`verified_at`).
Misreads and photoshopped sheets die at coach review — same anchor as 12a; manual entry
(12a) remains the always-available fallback. PDF scans aren't OCR'd in the pilot (Groq
vision is image-only) → manual entry.

**Rate limit (§9): 5/hr/user** via the `ai_usage_events` ledger (append-only,
service-role-write-only, deny-by-default RLS — owner/admin read only). The attempt is
recorded **before** the model call (fail-closed), so failed/garbage requests also count —
which matters once a paid model (Sonnet) makes every call cost money. The model output is
Zod-validated before any DB write, and the image prompt carries a prompt-injection guard.

## Deferred (later)
Segmental analysis, body-measurement columns (waist/chest/…), device/Bluetooth
imports, gym-wide (cross-coach) leaderboard, podium animation.
