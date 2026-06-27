-- 0049_recategorize_exercises.sql
-- Consolidate the exercise muscle_group taxonomy to PPL + Arms + Core:
--   • `lower` → `legs`            (the sparse lower bucket folds into legs)
--   • `upper` → `push` / `pull`   (by movement: rowing/pulling/back → pull, else push)
--   • biceps/triceps/forearm work in push|pull → `arms`  (new dedicated category, 0048)
-- Shoulders stay in `push`; rear-delt accessories stay in `pull` (standard split).
--
-- Ordered UPDATEs (not one CASE) so an `upper` row that resolves to push/pull but is
-- actually an arm movement is still caught by the final arms pass. Each step is scoped
-- to its source rows, so re-applying is a no-op. `arms` is safe to use here: 0048 added
-- and committed it in an earlier transaction.

-- lower → legs
update public.exercise_library
   set muscle_group = 'legs'
 where muscle_group = 'lower';

-- upper → push / pull
-- (a CASE returns `text`, which doesn't implicitly coerce to the enum — cast it;
--  a bare literal like 'legs'/'arms' below coerces fine on its own.)
update public.exercise_library
   set muscle_group = (case
     when primary_muscle ilike '%back%' or primary_muscle ilike '%lat%'
       or primary_muscle ilike '%row%'  or primary_muscle ilike '%rear%'
       or primary_muscle ilike '%trap%' then 'pull'
     else 'push'
   end)::public.muscle_group
 where muscle_group = 'upper';

-- biceps / triceps / forearm work → arms
update public.exercise_library
   set muscle_group = 'arms'
 where muscle_group in ('push', 'pull')
   and (primary_muscle ilike '%bicep%' or primary_muscle ilike '%tricep%'
        or primary_muscle ilike '%forearm%');
