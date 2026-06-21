// Nutrition tab (client) — the daily food diary. A calorie ring + remaining
// macros vs a personalized target (seeded from the Phase 9 profile or the coach's
// assigned nutrition plan), meal-slot sections, a logging streak, and quick actions
// (add, copy a previous day). All data is real (migration 0019); nothing is faked.
import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { ZoomIn } from 'react-native-reanimated';
import { Redirect, useFocusEffect, useRouter } from 'expo-router';
import { useAuth } from '../../src/lib/auth-context';
import { getMyAthleteProfile } from '../../src/lib/athlete-profile';
import {
  copyDay,
  deleteFoodLog,
  entryMacros,
  estimateTargets,
  getAssignedNutritionPlanId,
  getDailyNutrition,
  getLatestWeightGrams,
  getNutritionStreak,
  getTargets,
  listFoodLog,
  plannedDailyMacros,
  remaining,
  shiftDate,
  todayLocalDate,
  upsertTargets,
  type DailyNutrition,
  type FoodLogEntry,
  type NutritionTargets,
} from '../../src/lib/nutrition';
import type { UpsertTargets } from '../../src/schemas/nutrition';
import { mealSlotSchema, type MealSlot } from '../../src/schemas/nutrition';
import { Screen, Text, Card, GlassCard, Button, ProgressRing, IconButton, Badge } from '../../src/components/ui';
import { theme } from '../../src/theme';

const SLOT_LABEL: Record<MealSlot, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Snacks',
};
const MACRO_COLOR = { protein: theme.colors.primary, carbs: '#22D3EE', fat: '#A78BFA' };

function MacroBar({ label, consumed, target, color }: { label: string; consumed: number; target: number; color: string }) {
  const pct = target > 0 ? Math.min(1, consumed / target) : 0;
  return (
    <View style={{ flex: 1, gap: 4 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text variant="label" muted style={{ fontSize: 10 }}>
          {label}
        </Text>
        <Text variant="label" style={{ fontSize: 10 }}>
          {consumed}/{target}g
        </Text>
      </View>
      <View style={{ height: 6, borderRadius: 3, backgroundColor: theme.colors.glass, overflow: 'hidden' }}>
        <View style={{ width: `${pct * 100}%`, height: '100%', backgroundColor: color, borderRadius: 3 }} />
      </View>
    </View>
  );
}

export default function Nutrition() {
  const { role, session } = useAuth();
  const router = useRouter();
  const userId = session?.user?.id;

  const [date, setDate] = useState(todayLocalDate());
  const [entries, setEntries] = useState<FoodLogEntry[]>([]);
  const [daily, setDaily] = useState<DailyNutrition | null>(null);
  const [targets, setTargets] = useState<NutritionTargets | null>(null);
  const [streak, setStreak] = useState(0);
  const [estimate, setEstimate] = useState<UpsertTargets | null>(null);
  const [planTargets, setPlanTargets] = useState<UpsertTargets | null>(null);
  const [hasPlan, setHasPlan] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      const [list, day, t, s] = await Promise.all([
        listFoodLog(userId, date),
        getDailyNutrition(userId, date),
        getTargets(userId),
        getNutritionStreak(userId),
      ]);
      setEntries(list);
      setDaily(day);
      setTargets(t);
      setStreak(s);

      // Only compute the suggestion sources when there's no target yet.
      if (!t) {
        const [profile, weight, planId] = await Promise.all([
          getMyAthleteProfile(userId),
          getLatestWeightGrams(userId),
          getAssignedNutritionPlanId(userId),
        ]);
        setEstimate(profile ? estimateTargets(profile, weight) : null);
        setHasPlan(planId != null);
        setPlanTargets(planId ? await plannedDailyMacros(planId) : null);
      }
    } catch {
      /* keep prior */
    } finally {
      setLoading(false);
    }
  }, [userId, date]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (role && role !== 'client') return <Redirect href="/" />;

  const isToday = date === todayLocalDate();
  const consumed = daily ?? { kcal_total: 0, protein_total: 0, carbs_total: 0, fat_total: 0 };
  const kcalTarget = targets?.kcal_target ?? 0;
  const kcalLeft = remaining(consumed.kcal_total, kcalTarget);
  const progress = kcalTarget > 0 ? Math.min(1, consumed.kcal_total / kcalTarget) : 0;

  async function applyTarget(t: UpsertTargets) {
    if (!userId) return;
    setBusy(true);
    try {
      await upsertTargets(userId, t);
      await load();
    } catch {
      /* keep prior */
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(id: string) {
    try {
      await deleteFoodLog(id);
      await load();
    } catch {
      /* keep prior */
    }
  }

  async function onCopyYesterday() {
    if (!userId) return;
    setBusy(true);
    try {
      await copyDay(userId, shiftDate(date, -1), date);
      await load();
    } catch {
      /* keep prior */
    } finally {
      setBusy(false);
    }
  }

  const goAdd = (slot: MealSlot) =>
    router.push({ pathname: '/food/add', params: { date, slot } });

  return (
    <Screen scroll gradient contentStyle={{ paddingTop: theme.spacing.lg, gap: theme.spacing.lg }}>
      {/* Header + date strip */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text variant="h1">Nutrition</Text>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
            backgroundColor: theme.colors.surface,
            borderColor: theme.colors.border,
            borderWidth: 1,
            borderRadius: theme.radii.full,
            paddingHorizontal: theme.spacing.md,
            paddingVertical: 6,
          }}
        >
          <Text variant="bodyStrong">🔥</Text>
          <Text variant="bodyStrong" color="primary">
            {streak}
          </Text>
        </View>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <IconButton name="chevron-back" onPress={() => setDate((d) => shiftDate(d, -1))} />
        <Text variant="bodyStrong">{isToday ? 'Today' : date}</Text>
        <IconButton name="chevron-forward" onPress={() => setDate((d) => (d >= todayLocalDate() ? d : shiftDate(d, 1)))} />
      </View>

      {/* Targets prompt (no target set) OR the calorie ring */}
      {!targets ? (
        <GlassCard glowColor={theme.colors.primary} style={{ gap: theme.spacing.md }}>
          <Text variant="title">Set your daily target</Text>
          <Text variant="caption" muted>
            Your calorie & macro goal powers the ring below. Pick one — you can adjust it anytime.
          </Text>
          {planTargets ? (
            <Button
              title={`Use my plan’s targets · ${planTargets.kcal_target} kcal`}
              onPress={() => applyTarget(planTargets)}
              loading={busy}
              left={<Ionicons name="clipboard" size={18} color={theme.colors.onPrimary} />}
            />
          ) : null}
          {estimate ? (
            <Button
              title={`Use estimate · ${estimate.kcal_target} kcal`}
              variant={planTargets ? 'secondary' : 'primary'}
              onPress={() => applyTarget(estimate)}
              loading={busy}
              left={<Ionicons name="calculator" size={18} color={planTargets ? theme.colors.primary : theme.colors.onPrimary} />}
            />
          ) : null}
          {!estimate && !planTargets ? (
            <Button title="Complete your profile for an estimate" variant="secondary" onPress={() => router.push('/profile-setup')} />
          ) : null}
        </GlassCard>
      ) : (
        <Card style={{ alignItems: 'center', gap: theme.spacing.lg, paddingVertical: theme.spacing.xl }}>
          <ProgressRing progress={progress} size={200} strokeWidth={16}>
            <View style={{ alignItems: 'center' }}>
              <Animated.View key={kcalLeft} entering={ZoomIn.duration(350)}>
                <Text variant="display" style={{ fontSize: 46, lineHeight: 50 }}>
                  {kcalLeft}
                </Text>
              </Animated.View>
              <Text variant="caption" muted>
                kcal left
              </Text>
              <Text variant="caption" muted>
                {consumed.kcal_total} / {kcalTarget}
              </Text>
            </View>
          </ProgressRing>

          <View style={{ flexDirection: 'row', gap: theme.spacing.md, alignSelf: 'stretch' }}>
            <MacroBar label="PROTEIN" consumed={consumed.protein_total} target={targets.protein_g_target} color={MACRO_COLOR.protein} />
            <MacroBar label="CARBS" consumed={consumed.carbs_total} target={targets.carbs_g_target} color={MACRO_COLOR.carbs} />
            <MacroBar label="FAT" consumed={consumed.fat_total} target={targets.fat_g_target} color={MACRO_COLOR.fat} />
          </View>
          {targets.source === 'coach_set' ? (
            <Text variant="caption" muted>
              Target set by your coach
            </Text>
          ) : null}
        </Card>
      )}

      {/* Meal-slot sections */}
      {mealSlotSchema.options.map((slot) => {
        const slotEntries = entries.filter((e) => e.meal_slot === slot);
        const slotKcal = slotEntries.reduce((sum, e) => sum + entryMacros(e).kcal, 0);
        return (
          <View key={slot} style={{ gap: theme.spacing.sm }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text variant="label" muted>
                {SLOT_LABEL[slot]} {slotKcal > 0 ? `· ${slotKcal} kcal` : ''}
              </Text>
              <IconButton name="add" onPress={() => goAdd(slot)} />
            </View>
            {slotEntries.length === 0 ? (
              <Card onPress={() => goAdd(slot)} style={{ paddingVertical: theme.spacing.md }}>
                <Text variant="caption" muted>
                  Add a food
                </Text>
              </Card>
            ) : (
              slotEntries.map((e) => {
                const m = entryMacros(e);
                return (
                  <Card key={e.id}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
                      <View style={{ flex: 1, gap: 2 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
                          <Text variant="bodyStrong">{e.food_name}</Text>
                          {hasPlan && !e.plan_meal_item_id ? <Badge label="extra" tone="neutral" /> : null}
                        </View>
                        <Text variant="caption" muted>
                          {e.grams}g · {m.kcal} kcal · {m.protein}P / {m.carbs}C / {m.fat}F
                        </Text>
                      </View>
                      <IconButton name="trash-outline" onPress={() => onDelete(e.id)} />
                    </View>
                  </Card>
                );
              })
            )}
          </View>
        );
      })}

      {/* Quick action: copy a previous day */}
      {!loading ? (
        <Button
          title="Copy yesterday’s log"
          variant="ghost"
          onPress={onCopyYesterday}
          loading={busy}
          left={<Ionicons name="copy-outline" size={18} color={theme.colors.primary} />}
        />
      ) : null}
    </Screen>
  );
}
