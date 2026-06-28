// RosterMatrix (Engagement E5) — a dense clients×metrics grid for the Performance tab, the
// "at-a-glance roster health" view coaches want. Built entirely from already-prefetched data
// (coach_adherence_overview + coach_body_metrics_board) — no new query. Horizontally scrollable
// on phones; cells are color-coded (green/amber/red). Module-scope → its OWN useTranslation.
import { Pressable, ScrollView, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { theme } from '@/theme';
import { Text } from '@/components/ui';
import { adherenceScore, type AdherenceRow } from '@/lib/analytics';
import { goalProgress, type BoardRow } from '@/lib/body-metrics';

const COL = { name: 120, adh: 92, goal: 96, sess: 74, last: 88 };

function band(pct: number | null): string {
  if (pct == null) return theme.colors.textMuted;
  if (pct >= 70) return theme.colors.success;
  if (pct >= 40) return theme.colors.warning;
  return theme.colors.danger;
}

function daysAgo(date: string | null): number | null {
  if (!date) return null;
  return Math.floor((Date.now() - new Date(date).getTime()) / 86400000);
}

function HeaderCell({ label, width }: { label: string; width: number }) {
  return (
    <Text variant="label" muted style={{ width, paddingHorizontal: 4 }} numberOfLines={1}>
      {label}
    </Text>
  );
}

export function RosterMatrix({
  rows,
  board,
  onRowPress,
}: {
  rows: AdherenceRow[];
  board: BoardRow[];
  onRowPress: (clientId: string) => void;
}) {
  const { t } = useTranslation();
  const byClient = new Map(board.map((b) => [b.client_id, b]));

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View>
        {/* Header */}
        <View style={{ flexDirection: 'row', paddingVertical: theme.spacing.sm, borderBottomWidth: 1, borderBottomColor: theme.colors.glassBorder }}>
          <HeaderCell label={t('performance.matrixClient')} width={COL.name} />
          <HeaderCell label={t('performance.matrixAdherence')} width={COL.adh} />
          <HeaderCell label={t('performance.matrixGoal')} width={COL.goal} />
          <HeaderCell label={t('performance.matrixSessions')} width={COL.sess} />
          <HeaderCell label={t('performance.matrixLastActive')} width={COL.last} />
        </View>

        {rows.map((r) => {
          const pct = adherenceScore(r).overallPct;
          const b = byClient.get(r.client_id);
          const gp = b ? goalProgress(b) : null;
          const ago = daysAgo(r.last_session_date);
          return (
            <Pressable
              key={r.client_id}
              onPress={() => onRowPress(r.client_id)}
              style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: theme.spacing.sm, borderBottomWidth: 1, borderBottomColor: theme.colors.glassBorder }}
            >
              <Text variant="body" style={{ width: COL.name, paddingHorizontal: 4 }} numberOfLines={1}>
                {r.full_name ?? ''}
              </Text>
              <View style={{ width: COL.adh, paddingHorizontal: 4 }}>
                <Text variant="bodyStrong" color={band(pct)}>
                  {pct == null ? '—' : `${pct}%`}
                </Text>
              </View>
              <View style={{ width: COL.goal, paddingHorizontal: 4 }}>
                <Text variant="bodyStrong" color={gp?.hasTrend ? theme.colors.primary : theme.colors.textMuted}>
                  {gp?.hasTrend ? `${gp.score >= 0 ? '+' : '−'}${Math.abs(gp.score)}` : '—'}
                </Text>
              </View>
              <Text variant="body" style={{ width: COL.sess, paddingHorizontal: 4 }}>
                {r.sessions_completed}
              </Text>
              <Text variant="body" muted style={{ width: COL.last, paddingHorizontal: 4 }} numberOfLines={1}>
                {ago == null ? '—' : ago === 0 ? t('performance.today') : t('performance.daysAgo', { count: ago })}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </ScrollView>
  );
}
