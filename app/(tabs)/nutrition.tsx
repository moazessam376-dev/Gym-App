// Nutrition tab (client) — the daily food diary. A calorie ring + remaining
// macros vs a personalized target (seeded from the Phase 9 profile or the coach's
// assigned nutrition plan), meal-slot sections, a logging streak, and quick actions
// (add, copy a previous day). All data is real (migration 0019); nothing is faked.
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { ZoomIn } from 'react-native-reanimated';
import { Redirect, useRouter } from 'expo-router';
import { useAuth } from '../../src/lib/auth-context';
import { useNutritionDay, useRefreshOnFocus } from '../../src/lib/queries/home';
import {
  addFoodLog,
  copyDay,
  deleteFoodLog,
  entryMacros,
  remaining,
  shiftDate,
  todayLocalDate,
  upsertTargets,
  type FoodLogEntry,
} from '../../src/lib/nutrition';
import type { MealItem } from '../../src/lib/plans';
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

/** Map a plan meal's name to a diary slot (falls back to 'snack'). */
function mealNameToSlot(name: string): MealSlot {
  const n = name.toLowerCase();
  if (n.includes('breakfast')) return 'breakfast';
  if (n.includes('lunch')) return 'lunch';
  if (n.includes('dinner')) return 'dinner';
  return 'snack';
}
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
  const [busy, setBusy] = useState(false);

  // One cached composite per day (entries + roll-up + targets + streak + plan meals
  // + suggestion sources). Warmed on app open for "today" so the tab is instant on
  // first visit; switching days fetches+caches that day. Mutations refetch this.
  const dayQ = useNutritionDay(userId, date);
  useRefreshOnFocus(dayQ.refetch);
  const load = () => dayQ.refetch();

  const entries = dayQ.data?.entries ?? [];
  const daily = dayQ.data?.daily ?? null;
  const targets = dayQ.data?.targets ?? null;
  const streak = dayQ.data?.streak ?? 0;
  const planMeals = dayQ.data?.planMeals ?? [];
  const estimate = dayQ.data?.estimate ?? null;
  const planTargets = dayQ.data?.planTargets ?? null;
  const loading = dayQ.isPending;

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

  // The logged entry linked to each plan item (so we can tick / untick).
  const entryByPlanItem = new Map<string, FoodLogEntry>();
  for (const e of entries) if (e.plan_meal_item_id) entryByPlanItem.set(e.plan_meal_item_id, e);

  /** Plan items assigned to a diary slot (a plan meal maps to a slot by name). */
  function planItemsForSlot(slot: MealSlot): MealItem[] {
    return planMeals.filter((m) => mealNameToSlot(m.name) === slot).flatMap((m) => m.items);
  }

  async function logOne(item: MealItem, slot: MealSlot) {
    if (!userId) return;
    await addFoodLog(userId, {
      log_date: date,
      meal_slot: slot,
      food_id: item.food_id,
      plan_meal_item_id: item.id,
      food_name: item.food_name,
      kcal_per_100g: item.kcal_per_100g,
      protein_g_per_100g: item.protein_g_per_100g,
      carbs_g_per_100g: item.carbs_g_per_100g,
      fat_g_per_100g: item.fat_g_per_100g,
      grams: item.grams,
    });
  }

  // Tick → log the planned item; untick → remove the logged entry.
  async function togglePlannedItem(item: MealItem, slot: MealSlot) {
    if (!userId || busy) return;
    setBusy(true);
    try {
      const existing = entryByPlanItem.get(item.id);
      if (existing) await deleteFoodLog(existing.id);
      else await logOne(item, slot);
      await load();
    } catch {
      /* keep prior */
    } finally {
      setBusy(false);
    }
  }

  // Log every not-yet-logged planned item in a slot.
  async function logSlotPlan(slot: MealSlot) {
    if (!userId) return;
    const pending = planItemsForSlot(slot).filter((it) => !entryByPlanItem.has(it.id));
    if (pending.length === 0) return;
    setBusy(true);
    try {
      for (const it of pending) await logOne(it, slot);
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

      {/* Unified meal sections: planned items (tick / untick to log) + any off-plan
          extras + the slot's total kcal, all in one place. */}
      {mealSlotSchema.options.map((slot) => {
        const planItems = planItemsForSlot(slot);
        const planItemIds = new Set(planItems.map((i) => i.id));
        const slotEntries = entries.filter((e) => e.meal_slot === slot);
        const extras = slotEntries.filter((e) => !e.plan_meal_item_id || !planItemIds.has(e.plan_meal_item_id));
        const slotKcal = slotEntries.reduce((sum, e) => sum + entryMacros(e).kcal, 0);
        const pendingPlan = planItems.filter((i) => !entryByPlanItem.has(i.id)).length;
        const isEmpty = planItems.length === 0 && slotEntries.length === 0;
        return (
          <View key={slot} style={{ gap: theme.spacing.sm }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text variant="label" muted>
                {SLOT_LABEL[slot]} {slotKcal > 0 ? `· ${slotKcal} kcal` : ''}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
                {pendingPlan > 0 ? (
                  <Pressable onPress={() => logSlotPlan(slot)} disabled={busy} hitSlop={6}>
                    <Text variant="caption" color="link">
                      Log all
                    </Text>
                  </Pressable>
                ) : null}
                <IconButton name="add" onPress={() => goAdd(slot)} />
              </View>
            </View>

            {/* Planned items — tap the box to log, tap again to undo */}
            {planItems.map((it) => {
              const logged = entryByPlanItem.has(it.id);
              const m = entryMacros(it);
              return (
                <Card key={it.id}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
                    <Pressable
                      onPress={() => togglePlannedItem(it, slot)}
                      disabled={busy}
                      hitSlop={6}
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: theme.radii.sm,
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: logged ? theme.colors.primary : 'transparent',
                        borderWidth: 1,
                        borderColor: logged ? theme.colors.primary : theme.colors.border,
                      }}
                    >
                      {logged ? <Ionicons name="checkmark" size={18} color={theme.colors.onPrimary} /> : null}
                    </Pressable>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text variant="bodyStrong">{it.food_name}</Text>
                      <Text variant="caption" muted>
                        {it.grams}g · {m.kcal} kcal · {m.protein}P / {m.carbs}C / {m.fat}F
                      </Text>
                    </View>
                  </View>
                </Card>
              );
            })}

            {/* Off-plan extras logged in this slot */}
            {extras.map((e) => {
              const m = entryMacros(e);
              return (
                <Card key={e.id}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
                    <View style={{ flex: 1, gap: 2 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
                        <Text variant="bodyStrong">{e.food_name}</Text>
                        {planItems.length > 0 ? <Badge label="extra" tone="neutral" /> : null}
                      </View>
                      <Text variant="caption" muted>
                        {e.grams}g · {m.kcal} kcal · {m.protein}P / {m.carbs}C / {m.fat}F
                      </Text>
                    </View>
                    <IconButton name="trash-outline" onPress={() => onDelete(e.id)} />
                  </View>
                </Card>
              );
            })}

            {isEmpty ? (
              <Card onPress={() => goAdd(slot)} style={{ paddingVertical: theme.spacing.md }}>
                <Text variant="caption" muted>
                  Add a food
                </Text>
              </Card>
            ) : null}
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
