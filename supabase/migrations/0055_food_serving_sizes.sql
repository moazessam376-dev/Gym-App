-- 0055_food_serving_sizes.sql
--
-- Slice G4 — serving sizes + barcode for nutrition. Purely ADDITIVE (no RLS / policy
-- change → advisors stay clean): a food can carry a named serving (e.g. "1 scoop · 30 g")
-- and a scanned barcode; a food-log entry snapshots the serving it was logged with (mirrors
-- the per-100g macro snapshot in 0019, so edits to the library row don't rewrite history).
--
-- Quantity stays INTEGER grams everywhere (foundations §3) — serving is a UI convenience
-- that computes grams (n × serving_grams), never a float column. Idempotent.

-- ── food_library: a named serving + a barcode for lookups ───────────────────
alter table public.food_library
  add column if not exists barcode       text,
  add column if not exists serving_label text,
  add column if not exists serving_grams integer check (serving_grams is null or serving_grams >= 0);

-- Non-unique: the same barcode can exist as a global row AND a coach's custom row.
create index if not exists food_library_barcode_idx
  on public.food_library (barcode) where barcode is not null;

-- ── food_log_entries: snapshot the serving the entry was logged with ────────
alter table public.food_log_entries
  add column if not exists serving_label text,
  add column if not exists serving_grams integer check (serving_grams is null or serving_grams >= 0);
