// Coach "Performance Hub" — Neon Glassy Dark (blue family). Twin stat hero + top
// performers ranked by goal-relative InBody progress. No quick-action grid (it
// duplicated the bottom tabs). All data is REAL — the deeper KPI dashboard lives in
// the Analytics tab (Phase 15); the old mock activity feed has been removed.
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter, type Href } from 'expo-router';
import { useAuth } from '@/lib/auth-context';
import {
  useMyName,
  useMyClients,
  useMyInvitations,
  useBodyMetricsBoard,
  useRefreshOnFocus,
} from '@/lib/queries/home';
import { Screen, Text, Avatar, GlassCard, StatBlock, EmptyState } from '@/components/ui';
import { theme } from '@/theme';

export default function CoachHome() {
  const { session } = useAuth();
  const router = useRouter();
  const userId = session?.user?.id;

  // Cached per-query reads → the hub renders its last-known stats instantly on
  // revisit instead of flashing zeros while the roster/board reload.
  const nameQ = useMyName(userId);
  const clientsQ = useMyClients();
  const invitesQ = useMyInvitations();
  const boardQ = useBodyMetricsBoard();

  useRefreshOnFocus(() => {
    nameQ.refetch();
    clientsQ.refetch();
    invitesQ.refetch();
    boardQ.refetch();
  });

  const name = nameQ.data ?? null;
  const clients = clientsQ.data?.length ?? 0;
  const pending = invitesQ.data?.filter((i) => i.status === 'pending').length ?? 0;
  const board = boardQ.data ?? [];

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
    </Screen>
  );
}
