// Coach → pick a client to generate an AI plan FOR. AI plan-gen is client-scoped
// (it reads the client's goals/profile), so this picker funnels into the EXISTING
// generator: selecting a client opens their detail with the AI modal already open
// (?openAi=1) — no duplicate generator. Reached from new-plan's "Generate with AI".
import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, View } from 'react-native';
import { Redirect, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../src/lib/auth-context';
import { forwardChevron, textStart } from '../../src/lib/rtl';
import { listMyClients, type Client } from '../../src/lib/invitations';
import { planTypeSchema, type PlanType } from '../../src/schemas/plan';
import { Icon, Screen, Text, Avatar, GlassCard, EmptyState } from '../../src/components/ui';
import { theme } from '../../src/theme';

export default function AiPlanPicker() {
  const { t } = useTranslation();
  const { role } = useAuth();
  const router = useRouter();
  const params = useLocalSearchParams<{ type?: string }>();
  const type: PlanType = planTypeSchema.safeParse(params.type).success ? (params.type as PlanType) : 'training';

  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);

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

  // Hand off to the client's detail with the AI modal pre-opened on the chosen type.
  function onPick(client: Client) {
    const label = client.full_name ?? client.invited_email ?? t('home.client');
    router.replace({
      pathname: '/coach/client/[id]',
      params: { id: client.id, name: label, openAi: '1', aiType: type },
    });
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
        contentContainerStyle={
          clients.length === 0
            ? { flexGrow: 1, justifyContent: 'center' }
            : { padding: theme.spacing.lg, gap: theme.spacing.md }
        }
        ListHeaderComponent={
          clients.length === 0 ? null : (
            <Text variant="body" muted style={[{ marginBottom: theme.spacing.xs }, textStart]}>
              {t('aiPlan.intro')}
            </Text>
          )
        }
        ListEmptyComponent={
          <EmptyState icon="people-outline" title={t('aiPlan.noClientsTitle')} subtitle={t('aiPlan.noClientsSub')} />
        }
        renderItem={({ item }) => {
          const label = item.full_name ?? item.invited_email ?? t('home.client');
          return (
            <GlassCard onPress={() => onPick(item)}>
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
