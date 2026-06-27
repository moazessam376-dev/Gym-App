// Body-weight history (migration 0002 `progress_entries`). Owner logs entries in
// their display unit (kg/lb) → stored as integer grams (foundations §3). Trend chart
// + history with delete. Read-only when a coach opens it via ?clientId= (RLS already
// grants the coach read; no log/delete controls are shown).
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, View } from 'react-native';
import { Redirect, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../../src/lib/auth-context';
import { upsertTodayWeight, deleteWeightEntry, listProgressWeights, type WeightEntry } from '../../../src/lib/progress';
import { getAthleteProfileFor, setWeightUnit } from '../../../src/lib/athlete-profile';
import { displayToGrams, gramsToDisplay, formatWeight, type WeightUnit } from '../../../src/lib/units';
import { Icon, Screen,
  Text,
  Input,
  Button,
  GlassCard,
  Segmented,
  LineChart,
  IconButton,
  EmptyState, } from '../../../src/components/ui';
import { theme } from '../../../src/theme';

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function longDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

export default function WeightProgress() {
  const { t } = useTranslation();
  const { role, session } = useAuth();
  const selfId = session?.user?.id;
  const { clientId } = useLocalSearchParams<{ clientId?: string }>();
  const ownerId = clientId ?? selfId;
  const readOnly = !!clientId && clientId !== selfId;

  const [entries, setEntries] = useState<WeightEntry[]>([]);
  const [unit, setUnit] = useState<WeightUnit>('kg');
  const [loading, setLoading] = useState(true);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!ownerId) return;
    try {
      const [list, profile] = await Promise.all([
        listProgressWeights(ownerId),
        getAthleteProfileFor(ownerId),
      ]);
      setEntries(list);
      if (profile?.weight_unit) setUnit(profile.weight_unit);
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

  const chartData = useMemo(
    () => entries.map((e) => ({ value: gramsToDisplay(e.weight_grams, unit) ?? 0, label: shortDate(e.recorded_at) })),
    [entries, unit],
  );

  // Newest-first for the history list; latest + overall delta for the summary.
  const history = useMemo(() => [...entries].reverse(), [entries]);
  const latest = history[0];
  const first = entries[0];
  // Neutral signed delta since the first weigh-in (no green/red — whether a change
  // is "good" depends on the athlete's goal, e.g. cut vs bulk).
  const delta =
    latest && first && latest.id !== first.id
      ? (gramsToDisplay(latest.weight_grams - first.weight_grams, unit) ?? 0)
      : null;
  const deltaLabel = delta != null ? t('progress.sinceStart', { delta: `${delta > 0 ? '+' : ''}${delta}`, unit }) : null;

  // Today's entry (local calendar day) — saving again edits it rather than adding.
  const todaysEntry = useMemo(() => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const end = start + 24 * 60 * 60 * 1000;
    return entries.find((e) => {
      const t = new Date(e.recorded_at).getTime();
      return t >= start && t < end;
    });
  }, [entries]);

  if (role && role === 'admin') return <Redirect href="/" />;

  async function changeUnit(next: WeightUnit) {
    setUnit(next);
    if (!readOnly && ownerId) {
      try {
        await setWeightUnit(ownerId, next);
      } catch {
        /* display-only; ignore persistence failure */
      }
    }
  }

  async function onLog() {
    if (!ownerId) return;
    const grams = displayToGrams(value, unit);
    if (grams == null || grams <= 0) {
      setError(t('progress.invalidWeight'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await upsertTodayWeight(ownerId, grams); // one entry per day — edits today's
      setValue('');
      await load();
    } catch {
      setError(t('progress.saveEntryError'));
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(id: string) {
    try {
      await deleteWeightEntry(id);
      setEntries((prev) => prev.filter((e) => e.id !== id));
    } catch {
      /* keep prior */
    }
  }

  return (
    <Screen gradient padded={false} edges={['bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <FlatList
          data={loading ? [] : history}
          keyExtractor={(e) => e.id}
          contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: 120, gap: theme.spacing.sm }}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            <View style={{ gap: theme.spacing.md, marginBottom: theme.spacing.xs }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.md }}>
                <Text variant="h2" style={{ flex: 1 }}>
                  {t('progress.weight')}
                </Text>
                <Segmented
                  style={{ width: 132 }}
                  options={[
                    { label: 'kg', value: 'kg' },
                    { label: 'lb', value: 'lb' },
                  ]}
                  value={unit}
                  onChange={(v) => changeUnit(v as WeightUnit)}
                />
              </View>

              {/* Summary + trend */}
              <GlassCard glowColor={theme.colors.primary} style={{ gap: theme.spacing.md }}>
                {latest ? (
                  <View style={{ gap: 2 }}>
                    <Text variant="label" muted>
                      {t('progress.latest')}
                    </Text>
                    <Text variant="display" color="primary">
                      {formatWeight(latest.weight_grams, unit)}
                    </Text>
                    {deltaLabel ? (
                      <Text variant="caption" muted>
                        {deltaLabel}
                      </Text>
                    ) : null}
                  </View>
                ) : (
                  <Text variant="body" muted>
                    {t('progress.noWeighins')}
                  </Text>
                )}
                {chartData.length >= 2 ? <LineChart data={chartData} unit={` ${unit}`} /> : null}
              </GlassCard>

              {/* Log a new entry (owner only) — one per day; re-saving edits today's */}
              {!readOnly ? (
                <GlassCard style={{ gap: theme.spacing.md }}>
                  <Text variant="label" muted>
                    {todaysEntry ? t('progress.updateToday') : t('progress.logToday')}
                  </Text>
                  <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: theme.spacing.sm }}>
                    <Input
                      containerStyle={{ flex: 1 }}
                      value={value}
                      onChangeText={setValue}
                      keyboardType="decimal-pad"
                      placeholder={todaysEntry ? formatWeight(todaysEntry.weight_grams, unit) : t('progress.weightInUnit', { unit })}
                      error={error}
                    />
                    <Button title={todaysEntry ? t('progress.update') : t('common.save')} fullWidth={false} onPress={onLog} loading={busy} />
                  </View>
                  {todaysEntry ? (
                    <Text variant="caption" muted>
                      {t('progress.loggedToday', { weight: formatWeight(todaysEntry.weight_grams, unit) })}
                    </Text>
                  ) : null}
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
                icon="trending-up-outline"
                title={t('progress.noWeighinsTitle')}
                subtitle={readOnly ? t('progress.noWeighinsCoach') : t('progress.noWeighinsOwn')}
              />
            )
          }
          renderItem={({ item }) => (
            <GlassCard>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
                <View style={{ flex: 1 }}>
                  <Text variant="bodyStrong">{formatWeight(item.weight_grams, unit)}</Text>
                  <Text variant="caption" muted>
                    {longDate(item.recorded_at)}
                  </Text>
                </View>
                {!readOnly ? (
                  <IconButton name="trash-outline" onPress={() => onDelete(item.id)} color={theme.colors.textMuted} />
                ) : null}
              </View>
            </GlassCard>
          )}
        />
      </KeyboardAvoidingView>
    </Screen>
  );
}
