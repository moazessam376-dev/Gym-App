// push-send — fan a freshly-inserted notification out to the recipient's devices
// via the Expo Push API (Phase 17, Slice 2).
//
// Invoked ONLY by the notifications AFTER INSERT trigger (0041) over pg_net, which
// carries the service-role key as its bearer. We re-check that bearer against the
// service-role key so an end user can never trigger an arbitrary push (§2/§3). The
// payload is just the notification id; everything else is loaded server-side with
// the service-role client. Per-type opt-outs were already enforced before the row
// existed (emit_notification, 0032), so any row we receive is opt-in.
//
// Push copy is rendered HERE, per device locale (device_tokens.locale), because the
// in-app feed localizes on-device but a push can't. The strings intentionally mirror
// src/i18n/locales/{en,ar}.json → notifications.* (kept in sync by hand). Generic
// errors only; details are logged server-side (§4).
import { serviceClient } from '../_shared/clients.ts';
import { pushSendSchema } from '../_shared/schemas.ts';
import { corsHeaders, json } from '../_shared/http.ts';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

type Locale = 'en' | 'ar';

// Mirrors src/i18n/locales/*.json → notifications.*. `body` is a builder so the
// interpolation matches the client exactly. A push gets a title + one-line body.
const COPY: Record<
  Locale,
  {
    someone: string;
    planType: Record<string, string>;
    message: { title: string; body: (name: string) => string };
    coach_comment: { title: string; body: (name: string) => string };
    plan_published: { title: string; body: (name: string, type: string, title: string) => string };
    pr_achieved: { title: string; body: (exercise: string) => string };
  }
> = {
  en: {
    someone: 'Someone',
    planType: { training: 'training', nutrition: 'nutrition' },
    message: { title: 'New message', body: (n) => `${n} sent you a message` },
    coach_comment: { title: 'Coach feedback', body: (n) => `${n} commented on your InBody` },
    plan_published: {
      title: 'New plan',
      body: (n, type, title) => `${n} published your ${type} plan: ${title}`,
    },
    pr_achieved: { title: 'New personal record 💪', body: (e) => e },
  },
  ar: {
    someone: 'حد',
    planType: { training: 'تمارين', nutrition: 'أكل' },
    message: { title: 'رسالة جديدة', body: (n) => `${n} بعتلك رسالة` },
    coach_comment: { title: 'ملاحظة من الكوتش', body: (n) => `${n} علّق على قياس الإن-بودي بتاعك` },
    plan_published: {
      title: 'خطة جديدة',
      body: (n, type, title) => `${n} نشرلك خطة ${type}: ${title}`,
    },
    pr_achieved: { title: 'رقم قياسي جديد 💪', body: (e) => e },
  },
};

function str(params: Record<string, unknown> | null, key: string): string {
  const v = params?.[key];
  return typeof v === 'string' ? v : '';
}

type NotificationRow = {
  recipient_id: string;
  type: 'message' | 'coach_comment' | 'plan_published' | 'pr_achieved';
  params: Record<string, unknown> | null;
  entity_type: string | null;
  entity_id: string | null;
};

/** Render { title, body } for one notification in one locale. */
function render(row: NotificationRow, locale: Locale): { title: string; body: string } {
  const c = COPY[locale];
  const actor = str(row.params, 'actor_name') || c.someone;
  switch (row.type) {
    case 'message':
      return { title: c.message.title, body: c.message.body(actor) };
    case 'coach_comment':
      return { title: c.coach_comment.title, body: c.coach_comment.body(actor) };
    case 'plan_published': {
      const planType = str(row.params, 'plan_type');
      const typeLabel = c.planType[planType] ?? planType;
      return {
        title: c.plan_published.title,
        body: c.plan_published.body(actor, typeLabel, str(row.params, 'plan_title')),
      };
    }
    case 'pr_achieved':
      return { title: c.pr_achieved.title, body: c.pr_achieved.body(str(row.params, 'exercise_name')) };
    default:
      return { title: '', body: '' };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  // Trusted-path gate: only the service role (the 0041 trigger) may fan out push.
  const bearer = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!bearer || bearer !== Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')) {
    return json({ error: 'unauthorized' }, 401);
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return json({ error: 'invalid_request' }, 400);
  }
  const parsed = pushSendSchema.safeParse(raw);
  if (!parsed.success) return json({ error: 'invalid_request' }, 400);

  const svc = serviceClient();

  const { data: row, error: nErr } = await svc
    .from('notifications')
    .select('recipient_id, type, params, entity_type, entity_id')
    .eq('id', parsed.data.notification_id)
    .maybeSingle();
  if (nErr) {
    console.error('push-send: notification load failed', { code: nErr.code });
    return json({ error: 'server_error' }, 500);
  }
  if (!row) return json({ ok: true, sent: 0 }, 200); // dismissed before we ran — nothing to do

  const notification = row as NotificationRow;

  const { data: tokens, error: tErr } = await svc
    .from('device_tokens')
    .select('token, locale')
    .eq('user_id', notification.recipient_id);
  if (tErr) {
    console.error('push-send: token load failed', { code: tErr.code });
    return json({ error: 'server_error' }, 500);
  }
  if (!tokens || tokens.length === 0) return json({ ok: true, sent: 0 }, 200);

  // One Expo message per device, in that device's language. `data` carries the
  // deep-link target so the tap handler routes (mirrors notificationHref()).
  const data = {
    notification_id: parsed.data.notification_id,
    entity_type: notification.entity_type,
    entity_id: notification.entity_id,
    type: notification.type,
  };
  const messages = tokens.map((tk) => {
    const { title, body } = render(notification, (tk.locale as Locale) ?? 'en');
    return { to: tk.token as string, title, body, sound: 'default', data };
  });

  let tickets: Array<{ status?: string; details?: { error?: string } }> = [];
  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(messages.slice(0, 100)), // Expo caps a batch at 100
    });
    const out = (await res.json()) as { data?: typeof tickets };
    tickets = out.data ?? [];
  } catch (e) {
    console.error('push-send: expo request failed', { message: (e as Error).message });
    return json({ error: 'server_error' }, 500);
  }

  // Prune tokens Expo reports as permanently dead (app uninstalled / token rotated),
  // so the registry stays clean and we stop paying to push to nowhere.
  const dead: string[] = [];
  tickets.forEach((ticket, i) => {
    if (ticket.status === 'error' && ticket.details?.error === 'DeviceNotRegistered') {
      const token = messages[i]?.to;
      if (token) dead.push(token);
    }
  });
  if (dead.length > 0) {
    const { error: dErr } = await svc.from('device_tokens').delete().in('token', dead);
    if (dErr) console.error('push-send: dead-token prune failed', { code: dErr.code });
  }

  return json({ ok: true, sent: messages.length, pruned: dead.length }, 200);
});
