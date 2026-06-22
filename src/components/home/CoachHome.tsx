// Coach "Performance Hub" — Neon Glassy Dark (blue family). Twin stat hero, top
// performers with trend sparklines, and a recent-activity feed. No quick-action
// grid (it duplicated the bottom tabs).
// Real data: active client count + pending invites. DEMO data: top performers +
// activity (see src/mock/dashboard.ts) — remove MOCK_* when the InBody ranking
// system lands.
import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { listMyClients, listMyInvitations } from '@/lib/invitations';
import { getMyName } from '@/lib/profile';
import { useAuth } from '@/lib/auth-context';
import { Screen, Text, Avatar, GlassCard, StatBlock, EmptyState } from '@/components/ui';
import { theme } from '@/theme';
import { getBodyMetricsBoard, rankBoard, type BoardRow, type GoalProgress } from '@/lib/body-metrics';
import { MOCK_ACTIVITY } from '@/mock/dashboard';

type IconName = keyof typeof Ionicons.glyphMap;

export default function CoachHome() {
  const { session } = useAuth();
  const router = useRouter();
  const userId = session?.user?.id;
  const [name, setName] = useState<string | null>(null);
  const [clients, setClients] = useState(0);
  const [pending, setPending] = useState(0);
  const [board, setBoard] = useState<(BoardRow & { progress: GoalProgress; rank: number })[]>([]);

  const load = useCallback(async () => {
    // allSettled so the (newer) body-metrics board can't blank the dashboard if it
    // errors before the roster/invites load.
    const [n, cs, invs, bm] = await Promise.allSettled([
      userId ? getMyName(userId) : Promise.resolve(null),
      listMyClients(),
      listMyInvitations(),
      getBodyMetricsBoard(),
    ]);
    if (n.status === 'fulfilled') setName(n.value);
    if (cs.status === 'fulfilled') setClients(cs.value.length);
    if (invs.status === 'fulfilled') setPending(invs.value.filter((i) => i.status === 'pending').length);
    if (bm.status === 'fulfilled') setBoard(rankBoard(bm.value));
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const go = (href: Href) => () => router.push(href);
  const pad2 = (n: number) => String(n).padStart(2, '0');

  return (
    <Screen scroll gradient contentStyle={{ paddingTop: theme.spacing.md, gap: theme.spacing.xl }}>
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flex: 1 }}>
          <Text variant="label" color="primary">
            PERFORMANCE HUB
          </Text>
          <Text variant="h1">{name ? name.split(' ')[0] : 'Coach'}</Text>
        </View>
        <Avatar name={name ?? 'Coach'} size={48} />
      </View>

      {/* Twin hero stats */}
      <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
        <LinearGradient
          colors={theme.gradients.hero}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{
            flex: 1,
            borderRadius: theme.radii.lg,
            borderWidth: 1,
            borderColor: theme.colors.glassBorder,
            padding: theme.spacing.lg,
          }}
        >
          <StatBlock value={pad2(clients)} label="Active clients" valueColor={theme.colors.primary} />
        </LinearGradient>
        <View
          style={{
            flex: 1,
            backgroundColor: theme.colors.glass,
            borderRadius: theme.radii.lg,
            borderWidth: 1,
            borderColor: theme.colors.glassBorder,
            padding: theme.spacing.lg,
          }}
        >
          <StatBlock
            value={pad2(pending)}
            label="Pending invites"
            valueColor={pending > 0 ? theme.colors.warning : theme.colors.text}
          />
        </View>
      </View>

      {/* Top performers — REAL, ranked by goal-relative InBody progress (0026) */}
      <View style={{ gap: theme.spacing.md }}>
        <Text variant="label" muted>
          Top performers · body composition
        </Text>

        {board.length === 0 ? (
          <EmptyState
            icon="trophy-outline"
            title="No verified readings yet"
            subtitle="Record an InBody reading from a client’s profile and your ranked board appears here."
          />
        ) : (
          board.map((r) => (
            <GlassCard
              key={r.client_id}
              glowColor={r.rank === 1 && r.progress.hasTrend ? theme.colors.primary : undefined}
              onPress={() =>
                router.push({ pathname: '/coach/client/[id]', params: { id: r.client_id, name: r.full_name ?? '' } })
              }
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
                <Text
                  variant="title"
                  color={r.rank === 1 ? theme.colors.primary : theme.colors.textMuted}
                  style={{ width: 18 }}
                >
                  {r.rank}
                </Text>
                <Avatar name={r.full_name ?? 'Client'} size={40} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text variant="bodyStrong">{r.full_name ?? 'Client'}</Text>
                  <Text variant="caption" color={r.progress.hasTrend ? 'primary' : theme.colors.textMuted}>
                    {r.progress.headline}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={theme.colors.textMuted} />
              </View>
            </GlassCard>
          ))
        )}
      </View>

      {/* Recent activity (DEMO) */}
      <View style={{ gap: theme.spacing.md }}>
        <Text variant="label" muted>
          Recent activity
        </Text>
        <GlassCard padded={false} style={{ overflow: 'hidden' }}>
          {MOCK_ACTIVITY.map((a, i) => (
            <View
              key={a.id}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: theme.spacing.md,
                padding: theme.spacing.lg,
                borderTopWidth: i === 0 ? 0 : 1,
                borderTopColor: theme.colors.glassBorder,
              }}
            >
              <View
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: theme.radii.sm,
                  backgroundColor: theme.colors.glassStrong,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name={`${a.icon}-outline` as IconName} size={16} color={theme.colors.primary} />
              </View>
              <Text variant="body" style={{ flex: 1 }}>
                {a.text}
              </Text>
              <Text variant="caption" muted>
                {a.when}
              </Text>
            </View>
          ))}
        </GlassCard>
      </View>
    </Screen>
  );
}
