// CoachCallsDesktop — the wide-web dashboard for the coach Calls hub (portal design, like
// ClientsDesktop). A KPI summary row + a two-column body: LEFT = the month-grid availability
// calendar; RIGHT = pending booking requests + upcoming calls. Rendered ONLY in the coach web
// shell (coach/calls.tsx returns this when useChrome().active). Reuses the SAME data hooks +
// CallCard + AvailabilityCalendar as the mobile hub — no new query.
import { useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/lib/auth-context';
import { textStart } from '@/lib/rtl';
import { queryClient } from '@/lib/query';
import { joinCall } from '@/lib/callProvider';
import { AUTH_EXPIRED, resolveCallRequest, type Call } from '@/lib/calls';
import { useCoachCallInbox, useCoachCalls, useMySlots } from '@/lib/queries/calls';
import { Button, EmptyState, KpiTile, Screen, Text, useToast } from '@/components/ui';
import { CallCard } from '@/components/calls/CallCard';
import { AvailabilityCalendar } from '@/components/calls/AvailabilityCalendar';
import { theme } from '@/theme';

const UPCOMING: Call['status'][] = ['accepted', 'ringing', 'in_progress'];

export function CoachCallsDesktop() {
  const { t } = useTranslation();
  const toast = useToast();
  const { session } = useAuth();
  const coachId = session?.user?.id;
  const inboxQ = useCoachCallInbox();
  const callsQ = useCoachCalls();
  const slotsQ = useMySlots();
  const [busyId, setBusyId] = useState<string | null>(null);

  const requests = inboxQ.data ?? [];
  const upcoming = (callsQ.data ?? []).filter((c) => UPCOMING.includes(c.status));
  const openSlots = (slotsQ.data ?? []).filter((s) => s.status === 'open').length;

  const refreshAll = () => {
    queryClient.invalidateQueries({ queryKey: ['coach-call-inbox'] });
    queryClient.invalidateQueries({ queryKey: ['coach-calls'] });
    queryClient.invalidateQueries({ queryKey: ['my-slots'] });
    queryClient.invalidateQueries({ queryKey: ['coach-open-slots'] });
  };

  const resolve = (c: Call, decision: 'accept' | 'decline') => async () => {
    setBusyId(c.id);
    try {
      await resolveCallRequest(c.id, decision);
      refreshAll();
      toast.show(decision === 'accept' ? t('calls.coach.accepted') : t('calls.coach.declined'));
    } catch (e) {
      toast.show((e as Error)?.message === AUTH_EXPIRED ? t('calls.error.sessionExpired') : t('calls.error.generic'), 'error');
    } finally {
      setBusyId(null);
    }
  };
  const join = (c: Call) => () => joinCall(c).catch(() => toast.show(t('calls.error.generic'), 'error'));

  return (
    <Screen scroll gradient contentStyle={{ padding: theme.spacing.xl, gap: theme.spacing.xl }}>
      <View style={{ gap: 2 }}>
        <Text variant="h1" style={textStart}>{t('calls.coach.title')}</Text>
        <Text variant="caption" muted style={textStart}>{t('calls.coach.subtitle')}</Text>
      </View>

      <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
        <KpiTile value={String(requests.length)} label={t('calls.coach.tabRequests')} tone="warning" icon="user-plus" />
        <KpiTile value={String(upcoming.length)} label={t('calls.coach.tabUpcoming')} tone="primary" icon="video" />
        <KpiTile value={String(openSlots)} label={t('calls.availability.slot.open')} tone="neutral" icon="calendar" />
      </View>

      <View style={{ flexDirection: 'row', gap: theme.spacing.xl, alignItems: 'flex-start' }}>
        {/* Left: availability calendar */}
        <View style={{ flex: 1.4 }}>
          <Text variant="label" muted style={[textStart, { marginBottom: theme.spacing.md }]}>{t('calls.coach.tabAvailability')}</Text>
          {coachId ? <AvailabilityCalendar slots={slotsQ.data ?? []} coachId={coachId} onChanged={refreshAll} /> : null}
        </View>

        {/* Right: requests + upcoming */}
        <View style={{ flex: 1, gap: theme.spacing.xl }}>
          <View style={{ gap: theme.spacing.md }}>
            <Text variant="label" muted style={textStart}>{t('calls.coach.tabRequests')}</Text>
            {requests.length === 0 ? (
              <EmptyState icon="user-plus" title={t('calls.coach.requestsEmpty')} subtitle={t('calls.coach.requestsEmptySub')} />
            ) : (
              requests.map((c) => (
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
              ))
            )}
          </View>

          <View style={{ gap: theme.spacing.md }}>
            <Text variant="label" muted style={textStart}>{t('calls.coach.tabUpcoming')}</Text>
            {upcoming.length === 0 ? (
              <EmptyState icon="video" title={t('calls.coach.upcomingEmpty')} subtitle={t('calls.coach.upcomingEmptySub')} />
            ) : (
              upcoming.map((c) => (
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
              ))
            )}
          </View>
        </View>
      </View>
    </Screen>
  );
}
