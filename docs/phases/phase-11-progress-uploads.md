# Phase 11 — Progress & uploads UI `[MVP]`

> Surfaces backend that is **already live but has no UI**: the secure media pipeline
> (migration 0013 — private buckets + EXIF strip + signed URLs + 3 Edge Functions,
> see [foundations.md §5](./foundations.md)) and weight history
> (`progress_entries.weight_grams`, migration 0002). The last MVP pillar — it
> completes "both see progress" in the core loop.

Roadmap row: `docs/phases/README.md` L97. Depends on Phase 8 (media live) + Phase 9
(`athlete_profile.weight_unit`, kg/lb display preference).

---

## Scope

1. **Weight history** — log a body-weight entry (display unit kg/lb → stored as
   integer grams) and see a trend line chart + history list.
2. **Progress photos** — capture/pick → on-device downscale + JPEG re-encode →
   secure upload (`kind = progress_photo`) → a date-grouped timeline → full-screen view.
3. **InBody capture** — same upload path with `kind = inbody`; a list of scans +
   full-screen view. OCR / verified ranking is **deferred to Phase 12 / L3** — this
   phase only captures + stores + displays.
4. **Coach read-only view** — a coach opens a client's progress (weight + photos +
   InBody) from the client-detail screen. RLS already grants the coach read via
   `is_coach_of`; the screens render read-only (no capture/log controls).

## Non-goals (deferred)

- **No new tables, no migration.** Reuses `media` (0013) + `progress_entries` (0002).
  The RLS harness is unchanged and stays green.
- InBody **PDF** capture (image-only for now — users photograph the printed sheet),
  InBody **OCR**, photo **side-by-side comparison**, body-measurement columns
  (chest/waist/…). All sequence outward (Phase 12 / L3).

---

## Security (all reused, nothing new — foundations.md §5)

- **No client writes to `media`.** Bytes go to the locked `media-inbox` via a
  service-role-minted signed upload URL (`media-create-upload`), then `media-finalize`
  (service role) validates magic bytes, **strips EXIF**, promotes to the private
  `media` bucket, and inserts the row. The app never touches the `media` table on write.
- Photos are served only via **short-lived signed URLs** (`media-signed-url`, minted
  under the caller's own RLS — an unreadable row 404s). Never a public bucket.
- On-device we re-encode to JPEG (HEIC→JPEG) which **also drops EXIF** as
  defense-in-depth; the server strips again regardless.
- Weight entries use the standard **client-owned RLS** on `progress_entries` (owner
  writes; owner + assigned coach + admin read). Zod-allowlisted; integer grams only
  (foundations.md §3) — never a float weight.

---

## Implementation map

**Deps:** `expo-image-picker`, `expo-image-manipulator` (HEIC→JPEG + downscale),
`expo-file-system` (SDK-54 pinned via `expo install`).

**Data layer**
- `src/schemas/progress.ts` — Zod for a weight entry (`weight_grams` int > 0, optional
  note, optional `recorded_at`).
- `src/lib/progress.ts` — `listProgressWeights` / `addWeightEntry` / `deleteWeightEntry`
  over `progress_entries` (owner forced server-side via RLS check).
- `src/lib/upload.ts` — `captureAndUploadPhoto({ source, kind })`: permission → pick
  (camera/library) → downscale + JPEG re-encode → `fetch`→Blob → `uploadMedia`
  (reuses `src/lib/media.ts`). Returns the new media id (or null if cancelled).

**UI primitives**
- `src/components/ui/LineChart.tsx` — a full-width weight trend chart (react-native-svg),
  bigger sibling of `Sparkline`.
- `src/components/ui/SignedImage.tsx` — resolves a media id → signed URL → `Image`
  with loading/error states (server-authorized via RLS).

**Screens**
- `app/(tabs)/progress.tsx` — keep streak + workout history; add a **Weight** card
  (chart + latest + "Log weight") and a **Photos / InBody** entry card.
- `app/client/progress/_layout.tsx` (+ register in `app/_layout.tsx`).
- `app/client/progress/weight.tsx` — chart + add-entry + history (delete own).
- `app/client/progress/photos.tsx` — capture/pick + date-grouped timeline.
- `app/client/progress/inbody.tsx` — capture + list.
- `app/client/progress/view.tsx` — full-screen signed-image viewer (`mediaId` param).
- All progress screens take an optional `clientId` param → **read-only** when the
  viewer is the coach. Linked from `app/coach/client/[id].tsx`.

## Definition of done (foundations.md §8)

- [x] No new tables → RLS harness untouched + green; `get_advisors` unchanged.
- [ ] Every mutation Zod-validated + allowlisted; integer grams only.
- [ ] Files only via the secure pipeline (no client `media` writes).
- [ ] `npm run typecheck` + lint clean.
- [ ] On-device test pass (founder) before merge.
</content>
</invoke>
