-- 0023_exercise_prs_e1rm.sql
--
-- Smarter PR detection. The 0021 view tracked only max load — so doing MORE REPS at
-- the same weight never registered as a PR. Redefine v_exercise_prs to also expose:
--   * best_e1rm_grams — best estimated 1-rep-max (Epley: load × (30 + reps) / 30),
--     so more reps at the same load IS a new best (in gram-equivalents, integer).
--   * best_reps       — best reps on the movement, for bodyweight / unloaded sets.
-- best_load_grams is kept for the "best 60 kg" header. Only completed sets count.
-- SECURITY INVOKER (base-table RLS applies); not a base table so the RLS-enabled
-- invariant needn't cover it. Idempotent.

drop view if exists public.v_exercise_prs;
create view public.v_exercise_prs with (security_invoker = true) as
  select
    s.user_id,
    l.exercise_name,
    max(l.load_grams) filter (where l.load_grams > 0) as best_load_grams,
    (
      max(round(l.load_grams * (30 + coalesce(l.reps_done, 1)) / 30.0))
        filter (where l.load_grams > 0)
    )::bigint as best_e1rm_grams,
    max(l.reps_done) as best_reps
  from public.exercise_set_logs l
  join public.workout_sessions s on s.id = l.session_id
  where l.is_completed
  group by s.user_id, l.exercise_name;

grant select on public.v_exercise_prs to anon, authenticated;  -- anon: RLS -> 0 rows
