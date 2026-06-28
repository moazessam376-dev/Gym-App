-- 0061_audit_trail_fk_setnull.sql
--
-- Security H-1 (moderation audit-trail destruction). message_reports.reported_user_id
-- (0034) and ban_appeals.user_id (0038) were `not null references profiles(id) ON DELETE
-- CASCADE`. Combined with a user self-deleting their account (account-delete Edge fn →
-- auth.admin.deleteUser → the profiles row is deleted), a reported/banned user could erase
-- every report filed against them and their own appeals — the moderation record vanished.
--
-- Fix: change both to ON DELETE SET NULL so the audit row survives the user's deletion
-- (the reported_body snapshot + status + reviewer are preserved). Requires dropping NOT
-- NULL on those columns. Matches the account-delete/money.md forward pattern (FKs to
-- profiles set null, never cascade, so a deletion never erases an audit/financial row).
--
-- reporter_id stays ON DELETE CASCADE by design (a reporter deleting their own account
-- removing their own reports is defensible — it's their data, not the audit trail against
-- the abuser). The moderation RPCs (moderate_message_report 0034, resolve_ban_appeal 0038)
-- read these columns FOR UPDATE only on OPEN rows BEFORE the user is deleted, so a
-- post-delete NULL is harmless. Idempotent.

-- ── message_reports.reported_user_id → ON DELETE SET NULL ─────────────────────
alter table public.message_reports
  alter column reported_user_id drop not null;

alter table public.message_reports
  drop constraint if exists message_reports_reported_user_id_fkey;

alter table public.message_reports
  add constraint message_reports_reported_user_id_fkey
  foreign key (reported_user_id) references public.profiles (id) on delete set null;

-- ── ban_appeals.user_id → ON DELETE SET NULL ─────────────────────────────────
alter table public.ban_appeals
  alter column user_id drop not null;

alter table public.ban_appeals
  drop constraint if exists ban_appeals_user_id_fkey;

alter table public.ban_appeals
  add constraint ban_appeals_user_id_fkey
  foreign key (user_id) references public.profiles (id) on delete set null;
