// RosterMatrix (Engagement E5) — a dense clients×metrics grid for the Performance tab, the
// "at-a-glance roster health" view coaches want. Built entirely from already-prefetched data
// (coach_adherence_overview + coach_body_metrics_board) — no new query. Cells are color-coded
// (green/amber/red). On phones it stays horizontally scrollable with fixed-width columns; on
// wide/web (`wide`) the columns flex to fill the card so nothing truncates and the width is
// used. Module-scope → its OWN useTranslation.
import { Pressable, ScrollView, View, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import { theme } from '@/theme';
import { Text } from '@/components/ui';
import { adherenceScore, type AdherenceRow } from '@/lib/analytics';
import { goalProgress, type BoardRow } from '@/lib/body-metrics';

type ColKey = 'name' | 'adh' | 'nutr' | 'goal' | 'fat' | 'sess' | 'last';
// Fixed widths (phone, scrollable) and flex weights (wide, fill-width).
const COL: Record<ColKey, number> = { name: 124, adh: 88, nutr: 84, goal: 84, fat: 84, sess: 70, last: 86 };
const FLEX: Record<ColKey, number> = { name: 2.4, adh: 1.1, nutr: 1.1, goal: 1, fat: 1.1, sess: 0.9, last: 1.1 };

function band(pct: number | null): string {
  if (pct == null) return theme.colors.textMuted;
  if (pct >= 70) return theme.colors.success;
  if (pct >= 40) return theme.colors.warning;
  return theme.colors.danger;
}

// Body-fat change in % points (latest − baseline); down is good (green), up is bad (red).
function fatDelta(b: BoardRow | undefined): number | null {
  if (!b || b.latest_body_fat_bp == null || b.baseline_body_fat_bp == null) return null;
  return Math.round((b.latest_body_fat_bp - b.baseline_body_fat_bp)) / 100;
}
function fatColor(delta: number | null): string {
  if (delta == null || delta === 0) return theme.colors.textMuted;
  return delta < 0 ? theme.colors.success : theme.colors.danger;
}
function signed1(n: number): string {
  return `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(1)}`;
}

function daysAgo(date: string | null): number | null {
  if (!date) return null;
  return Math.floor((Date.now() - new Date(date).getTime()) / 86400000);
}

export function RosterMatrix({
  rows,
  board,
  wide = false,
  onRowPress,
}: {
  rows: AdherenceRow[];
  board: BoardRow[];
  wide?: boolean;
  onRowPress: (clientId: string) => void;
}) {
  const { t } = useTranslation();
  const byClient = new Map(board.map((b) => [b.client_id, b]));

  // Per-column cell sizing: flex on wide (fill the card), fixed px on phone (scrollable).
  const cw = (k: ColKey): ViewStyle => (wide ? { flex: FLEX[k] } : { width: COL[k] });

  const headers: [ColKey, string][] = [
    ['name', t('performance.matrixClient')],
    ['adh', t('performance.matrixAdherence')],
    ['nutr', t('performance.matrixNutrition')],
    ['goal', t('performance.matrixGoal')],
    ['fat', t('performance.matrixBodyFat')],
    ['sess', t('performance.matrixSessions')],
    ['last', t('performance.matrixLastActive')],
  ];

  const grid = (
    <View style={wide ? { width: '100%' } : undefined}>
      {/* Header */}
      <View
        style={{
          flexDirection: 'row',
          paddingVertical: theme.spacing.sm,
          borderBottomWidth: 1,
          borderBottomColor: theme.colors.glassBorder,
        }}
      >
        {headers.map(([k, label]) => (
          <Text key={k} variant="label" muted style={[cw(k), { paddingHorizontal: 4 }]} numberOfLines={1}>
            {label}
          </Text>
        ))}
      </View>

      {rows.map((r) => {
        const pct = adherenceScore(r).overallPct;
        const nutrPct = adherenceScore(r).nutritionPct;
        const b = byClient.get(r.client_id);
        const gp = b ? goalProgress(b) : null;
        const fat = fatDelta(b);
        const ago = daysAgo(r.last_session_date);
        return (
          <Pressable
            key={r.client_id}
            onPress={() => onRowPress(r.client_id)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              paddingVertical: theme.spacing.sm,
              borderBottomWidth: 1,
              borderBottomColor: theme.colors.glassBorder,
            }}
          >
            <Text variant="body" style={[cw('name'), { paddingHorizontal: 4 }]} numberOfLines={1}>
              {r.full_name ?? ''}
            </Text>
            <View style={[cw('adh'), { paddingHorizontal: 4 }]}>
              <Text variant="bodyStrong" color={band(pct)}>
                {pct == null ? '—' : `${pct}%`}
              </Text>
            </View>
            <View style={[cw('nutr'), { paddingHorizontal: 4 }]}>
              <Text variant="bodyStrong" color={band(nutrPct)}>
                {nutrPct == null ? '—' : `${nutrPct}%`}
              </Text>
            </View>
            <View style={[cw('goal'), { paddingHorizontal: 4 }]}>
              <Text variant="bodyStrong" color={gp?.hasTrend ? theme.colors.primary : theme.colors.textMuted}>
                {gp?.hasTrend ? `${gp.score >= 0 ? '+' : '−'}${Math.abs(gp.score)}` : '—'}
              </Text>
            </View>
            <View style={[cw('fat'), { paddingHorizontal: 4 }]}>
              <Text variant="bodyStrong" color={fatColor(fat)}>
                {fat == null ? '—' : signed1(fat)}
              </Text>
            </View>
            <Text variant="body" style={[cw('sess'), { paddingHorizontal: 4 }]}>
              {r.sessions_completed}
            </Text>
            <Text variant="body" muted style={[cw('last'), { paddingHorizontal: 4 }]} numberOfLines={1}>
              {ago == null ? '—' : ago === 0 ? t('performance.today') : t('performance.daysAgo', { count: ago })}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );

  // Wide: fill the card (no horizontal scroll). Phone: keep the scrollable fixed-width table.
  return wide ? grid : <ScrollView horizontal showsHorizontalScrollIndicator={false}>{grid}</ScrollView>;
}
