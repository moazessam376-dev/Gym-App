// Client calls hub — "Book a call" + the client's upcoming and past calls. Join opens the
// call (Phase A: the Jitsi room via the adapter); Cancel retracts a pending/accepted booking.
// Client-only; others redirect. Reached from the Account screen + a Home card.
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Redirect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../src/lib/auth-context';
import { textStart } from '../src/lib/rtl';
import { queryClient } from '../src/lib/query';
import { confirm } from '../src/lib/confirm';
import { joinCall } from '../src/lib/callProvider';
import { cancelCall, type Call } from '../src/lib/calls';
import { useMyCalls } from '../src/lib/queries/calls';
import { Button, EmptyState, Screen, Text, useToast } from '../src/components/ui';
import { BookCallSheet } from '../src/components/calls/BookCallSheet';
import { CallCard } from '../src/components/calls/CallCard';
import { theme } from '../src/theme';

const UPCOMING: Call['status'][] = ['pending', 'accepted', 'ringing', 'in_progress'];

export default function ClientCallsScreen() {
  const { t } = useTranslation();
  const { role } = useAuth();
  const toast = useToast();
  const callsQ = useMyCalls(role === 'client');
  const [sheet, setSheet] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  if (role && role !== 'client') return <Redirect href="/" />;

  const calls = callsQ.data ?? [];
  const upcoming = calls.filter((c) => UPCOMING.includes(c.status));
  const past = calls.filter((c) => !UPCOMING.includes(c.status));

  const join = (c: Call) => () => {
    joinCall(c).catch(() => toast.show(t('calls.error.generic'), 'error'));
  };

  const cancel = (c: Call) => async () => {
    const ok = await confirm(t('calls.cancelConfirm'), t('calls.cancelConfirmBody'), t('calls.cancel'), t('common.cancel'));
    if (!ok) return;
    setBusyId(c.id);
    try {
      await cancelCall(c.id);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['my-calls'] }),
        queryClient.invalidateQueries({ queryKey: ['coach-open-slots'] }),
      ]);
    } catch {
      toast.show(t('calls.error.generic'), 'error');
    } finally {
      setBusyId(null);
    }
  };

  const actionsFor = (c: Call) => {
    const canJoin = c.status === 'accepted' || c.status === 'in_progress' || c.status === 'ringing';
    const canCancel = c.status === 'pending' || c.status === 'accepted';
    if (!canJoin && !canCancel) return undefined;
    return (
      <>
        {canJoin ? (
          <View style={{ flex: 1 }}>
            <Button title={t('calls.join')} onPress={join(c)} />
          </View>
        ) : null}
        {canCancel ? (
          <View style={{ flex: 1 }}>
            <Button title={t('calls.cancel')} variant="ghost" onPress={cancel(c)} loading={busyId === c.id} />
          </View>
        ) : null}
      </>
    );
  };

  return (
    <Screen scroll gradient contentStyle={{ padding: theme.spacing.lg, gap: theme.spacing.lg }}>
      <View style={{ gap: 2 }}>
        <Text variant="h1" style={textStart}>{t('calls.list.title')}</Text>
      </View>

      <Button title={t('calls.bookEntry')} onPress={() => setSheet(true)} fullWidth />

      {calls.length === 0 && !callsQ.isPending ? (
        <EmptyState icon="video" title={t('calls.list.empty')} subtitle={t('calls.list.emptySub')} />
      ) : null}

      {upcoming.length > 0 ? (
        <View style={{ gap: theme.spacing.md }}>
          <Text variant="label" muted style={textStart}>{t('calls.list.upcoming')}</Text>
          {upcoming.map((c) => (
            <CallCard key={c.id} call={c} actions={actionsFor(c)} />
          ))}
        </View>
      ) : null}

      {past.length > 0 ? (
        <View style={{ gap: theme.spacing.md }}>
          <Text variant="label" muted style={textStart}>{t('calls.list.past')}</Text>
          {past.map((c) => (
            <CallCard key={c.id} call={c} />
          ))}
        </View>
      ) : null}

      <BookCallSheet visible={sheet} onClose={() => setSheet(false)} />
    </Screen>
  );
}
