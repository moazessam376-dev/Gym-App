// Coach calls hub — three tabs:
//   • Requests     — pending booking requests; Accept (resolve-call-request) confirms + notifies,
//                    Decline reopens the slot.
//   • Upcoming     — confirmed/live calls; Join opens the room (Phase A: Jitsi via the adapter).
//   • Availability — a month-grid calendar editor: tap any day (weekends included), add/manage
//                    time slots for it (AvailabilityCalendar).
// Coach-only; others redirect. Reached from the web sidebar + Settings "Manage hours".
import { useState } from 'react';
import { View } from 'react-native';
import { Redirect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../src/lib/auth-context';
import { textStart } from '../../src/lib/rtl';
import { queryClient } from '../../src/lib/query';
import { joinCall } from '../../src/lib/callProvider';
import { resolveCallRequest, type Call } from '../../src/lib/calls';
import { useCoachCallInbox, useCoachCalls, useMySlots } from '../../src/lib/queries/calls';
import { Button, EmptyState, Screen, Segmented, Text, useToast } from '../../src/components/ui';
import { CallCard } from '../../src/components/calls/CallCard';
import { AvailabilityCalendar } from '../../src/components/calls/AvailabilityCalendar';
import { useChrome } from '../../src/lib/chrome';
import { CoachCallsDesktop } from '../../src/components/coach/web/CoachCallsDesktop';
import { theme } from '../../src/theme';

type Tab = 'requests' | 'upcoming' | 'availability';
const UPCOMING: Call['status'][] = ['accepted', 'ringing', 'in_progress'];

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

// ── Availability editor (month-grid calendar) ──────────────────────────────────────
function AvailabilityTab({ coachId }: { coachId: string }) {
  const slotsQ = useMySlots();
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['my-slots'] });
    queryClient.invalidateQueries({ queryKey: ['coach-open-slots'] });
  };
  return <AvailabilityCalendar slots={slotsQ.data ?? []} coachId={coachId} onChanged={refresh} />;
}

export default function CoachCallsScreen() {
  const { t } = useTranslation();
  const { role, session } = useAuth();
  const { active: wide } = useChrome();
  const [tab, setTab] = useState<Tab>('requests');

  if (role && role !== 'coach') return <Redirect href="/" />;
  if (wide) return <CoachCallsDesktop />; // portal dashboard on wide web
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
