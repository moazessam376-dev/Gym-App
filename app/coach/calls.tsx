// Coach calls hub — replaces the "coming soon" placeholder. Three sections:
//   • Requests   — pending booking requests; Accept (resolve-call-request) links the slot
//                  + notifies the client, Decline reopens it.
//   • Upcoming   — confirmed/live calls; Join opens the room (Phase A: Jitsi via the adapter).
//   • Availability — publish / close / delete discrete bookable slots (Calendly-style, no
//                  recurrence). Date+time are typed (works on web + Expo Go); a native picker
//                  is a later enhancement.
// Coach-only; others redirect. Reached from the web sidebar + Settings "Manage hours".
import { useState } from 'react';
import { View } from 'react-native';
import { Redirect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../src/lib/auth-context';
import { textStart } from '../../src/lib/rtl';
import { queryClient } from '../../src/lib/query';
import { confirm } from '../../src/lib/confirm';
import { joinCall } from '../../src/lib/callProvider';
import {
  closeSlot,
  createSlot,
  deleteSlot,
  reopenSlot,
  resolveCallRequest,
  type Call,
  type CoachCallSlot,
  type SlotStatus,
} from '../../src/lib/calls';
import { useCoachCallInbox, useCoachCalls, useMySlots } from '../../src/lib/queries/calls';
import {
  Badge,
  Button,
  EmptyState,
  GlassCard,
  Input,
  Screen,
  Segmented,
  Text,
  useToast,
  type BadgeTone,
} from '../../src/components/ui';
import { CallCard, fmtWhen } from '../../src/components/calls/CallCard';
import { theme } from '../../src/theme';

type Tab = 'requests' | 'upcoming' | 'availability';
const UPCOMING: Call['status'][] = ['accepted', 'ringing', 'in_progress'];

const SLOT_TONE: Record<SlotStatus, BadgeTone> = {
  open: 'success',
  held: 'warning',
  booked: 'primary',
  closed: 'neutral',
};

function toIso(dateStr: string, timeStr: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr) || !/^\d{2}:\d{2}$/.test(timeStr)) return null;
  const d = new Date(`${dateStr}T${timeStr}:00`);
  if (Number.isNaN(d.getTime()) || d.getTime() <= Date.now()) return null;
  return d.toISOString();
}

function invalidateCalls() {
  queryClient.invalidateQueries({ queryKey: ['coach-call-inbox'] });
  queryClient.invalidateQueries({ queryKey: ['coach-calls'] });
  queryClient.invalidateQueries({ queryKey: ['my-slots'] });
}

// ── Requests inbox ─────────────────────────────────────────────────────────────
function RequestsTab() {
  const { t } = useTranslation();
  const toast = useToast();
  const inboxQ = useCoachCallInbox();
  const [busyId, setBusyId] = useState<string | null>(null);
  const requests = inboxQ.data ?? [];

  const resolve = (c: Call, decision: 'accept' | 'decline') => async () => {
    setBusyId(c.id);
    try {
      await resolveCallRequest(c.id, decision);
      invalidateCalls();
      toast.show(decision === 'accept' ? t('calls.coach.accepted') : t('calls.coach.declined'));
    } catch {
      toast.show(t('calls.error.generic'), 'error');
    } finally {
      setBusyId(null);
    }
  };

  if (requests.length === 0 && !inboxQ.isPending) {
    return <EmptyState icon="user-plus" title={t('calls.coach.requestsEmpty')} subtitle={t('calls.coach.requestsEmptySub')} />;
  }
  return (
    <View style={{ gap: theme.spacing.md }}>
      {requests.map((c) => (
        <CallCard
          key={c.id}
          call={c}
          counterpartName={c.client_name}
          actions={
            <>
              <View style={{ flex: 1 }}>
                <Button title={t('calls.coach.decline')} variant="ghost" onPress={resolve(c, 'decline')} disabled={busyId === c.id} />
              </View>
              <View style={{ flex: 1 }}>
                <Button title={t('calls.coach.accept')} onPress={resolve(c, 'accept')} loading={busyId === c.id} />
              </View>
            </>
          }
        />
      ))}
    </View>
  );
}

// ── Upcoming calls ──────────────────────────────────────────────────────────────
function UpcomingTab() {
  const { t } = useTranslation();
  const toast = useToast();
  const callsQ = useCoachCalls();
  const upcoming = (callsQ.data ?? []).filter((c) => UPCOMING.includes(c.status));

  const join = (c: Call) => () => joinCall(c).catch(() => toast.show(t('calls.error.generic'), 'error'));

  if (upcoming.length === 0 && !callsQ.isPending) {
    return <EmptyState icon="video" title={t('calls.coach.upcomingEmpty')} subtitle={t('calls.coach.upcomingEmptySub')} />;
  }
  return (
    <View style={{ gap: theme.spacing.md }}>
      {upcoming.map((c) => (
        <CallCard
          key={c.id}
          call={c}
          counterpartName={c.client_name}
          actions={
            <View style={{ flex: 1 }}>
              <Button title={t('calls.join')} onPress={join(c)} />
            </View>
          }
        />
      ))}
    </View>
  );
}

// ── Slot row ────────────────────────────────────────────────────────────────────
function SlotRow({ slot, onChange }: { slot: CoachCallSlot; onChange: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const locked = slot.status === 'held' || slot.status === 'booked';

  const run = (fn: () => Promise<void>) => async () => {
    setBusy(true);
    try {
      await fn();
      onChange();
    } catch (e) {
      if ((e as Error)?.message !== 'cancelled-by-user') toast.show(t('calls.error.generic'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = run(async () => {
    const ok = await confirm(t('calls.availability.deleteConfirm'), '', t('calls.availability.delete'), t('common.cancel'));
    if (!ok) throw new Error('cancelled-by-user');
    await deleteSlot(slot.id);
  });

  return (
    <GlassCard style={{ gap: theme.spacing.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text variant="bodyStrong" style={textStart} numberOfLines={1}>{fmtWhen(slot.starts_at)}</Text>
          <Text variant="caption" muted style={textStart}>{t('calls.book.minutes', { count: slot.duration_minutes })}</Text>
        </View>
        <Badge label={t(`calls.availability.slot.${slot.status}`)} tone={SLOT_TONE[slot.status]} />
      </View>
      {!locked ? (
        <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
          <View style={{ flex: 1 }}>
            {slot.status === 'open' ? (
              <Button title={t('calls.availability.close')} variant="ghost" onPress={run(() => closeSlot(slot.id))} disabled={busy} />
            ) : (
              <Button title={t('calls.availability.reopen')} variant="ghost" onPress={run(() => reopenSlot(slot.id))} disabled={busy} />
            )}
          </View>
          <View style={{ flex: 1 }}>
            <Button title={t('calls.availability.delete')} variant="danger" onPress={remove} loading={busy} />
          </View>
        </View>
      ) : null}
    </GlassCard>
  );
}

// ── Availability editor ───────────────────────────────────────────────────────────
function AvailabilityTab({ coachId }: { coachId: string }) {
  const { t } = useTranslation();
  const toast = useToast();
  const slotsQ = useMySlots();
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [duration, setDuration] = useState('30');
  const [busy, setBusy] = useState(false);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['my-slots'] });
    queryClient.invalidateQueries({ queryKey: ['coach-open-slots'] });
  };

  const publish = async () => {
    const iso = toIso(date.trim(), time.trim());
    if (!iso) {
      toast.show(t('calls.availability.invalidTime'), 'error');
      return;
    }
    setBusy(true);
    try {
      await createSlot(coachId, iso, Number(duration));
      setDate('');
      setTime('');
      refresh();
    } catch {
      toast.show(t('calls.error.generic'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const slots = slotsQ.data ?? [];

  return (
    <View style={{ gap: theme.spacing.lg }}>
      <GlassCard style={{ gap: theme.spacing.md }}>
        <Text variant="bodyStrong" style={textStart}>{t('calls.availability.addTitle')}</Text>
        <Input label={t('calls.availability.date')} value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" autoCapitalize="none" />
        <Input label={t('calls.availability.time')} value={time} onChangeText={setTime} placeholder="HH:MM" autoCapitalize="none" />
        <View style={{ gap: theme.spacing.xs }}>
          <Text variant="label" muted style={textStart}>{t('calls.availability.duration')}</Text>
          <Segmented
            options={['15', '30', '45', '60'].map((d) => ({ value: d, label: t('calls.book.minutes', { count: Number(d) }) }))}
            value={duration}
            onChange={setDuration}
          />
        </View>
        <Button title={t('calls.availability.publish')} onPress={publish} loading={busy} fullWidth />
      </GlassCard>

      {slots.length === 0 && !slotsQ.isPending ? (
        <EmptyState icon="calendar" title={t('calls.availability.empty')} />
      ) : (
        <View style={{ gap: theme.spacing.md }}>
          {slots.map((s) => (
            <SlotRow key={s.id} slot={s} onChange={refresh} />
          ))}
        </View>
      )}
    </View>
  );
}

export default function CoachCallsScreen() {
  const { t } = useTranslation();
  const { role, session } = useAuth();
  const [tab, setTab] = useState<Tab>('requests');

  if (role && role !== 'coach') return <Redirect href="/" />;
  const coachId = session?.user?.id;

  return (
    <Screen scroll gradient contentStyle={{ padding: theme.spacing.lg, gap: theme.spacing.lg }}>
      <View style={{ gap: 2 }}>
        <Text variant="h1" style={textStart}>{t('calls.coach.title')}</Text>
        <Text variant="caption" muted style={textStart}>{t('calls.coach.subtitle')}</Text>
      </View>

      <Segmented
        options={[
          { value: 'requests', label: t('calls.coach.tabRequests') },
          { value: 'upcoming', label: t('calls.coach.tabUpcoming') },
          { value: 'availability', label: t('calls.coach.tabAvailability') },
        ]}
        value={tab}
        onChange={(v) => setTab(v as Tab)}
      />

      {tab === 'requests' ? <RequestsTab /> : null}
      {tab === 'upcoming' ? <UpcomingTab /> : null}
      {tab === 'availability' && coachId ? <AvailabilityTab coachId={coachId} /> : null}
    </Screen>
  );
}
