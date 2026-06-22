// Client → progress tab (Phase 11 hub). Streak + workout history (completion
// logging) PLUS the progress pillars: weight trend, photos, and InBody scans.
// Each pillar card taps through to its dedicated screen.
import { useCallback, useMemo, useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useAuth } from '../../src/lib/auth-context';
import { getStreak, listSessions, type WorkoutSession } from '../../src/lib/sessions';
import { listProgressWeights, type WeightEntry } from '../../src/lib/progress';
import { countMediaFor } from '../../src/lib/media';
import { getMyAthleteProfile } from '../../src/lib/athlete-profile';
import { gramsToDisplay, formatWeight, type WeightUnit } from '../../src/lib/units';
import { Screen, Text, Card, GlassCard, Badge, EmptyState, LineChart } from '../../src/components/ui';
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

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// One tappable pillar row (Photos / InBody): icon + label + count + chevron.
function PillarRow({
  icon,
  label,
  hint,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  hint: string;
  onPress: () => void;
}) {
  return (
    <GlassCard onPress={onPress}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: theme.radii.md,
            backgroundColor: theme.colors.glassStrong,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name={icon} size={20} color={theme.colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text variant="bodyStrong">{label}</Text>
          <Text variant="caption" muted>
            {hint}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={theme.colors.textMuted} />
      </View>
    </GlassCard>
  );
}

export default function ProgressTab() {
  const { session } = useAuth();
  const router = useRouter();
  const userId = session?.user?.id;
  const [streak, setStreak] = useState(0);
  const [sessions, setSessions] = useState<WorkoutSession[]>([]);
  const [weights, setWeights] = useState<WeightEntry[]>([]);
  const [unit, setUnit] = useState<WeightUnit>('kg');
  const [photoCount, setPhotoCount] = useState(0);
  const [inbodyCount, setInbodyCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!userId) return;
    // allSettled so one failing read can't blank the whole screen (e.g. an empty
    // media list vs a transient error on another call).
    const [s, list, w, profile, photos, inbody] = await Promise.allSettled([
      getStreak(userId),
      listSessions(userId),
      listProgressWeights(userId),
      getMyAthleteProfile(userId),
      countMediaFor(userId, 'progress_photo'),
      countMediaFor(userId, 'inbody'),
    ]);
    if (s.status === 'fulfilled') setStreak(s.value);
    if (list.status === 'fulfilled') setSessions(list.value);
    if (w.status === 'fulfilled') setWeights(w.value);
    if (profile.status === 'fulfilled' && profile.value?.weight_unit) setUnit(profile.value.weight_unit);
    if (photos.status === 'fulfilled') setPhotoCount(photos.value);
    if (inbody.status === 'fulfilled') setInbodyCount(inbody.value);
    setLoading(false);
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const completed = sessions.filter((s) => s.status === 'completed').length;

  const chartData = useMemo(
    () => weights.map((e) => ({ value: gramsToDisplay(e.weight_grams, unit) ?? 0, label: shortDate(e.recorded_at) })),
    [weights, unit],
  );
  const latestWeight = weights.length ? weights[weights.length - 1]! : null;

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
          <View style={{ gap: theme.spacing.md, marginBottom: theme.spacing.sm }}>
            <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
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

            {/* Weight trend */}
            <GlassCard onPress={() => router.push('/client/progress/weight')} style={{ gap: theme.spacing.sm }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text variant="label" muted>
                  Weight
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xs }}>
                  <Text variant="bodyStrong" color="primary">
                    {latestWeight ? formatWeight(latestWeight.weight_grams, unit) : 'Log weight'}
                  </Text>
                  <Ionicons name="chevron-forward" size={18} color={theme.colors.textMuted} />
                </View>
              </View>
              {chartData.length >= 2 ? (
                <LineChart data={chartData} unit={` ${unit}`} height={140} />
              ) : (
                <Text variant="caption" muted>
                  {latestWeight ? 'Log again to see your trend.' : 'Track your body weight over time.'}
                </Text>
              )}
            </GlassCard>

            {/* Photos + InBody */}
            <PillarRow
              icon="camera"
              label="Progress photos"
              hint={photoCount > 0 ? `${photoCount} photo${photoCount === 1 ? '' : 's'}` : 'Add your first photo'}
              onPress={() => router.push('/client/progress/photos')}
            />
            <PillarRow
              icon="document-text"
              label="InBody scans"
              hint={inbodyCount > 0 ? `${inbodyCount} scan${inbodyCount === 1 ? '' : 's'}` : 'Add a body-composition scan'}
              onPress={() => router.push('/client/progress/inbody')}
            />

            <Text variant="label" muted style={{ marginTop: theme.spacing.xs }}>
              Recent workouts
            </Text>
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
