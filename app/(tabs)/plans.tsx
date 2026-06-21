// Client → my plans tab. RLS returns only this client's NON-draft plans.
import { useCallback, useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useAuth } from '../../src/lib/auth-context';
import { listPlansForClient, type Plan } from '../../src/lib/plans';
import { Screen, Text, Card, Badge, EmptyState } from '../../src/components/ui';
import { theme } from '../../src/theme';

export default function PlansTab() {
  const { session } = useAuth();
  const router = useRouter();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);

  const userId = session?.user?.id;
  const load = useCallback(async () => {
    if (!userId) return;
    try {
      setPlans(await listPlansForClient(userId));
    } catch {
      /* keep prior */
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  return (
    <Screen padded={false} gradient>
      <View style={{ paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.lg }}>
        <Text variant="h1">My plans</Text>
        <Text variant="caption" muted>
          Training & nutrition from your coach
        </Text>
      </View>
      <FlatList
        data={plans}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.md, flexGrow: 1 }}
        refreshControl={
          <RefreshControl refreshing={false} onRefresh={load} tintColor={theme.colors.primary} />
        }
        ListEmptyComponent={
          loading ? null : (
            <EmptyState
              icon="barbell-outline"
              title="No plans yet"
              subtitle="Your coach will share training and nutrition plans here."
            />
          )
        }
        renderItem={({ item }) => (
          <Card onPress={() => router.push({ pathname: '/client/plan/[id]', params: { id: item.id } })}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
              <View
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: theme.radii.md,
                  backgroundColor: theme.colors.surfaceElevated,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons
                  name={item.type === 'training' ? 'barbell' : 'restaurant'}
                  size={22}
                  color={theme.colors.primary}
                />
              </View>
              <View style={{ flex: 1, gap: 4 }}>
                <Text variant="title">{item.title}</Text>
                <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
                  <Badge label={item.type} tone="secondary" />
                  {item.status === 'archived' ? <Badge label="archived" tone="neutral" /> : null}
                </View>
              </View>
              <Ionicons name="chevron-forward" size={20} color={theme.colors.textMuted} />
            </View>
          </Card>
        )}
      />
    </Screen>
  );
}
