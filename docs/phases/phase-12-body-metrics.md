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

## 12b — InBody OCR (next slice, Claude vision)

Layer auto-extraction on top of 12a, writing the **same** rows:
- Athlete captures/picks the InBody sheet (reuses the Phase 11 media pipeline) →
  Edge Function sends the image to **Claude vision** (Sonnet 4.6, ~2¢/scan; §3 key
  in Supabase secrets) → returns the fields as **Zod-validated JSON** → inserted
  **unverified** (`source = 'inbody_ocr'`, `verified_at` null) → **coach taps
  confirm** (the human-in-the-loop, §9) which stamps verification. Misreads die at
  coach review; a photoshopped sheet dies there too — same anti-cheat anchor.
- Rate-limit 5/hr/user (§9). No schema change — additive on 0026.
- Cost: pilot < $1/mo, launch ~$8/mo (Sonnet). Haiku is the cost-floor fallback.

## Deferred (later)
Segmental analysis, body-measurement columns (waist/chest/…), device/Bluetooth
imports, gym-wide (cross-coach) leaderboard, podium animation.
