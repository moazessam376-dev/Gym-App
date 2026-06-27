// Body-composition trends from verified InBody readings (migration 0026). Read-only
// for everyone here — athletes never enter these (the coach does, foundations §4);
// this screen just visualises weight / body-fat / muscle over time. Works for the
// athlete (own) and the coach (?clientId=, RLS-granted).
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../../src/lib/auth-context';
import { listBodyMetrics, type BodyMetric } from '../../../src/lib/body-metrics';
import { Screen, Text, GlassCard, Segmented, LineChart, EmptyState } from '../../../src/components/ui';
import { theme } from '../../../src/theme';

type Field = 'weight' | 'fat' | 'muscle';

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function longDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
const kg = (g: number | null | undefined) => (g == null ? null : Math.round((g / 1000) * 10) / 10);
const pct = (bp: number | null | undefined) => (bp == null ? null : Math.round((bp / 100) * 10) / 10);

// Label comes from t(`progress.field.${field}`); only the unit + accessor live here.
const FIELD = {
  weight: { unit: ' kg', pick: (m: BodyMetric) => kg(m.weight_grams) },
  fat: { unit: '%', pick: (m: BodyMetric) => pct(m.body_fat_bp) },
  muscle: { unit: ' kg', pick: (m: BodyMetric) => kg(m.skeletal_muscle_mass_grams) },
} as const;

function Stat({ label, value, delta, lowerIsBetter }: { label: string; value: string; delta: number | null; lowerIsBetter?: boolean }) {
  // Color the delta only when we know the goal direction for that metric
  // (body fat down = good, muscle up = good); weight is neutral (goal-dependent).
  let color: string = theme.colors.textMuted;
  if (delta != null && delta !== 0 && lowerIsBetter !== undefined) {
    const good = lowerIsBetter ? delta < 0 : delta > 0;
    color = good ? theme.colors.success : theme.colors.danger;
  }
  return (
    <View style={{ flex: 1, alignItems: 'center', gap: 2 }}>
      <Text style={{ fontFamily: theme.fontFamily.monoBold, fontSize: 19, color: theme.colors.text }}>{value}</Text>
      <Text variant="label" muted style={{ fontSize: 9 }}>
        {label.toUpperCase()}
      </Text>
      {delta != null ? (
        <Text style={{ color, fontSize: 11, fontFamily: theme.fontFamily.monoMedium }}>
          {delta > 0 ? '+' : ''}
          {delta}
        </Text>
      ) : null}
    </View>
  );
}

export default function BodyComp() {
  const { t } = useTranslation();
  const { session } = useAuth();
  const selfId = session?.user?.id;
  const { clientId } = useLocalSearchParams<{ clientId?: string }>();
  const ownerId = clientId ?? selfId;

  const [metrics, setMetrics] = useState<BodyMetric[]>([]);
  const [loading, setLoading] = useState(true);
  const [field, setField] = useState<Field>('fat');

  const load = useCallback(async () => {
    if (!ownerId) return;
    try {
      setMetrics(await listBodyMetrics(ownerId));
    } catch {
      /* keep prior */
    } finally {
      setLoading(false);
    }
  }, [ownerId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const first = metrics[0];
  const latest = metrics.length ? metrics[metrics.length - 1] : undefined;

  const chartData = useMemo(() => {
    const pickFn = FIELD[field].pick;
    return metrics
      .map((m) => ({ value: pickFn(m), label: shortDate(m.measured_at) }))
      .filter((p): p is { value: number; label: string } => p.value != null);
  }, [metrics, field]);

  const delta = (pick: (m: BodyMetric) => number | null): number | null => {
    if (!first || !latest || first === latest) return null;
    const a = pick(first);
    const b = pick(latest);
    if (a == null || b == null) return null;
    return Math.round((b - a) * 10) / 10;
  };

  const history = useMemo(() => [...metrics].reverse(), [metrics]);

  return (
    <Screen gradient padded={false} edges={['bottom']}>
      <FlatList
        data={loading ? [] : history}
        keyExtractor={(m) => m.id}
        contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: 120, gap: theme.spacing.sm }}
        ListHeaderComponent={
          <View style={{ gap: theme.spacing.md, marginBottom: theme.spacing.xs }}>
            <Text variant="h2">{t('progress.bodyComposition')}</Text>

            {latest ? (
              <GlassCard glowColor={theme.colors.primary} style={{ gap: theme.spacing.md }}>
                <View style={{ flexDirection: 'row' }}>
                  <Stat label={t('progress.field.weight')} value={kg(latest.weight_grams) != null ? `${kg(latest.weight_grams)}kg` : '—'} delta={delta((m) => kg(m.weight_grams))} />
                  <Stat label={t('progress.field.fat')} value={pct(latest.body_fat_bp) != null ? `${pct(latest.body_fat_bp)}%` : '—'} delta={delta((m) => pct(m.body_fat_bp))} lowerIsBetter />
                  <Stat label={t('progress.field.muscle')} value={kg(latest.skeletal_muscle_mass_grams) != null ? `${kg(latest.skeletal_muscle_mass_grams)}kg` : '—'} delta={delta((m) => kg(m.skeletal_muscle_mass_grams))} lowerIsBetter={false} />
                </View>
                <Text variant="caption" muted style={{ textAlign: 'center' }}>
                  {t('progress.latestVerified', { date: longDate(latest.measured_at) })}
                </Text>
              </GlassCard>
            ) : null}

            {metrics.length >= 1 ? (
              <GlassCard style={{ gap: theme.spacing.md }}>
                <Segmented
                  options={[
                    { label: t('progress.field.fat'), value: 'fat' },
                    { label: t('progress.field.weight'), value: 'weight' },
                    { label: t('progress.field.muscle'), value: 'muscle' },
                  ]}
                  value={field}
                  onChange={(v) => setField(v as Field)}
                />
                {chartData.length >= 2 ? (
                  <LineChart data={chartData} unit={FIELD[field].unit} />
                ) : (
                  <Text variant="caption" muted style={{ textAlign: 'center', paddingVertical: theme.spacing.lg }}>
                    {t('progress.needTwoReadings', { field: t(`progress.field.${field}`).toLowerCase() })}
                  </Text>
                )}
              </GlassCard>
            ) : null}

            {history.length > 0 ? (
              <Text variant="label" muted style={{ marginTop: theme.spacing.xs }}>
                {t('progress.history')}
              </Text>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator style={{ marginTop: 24 }} color={theme.colors.primary} />
          ) : (
            <EmptyState
              icon="body-outline"
              title={t('progress.noInbodyTitle')}
              subtitle={t('progress.noInbodySub')}
            />
          )
        }
        renderItem={({ item }) => (
          <GlassCard>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
              <View style={{ flex: 1 }}>
                <Text variant="bodyStrong">{longDate(item.measured_at)}</Text>
                <Text variant="caption" muted>
                  {kg(item.weight_grams)}kg
                  {item.body_fat_bp != null ? t('progress.itemFat', { pct: pct(item.body_fat_bp) }) : ''}
                  {item.skeletal_muscle_mass_grams != null ? t('progress.itemMuscle', { kg: kg(item.skeletal_muscle_mass_grams) }) : ''}
                </Text>
              </View>
            </View>
          </GlassCard>
        )}
      />
    </Screen>
  );
}
