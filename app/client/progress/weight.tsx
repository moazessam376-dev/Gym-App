// Body-weight history (migration 0002 `progress_entries`). Owner logs entries in
// their display unit (kg/lb) → stored as integer grams (foundations §3). Trend chart
// + history with delete. Read-only when a coach opens it via ?clientId= (RLS already
// grants the coach read; no log/delete controls are shown).
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Redirect, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useAuth } from '../../../src/lib/auth-context';
import { addWeightEntry, deleteWeightEntry, listProgressWeights, type WeightEntry } from '../../../src/lib/progress';
import { getAthleteProfileFor, setWeightUnit } from '../../../src/lib/athlete-profile';
import { displayToGrams, gramsToDisplay, formatWeight, type WeightUnit } from '../../../src/lib/units';
import {
  Screen,
  Text,
  Input,
  Button,
  GlassCard,
  Segmented,
  LineChart,
  IconButton,
  EmptyState,
} from '../../../src/components/ui';
import { theme } from '../../../src/theme';

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function longDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

export default function WeightProgress() {
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
  const deltaLabel = delta != null ? `${delta > 0 ? '+' : ''}${delta} ${unit} since start` : null;

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
      setError('Enter a valid weight.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await addWeightEntry(ownerId, { weight_grams: grams });
      setValue('');
      await load();
    } catch {
      setError('Could not save that entry. Please try again.');
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
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text variant="h2">Weight</Text>
                <Segmented
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
                      Latest
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
                    No weigh-ins yet.
                  </Text>
                )}
                {chartData.length >= 2 ? <LineChart data={chartData} unit={` ${unit}`} /> : null}
              </GlassCard>

              {/* Log a new entry (owner only) */}
              {!readOnly ? (
                <GlassCard style={{ gap: theme.spacing.md }}>
                  <Text variant="label" muted>
                    Log today’s weight
                  </Text>
                  <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: theme.spacing.sm }}>
                    <Input
                      containerStyle={{ flex: 1 }}
                      value={value}
                      onChangeText={setValue}
                      keyboardType="decimal-pad"
                      placeholder={`Weight in ${unit}`}
                      error={error}
                    />
                    <Button title="Save" fullWidth={false} onPress={onLog} loading={busy} />
                  </View>
                </GlassCard>
              ) : null}

              {history.length > 0 ? (
                <Text variant="label" muted style={{ marginTop: theme.spacing.xs }}>
                  History
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
                title="No weigh-ins yet"
                subtitle={readOnly ? 'This client hasn’t logged any weight yet.' : 'Log your weight above to start your trend.'}
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
