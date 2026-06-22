// Client → progress tab. Streak + recent workout history from completion logging.
import { useCallback, useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useAuth } from '../../src/lib/auth-context';
import { getStreak, listSessions, type WorkoutSession } from '../../src/lib/sessions';
import { Screen, Text, Card, Badge, EmptyState } from '../../src/components/ui';
import { theme } from '../../src/theme';

function formatDate(d: string): string {
  // d is 'YYYY-MM-DD' — render as a friendly local label.
  const [y, m, day] = d.split('-').map(Number);
  return new Date(y, m - 1, day).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

export default function ProgressTab() {
  const { session } = useAuth();
  const router = useRouter();
  const userId = session?.user?.id;
  const [streak, setStreak] = useState(0);
  const [sessions, setSessions] = useState<WorkoutSession[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      const [s, list] = await Promise.all([getStreak(userId), listSessions(userId)]);
      setStreak(s);
      setSessions(list);
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

  const completed = sessions.filter((s) => s.status === 'completed').length;

  return (
    <Screen padded={false} gradient>
      <View style={{ paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.lg }}>
        <Text variant="h1">Progress</Text>
      </View>
      <FlatList
        data={sessions}
        keyExtractor={(s) => s.id}
        contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.md, flexGrow: 1 }}
        refreshControl={
          <RefreshControl refreshing={false} onRefresh={load} tintColor={theme.colors.primary} />
        }
        ListHeaderComponent={
          <View style={{ flexDirection: 'row', gap: theme.spacing.md, marginBottom: theme.spacing.sm }}>
            <Card style={{ flex: 1, alignItems: 'center', gap: 4 }}>
              <Text variant="display" color="primary">
                {streak}
              </Text>
              <Text variant="label" muted>
                Day streak 🔥
              </Text>
            </Card>
            <Card style={{ flex: 1, alignItems: 'center', gap: 4 }}>
              <Text variant="display">{completed}</Text>
              <Text variant="label" muted>
                Workouts done
              </Text>
            </Card>
          </View>
        }
        ListEmptyComponent={
          loading ? null : (
            <EmptyState
              icon="trending-up-outline"
              title="No workouts logged yet"
              subtitle="Log your first workout from Home and your history will appear here."
            />
          )
        }
        renderItem={({ item }) => {
          // Tappable when it points at a planned day — opens/continues that workout.
          const open = item.day_id
            ? () =>
                router.push({
                  pathname: '/client/workout/[dayId]',
                  params: { dayId: item.day_id!, planId: item.plan_id ?? '' },
                })
            : undefined;
          return (
            <Card onPress={open}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
                <Ionicons
                  name={item.status === 'completed' ? 'checkmark-circle' : 'ellipse-outline'}
                  size={26}
                  color={item.status === 'completed' ? theme.colors.success : theme.colors.textMuted}
                />
                <View style={{ flex: 1 }}>
                  <Text variant="bodyStrong">{formatDate(item.session_date)}</Text>
                  <Text variant="caption" muted>
                    {item.note ? item.note : item.status === 'in_progress' ? 'Tap to continue' : 'Tap to review'}
                  </Text>
                </View>
                <Badge
                  label={item.status === 'in_progress' ? 'in progress' : item.status}
                  tone={item.status === 'completed' ? 'success' : 'neutral'}
                />
              </View>
            </Card>
          );
        }}
      />
    </Screen>
  );
}
