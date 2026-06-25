// Coach → assign a template to one of their clients. Picking a client deep-clones
// the template into a new DRAFT plan (assign_plan_to_client RPC) and opens it.
import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, View } from 'react-native';
import { Redirect, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../../src/lib/auth-context';
import { forwardChevron, textStart } from '../../../src/lib/rtl';
import { listMyClients, type Client } from '../../../src/lib/invitations';
import { assignPlanToClient } from '../../../src/lib/plans';
import { Icon, Screen, Text, Avatar, GlassCard, EmptyState } from '../../../src/components/ui';
import { theme } from '../../../src/theme';

export default function AssignTemplate() {
  const { t } = useTranslation();
  const { role } = useAuth();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [assigning, setAssigning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setClients(await listMyClients());
    } catch {
      /* keep prior */
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (role && role !== 'coach') return <Redirect href="/" />;

  async function onAssign(client: Client) {
    if (!id || assigning) return;
    setError(null);
    setAssigning(true);
    try {
      const newId = await assignPlanToClient(id, client.id);
      router.replace({ pathname: '/coach/plan/[id]', params: { id: newId } });
    } catch {
      setError(t('assign.error'));
      setAssigning(false);
    }
  }

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.bg }}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  return (
    <Screen gradient padded={false} edges={['bottom']}>
      <FlatList
        data={clients}
        keyExtractor={(c) => c.id}
        contentContainerStyle={clients.length === 0 ? { flexGrow: 1, justifyContent: 'center' } : { padding: theme.spacing.lg, gap: theme.spacing.md }}
        ListHeaderComponent={
          clients.length === 0 ? null : (
            <View style={{ marginBottom: theme.spacing.xs }}>
              <Text variant="body" muted style={textStart}>
                {t('assign.intro')}
              </Text>
              {error ? (
                <Text variant="caption" color="danger" style={{ marginTop: theme.spacing.sm }}>
                  {error}
                </Text>
              ) : null}
              {assigning ? <ActivityIndicator style={{ marginVertical: theme.spacing.sm }} color={theme.colors.primary} /> : null}
            </View>
          )
        }
        ListEmptyComponent={
          <EmptyState icon="people-outline" title={t('assign.noClientsTitle')} subtitle={t('assign.noClientsSub')} />
        }
        renderItem={({ item }) => {
          const label = item.full_name ?? item.invited_email ?? t('home.client');
          return (
            <GlassCard onPress={() => onAssign(item)}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
                <Avatar name={label} size={40} />
                <Text variant="title" style={{ flex: 1 }}>
                  {label}
                </Text>
                <Icon name={forwardChevron()} size={20} color={theme.colors.textMuted} />
              </View>
            </GlassCard>
          );
        }}
      />
    </Screen>
  );
}
