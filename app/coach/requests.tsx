// Coach request inbox (Slice G2). Pending "request a coach" requests addressed to this
// coach; accept links the client (resolve-coach-request Edge fn), decline dismisses it.
// Coach-only; others redirect. Reached from the Clients tab header + the coach_request
// notification.
import { useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';
import { Redirect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../src/lib/auth-context';
import { textStart } from '../../src/lib/rtl';
import { queryClient } from '../../src/lib/query';
import { useIncomingCoachRequests } from '../../src/lib/queries/coach-requests';
import { resolveCoachRequest, type IncomingCoachRequest } from '../../src/lib/coach-requests';
import { Screen, Text, GlassCard, Avatar, Button, EmptyState, useToast } from '../../src/components/ui';
import { theme } from '../../src/theme';

function RequestCard({
  req,
  busy,
  onAccept,
  onDecline,
}: {
  req: IncomingCoachRequest;
  busy: boolean;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const { t } = useTranslation();
  return (
    <GlassCard style={{ gap: theme.spacing.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
        <Avatar name={req.client_name ?? t('home.client')} size={44} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="title" style={textStart}>
            {req.client_name ?? t('home.client')}
          </Text>
          {req.message ? (
            <Text variant="caption" muted style={textStart} numberOfLines={4}>
              {req.message}
            </Text>
          ) : (
            <Text variant="caption" muted style={textStart}>
              {t('coachRequest.noMessage')}
            </Text>
          )}
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
        <View style={{ flex: 1 }}>
          <Button title={t('coachRequest.decline')} variant="ghost" onPress={onDecline} disabled={busy} />
        </View>
        <View style={{ flex: 1 }}>
          <Button title={t('coachRequest.accept')} onPress={onAccept} loading={busy} />
        </View>
      </View>
    </GlassCard>
  );
}

export default function CoachRequestsScreen() {
  const { t } = useTranslation();
  const { role } = useAuth();
  const toast = useToast();
  const requestsQ = useIncomingCoachRequests(role === 'coach');
  const [busyId, setBusyId] = useState<string | null>(null);

  if (role && role !== 'coach') return <Redirect href="/" />;

  const requests = requestsQ.data ?? [];

  const resolve = (req: IncomingCoachRequest, decision: 'accept' | 'decline') => async () => {
    setBusyId(req.id);
    try {
      await resolveCoachRequest({ request_id: req.id, decision });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['incoming-coach-requests'] }),
        queryClient.invalidateQueries({ queryKey: ['my-clients'] }),
      ]);
      toast.show(decision === 'accept' ? t('coachRequest.accepted') : t('coachRequest.declined'));
    } catch {
      toast.show(t('common.error'), 'error');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Screen padded={false} gradient>
      <View style={{ paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.lg }}>
        <Text variant="h1" style={textStart}>
          {t('coachRequest.inboxTitle')}
        </Text>
        <Text variant="caption" muted style={textStart}>
          {t('coachRequest.inboxSub')}
        </Text>
      </View>
      <FlatList
        data={requests}
        keyExtractor={(r) => r.id}
        contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.md, flexGrow: 1 }}
        refreshControl={
          <RefreshControl refreshing={false} onRefresh={() => requestsQ.refetch()} tintColor={theme.colors.primary} />
        }
        ListEmptyComponent={
          requestsQ.isPending ? null : (
            <EmptyState
              icon="user-plus"
              title={t('coachRequest.emptyTitle')}
              subtitle={t('coachRequest.emptySub')}
            />
          )
        }
        renderItem={({ item }) => (
          <RequestCard
            req={item}
            busy={busyId === item.id}
            onAccept={resolve(item, 'accept')}
            onDecline={resolve(item, 'decline')}
          />
        )}
      />
    </Screen>
  );
}
