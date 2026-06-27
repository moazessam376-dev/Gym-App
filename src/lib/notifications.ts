// Data layer for the in-app notification feed (Phase 17, Slice 1). Reads/writes go
// through RLS: a user only ever sees their OWN feed (recipient_id = auth.uid()), and
// there is NO client INSERT path — rows are minted server-side by the 0032 triggers.
// Read-state flips through the mark_*_read() RPCs (a column-restricted UPDATE path).
//
// The feed stores STRUCTURED data (type + params), not pre-rendered text, so the copy
// can be rendered in the active language (en/ar) here on the client — see describe().
import type { RealtimeChannel } from '@supabase/supabase-js';
import type { TFunction } from 'i18next';
import type { Href } from 'expo-router';
import { supabase } from './supabase';
import type { IconName } from '../components/ui/Icon';
import { notificationPrefsSchema } from '../schemas/notification';

export type NotificationType =
  | 'message'
  | 'coach_comment'
  | 'plan_published'
  | 'pr_achieved'
  | 'client_note'
  | 'coach_request';

export type NotificationRow = {
  id: string;
  type: NotificationType;
  actor_id: string | null;
  params: Record<string, unknown>;
  entity_type: string | null;
  entity_id: string | null;
  read_at: string | null;
  created_at: string;
};

const COLS ='id, type, actor_id, params, entity_type, entity_id, read_at, created_at';

/** Newest-first page of the signed-in user's feed (RLS scopes it to them). */
export async function listNotifications(limit = 50): Promise<NotificationRow[]> {
  const { data, error } = await supabase
    .from('notifications')
    .select(COLS)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as NotificationRow[];
}

/** Cheap unread count for the bell badge (head request, no rows transferred). */
export async function getUnreadCount(): Promise<number> {
  const { count, error } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .is('read_at', null);
  if (error) throw error;
  return count ?? 0;
}

/** Mark one notification read (server-scoped to the caller's own rows). */
export async function markRead(id: string): Promise<void> {
  const { error } = await supabase.rpc('mark_notification_read', { p_id: id });
  if (error) throw error;
}

/** Mark the whole feed read. */
export async function markAllRead(): Promise<void> {
  const { error } = await supabase.rpc('mark_all_notifications_read');
  if (error) throw error;
}

/** Dismiss one notification from the feed (delete own — RLS-scoped). */
export async function dismissNotification(id: string): Promise<void> {
  const { error } = await supabase.from('notifications').delete().eq('id', id);
  if (error) throw error;
}

/**
 * Live feed: fires on every notification newly addressed to me. Realtime respects
 * RLS, so only my rows arrive. Returns the channel; remove with
 * `supabase.removeChannel(channel)`.
 */
export function subscribeToNotifications(
  myUserId: string,
  onInsert: (n: NotificationRow) => void,
): RealtimeChannel {
  return supabase
    .channel(`notifications:to:${myUserId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: `recipient_id=eq.${myUserId}`,
      },
      (payload) => onInsert(payload.new as NotificationRow),
    )
    .subscribe();
}

// ── Presentation: type + params → localized copy + icon + deep-link ───────────

const ICONS: Record<NotificationType, IconName> = {
  message: 'chatbubble-ellipses',
  coach_comment: 'chatbox-ellipses',
  plan_published: 'document-text',
  pr_achieved: 'trophy',
  client_note: 'clipboard',
  coach_request: 'user-plus',
};

// Per-type semantic accent (brand notification colors): chat = purple, coach note =
// cobalt, plan = Signal cyan, PR = positive green. Hex values that aren't theme tokens
// (chat purple / cobalt) are the brand data-viz hues; callers pass these to <Icon>.
export const NOTIFICATION_COLORS: Record<NotificationType, string> = {
  message: '#9B7BF5', // chat purple
  coach_comment: '#6B8AFF', // cobalt
  plan_published: '#3FD9C0', // Signal cyan
  pr_achieved: '#3FD98A', // positive
  client_note: '#F5B544', // amber — an athlete's note to the coach
  coach_request: '#5BC8E8', // sky — a client asking to join the coach
};

function str(params: Record<string, unknown>, key: string): string {
  const v = params?.[key];
  return typeof v === 'string' ? v : '';
}

/** Localized title + body + icon for one feed row, in the active language. */
export function describeNotification(
  row: NotificationRow,
  t: TFunction,
): { icon: IconName; title: string; body: string } {
  const actor = str(row.params, 'actor_name') || t('notifications.someone');
  switch (row.type) {
    case 'message':
      return {
        icon: ICONS.message,
        title: t('notifications.message.title'),
        body: t('notifications.message.body', { name: actor }),
      };
    case 'coach_comment':
      return {
        icon: ICONS.coach_comment,
        title: t('notifications.coachComment.title'),
        body: t('notifications.coachComment.body', { name: actor }),
      };
    case 'plan_published': {
      const planType = str(row.params, 'plan_type'); // 'training' | 'nutrition'
      const typeLabel = t(`plans.type.${planType}`, { defaultValue: planType });
      return {
        icon: ICONS.plan_published,
        title: t('notifications.planPublished.title'),
        body: t('notifications.planPublished.body', {
          name: actor,
          title: str(row.params, 'plan_title'),
          type: typeLabel,
        }),
      };
    }
    case 'pr_achieved':
      return {
        icon: ICONS.pr_achieved,
        title: t('notifications.pr.title'),
        body: t('notifications.pr.body', { exercise: str(row.params, 'exercise_name') }),
      };
    case 'client_note':
      return {
        icon: ICONS.client_note,
        title: t('notifications.clientNote.title'),
        body: t('notifications.clientNote.body', { name: actor }),
      };
    case 'coach_request':
      return {
        icon: ICONS.coach_request,
        title: t('notifications.coachRequest.title'),
        body: t('notifications.coachRequest.body', { name: actor }),
      };
    default:
      return { icon: 'notifications', title: '', body: '' };
  }
}

/** Where tapping a feed row should navigate (null = no target). */
export function notificationHref(row: NotificationRow): Href | null {
  switch (row.type) {
    case 'message':
      return row.entity_id
        ? { pathname: '/chat/[id]', params: { id: row.entity_id, name: str(row.params, 'actor_name') } }
        : null;
    case 'coach_comment':
      return '/client/progress/body-comp';
    case 'plan_published':
      return row.entity_id ? { pathname: '/client/plan/[id]', params: { id: row.entity_id } } : null;
    case 'pr_achieved':
      return '/(tabs)/progress';
    case 'client_note':
      // Coach taps → that client's detail (the note shows in "Recent feedback").
      return row.actor_id
        ? { pathname: '/coach/client/[id]', params: { id: row.actor_id, name: str(row.params, 'actor_name') } }
        : null;
    case 'coach_request':
      // Coach taps → their request inbox.
      return '/coach/requests';
    default:
      return null;
  }
}

// ── Per-user preferences (one boolean per event type, default ON) ─────────────

export type NotificationPrefs = Record<NotificationType, boolean>;

const DEFAULT_PREFS: NotificationPrefs = {
  message: true,
  coach_comment: true,
  plan_published: true,
  pr_achieved: true,
  client_note: true,
  coach_request: true,
};

/** The caller's prefs (RLS-scoped). No row yet → everything ON (the default). */
export async function getNotificationPrefs(): Promise<NotificationPrefs> {
  const { data, error } = await supabase
    .from('notification_prefs')
    .select('message, coach_comment, plan_published, pr_achieved, client_note, coach_request')
    .maybeSingle();
  if (error) throw error;
  if (!data) return { ...DEFAULT_PREFS };
  return {
    message: data.message,
    coach_comment: data.coach_comment,
    plan_published: data.plan_published,
    pr_achieved: data.pr_achieved,
    client_note: data.client_note,
    coach_request: data.coach_request,
  };
}

/** Upsert the caller's prefs. user_id is the owner — RLS's with_check pins it to the caller. */
export async function setNotificationPrefs(userId: string, prefs: NotificationPrefs): Promise<void> {
  const v = notificationPrefsSchema.parse(prefs); // allowlist the 4 booleans (§4)
  const { error } = await supabase
    .from('notification_prefs')
    .upsert({ user_id: userId, ...v }, { onConflict: 'user_id' });
  if (error) throw error;
}

/** Ultra-compact timestamp parts for the chat list (now / Nm / Nh / Nd) — i18n-rendered. */
export function compactTimeParts(iso: string): { key: string; count: number } {
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return { key: 'chat.time.now', count: 0 };
  if (min < 60) return { key: 'chat.time.minutes', count: min };
  const hr = Math.floor(min / 60);
  if (hr < 24) return { key: 'chat.time.hours', count: hr };
  const day = Math.floor(hr / 24);
  return { key: 'chat.time.days', count: day };
}

/** Compact "x ago" parts for i18n rendering (count + plural-aware key). */
export function relativeTimeParts(iso: string): { key: string; count: number } {
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return { key: 'notifications.justNow', count: 0 };
  if (min < 60) return { key: 'notifications.minutesAgo', count: min };
  const hr = Math.floor(min / 60);
  if (hr < 24) return { key: 'notifications.hoursAgo', count: hr };
  const day = Math.floor(hr / 24);
  return { key: 'notifications.daysAgo', count: day };
}
