// Data layer for food logging + daily macro targets (migration 0019). A CLIENT
// owns their diary (user_id forced from auth.uid() by the BEFORE-INSERT trigger);
// their coach can READ it. Targets are client-owned but coach-overridable. Derived
// roll-ups go through the tenant-safe v_daily_nutrition view / nutrition_streak RPC.
// All quantities are integers (foundations §3). Inputs are Zod-validated.
import { supabase } from './supabase';
import {
  createFoodLogSchema,
  updateFoodLogSchema,
  upsertTargetsSchema,
  type CreateFoodLog,
  type MealSlot,
  type TargetSource,
  type UpdateFoodLog,
  type UpsertTargets,
} from '../schemas/nutrition';
import { listMealItems, listMeals, type MealItem } from './plans';
import type { AthleteProfile } from './athlete-profile';

export type FoodLogEntry = {
  id: string;
  user_id: string;
  log_date: string; // 'YYYY-MM-DD'
  meal_slot: MealSlot;
  food_id: string | null;
  plan_meal_item_id: string | null; // null = off-plan extra
  food_name: string;
  kcal_per_100g: number;
  protein_g_per_100g: number;
  carbs_g_per_100g: number;
  fat_g_per_100g: number;
  grams: number;
  note: string | null;
  created_at: string;
};

export type NutritionTargets = {
  user_id: string;
  kcal_target: number;
  protein_g_target: number;
  carbs_g_target: number;
  fat_g_target: number;
  source: TargetSource;
  set_by: string | null;
};

export type DailyNutrition = {
  user_id: string;
  log_date: string;
  kcal_total: number;
  protein_total: number;
  carbs_total: number;
  fat_total: number;
  entry_count: number;
};

/** The macro totals for one food entry (grams × per-100g ÷ 100), all integers. */
export type Macros = { kcal: number; protein: number; carbs: number; fat: number };

const ENTRY_COLS =
  'id, user_id, log_date, meal_slot, food_id, plan_meal_item_id, food_name, kcal_per_100g, protein_g_per_100g, carbs_g_per_100g, fat_g_per_100g, grams, note, created_at';
const TARGET_COLS =
  'user_id, kcal_target, protein_g_target, carbs_g_target, fat_g_target, source, set_by';
const DAILY_COLS = 'user_id, log_date, kcal_total, protein_total, carbs_total, fat_total, entry_count';

/** Device-local calendar date as 'YYYY-MM-DD' (what the user perceives as "today"). */
export function todayLocalDate(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Shift a 'YYYY-MM-DD' by n days (local), returning 'YYYY-MM-DD'. */
export function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + days);
  return todayLocalDate(d);
}

// ── Per-entry / section macro math (integers) ────────────────────────────────

export function entryMacros(e: {
  grams: number;
  kcal_per_100g: number;
  protein_g_per_100g: number;
  carbs_g_per_100g: number;
  fat_g_per_100g: number;
}): Macros {
  const f = e.grams / 100;
  return {
    kcal: Math.round(e.kcal_per_100g * f),
    protein: Math.round(e.protein_g_per_100g * f),
    carbs: Math.round(e.carbs_g_per_100g * f),
    fat: Math.round(e.fat_g_per_100g * f),
  };
}

export function sumMacros(entries: FoodLogEntry[]): Macros {
  return entries.reduce<Macros>(
    (acc, e) => {
      const m = entryMacros(e);
      return {
        kcal: acc.kcal + m.kcal,
        protein: acc.protein + m.protein,
        carbs: acc.carbs + m.carbs,
        fat: acc.fat + m.fat,
      };
    },
    { kcal: 0, protein: 0, carbs: 0, fat: 0 },
  );
}

/** Remaining toward a target — clamped at 0 so the UI never shows negatives. */
export function remaining(consumed: number, target: number): number {
  return Math.max(0, target - consumed);
}

// ── Diary CRUD ───────────────────────────────────────────────────────────────

/** A client's entries for one day (RLS scopes to owner/coach), ordered by slot. */
export async function listFoodLog(userId: string, date: string): Promise<FoodLogEntry[]> {
  const { data, error } = await supabase
    .from('food_log_entries')
    .select(ENTRY_COLS)
    .eq('user_id', userId)
    .eq('log_date', date)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as FoodLogEntry[];
}

/** Add a diary entry OWNED by the signed-in client (user_id is forced from auth). */
export async function addFoodLog(userId: string, input: CreateFoodLog): Promise<FoodLogEntry> {
  const v = createFoodLogSchema.parse(input);
  const { data, error } = await supabase
    .from('food_log_entries')
    .insert({
      user_id: userId,
      log_date: v.log_date ?? todayLocalDate(),
      meal_slot: v.meal_slot,
      food_id: v.food_id ?? null,
      plan_meal_item_id: v.plan_meal_item_id ?? null,
      food_name: v.food_name,
      kcal_per_100g: v.kcal_per_100g,
      protein_g_per_100g: v.protein_g_per_100g,
      carbs_g_per_100g: v.carbs_g_per_100g,
      fat_g_per_100g: v.fat_g_per_100g,
      grams: v.grams,
      note: v.note ?? null,
      serving_label: v.serving_label ?? null,
      serving_grams: v.serving_grams ?? null,
    })
    .select(ENTRY_COLS)
    .single();
  if (error) throw error;
  return data as FoodLogEntry;
}

// ── Barcode lookup (Slice G4) ────────────────────────────────────────────────

export type BarcodeFood = {
  name: string;
  kcal_per_100g: number;
  protein_g_per_100g: number;
  carbs_g_per_100g: number;
  fat_g_per_100g: number;
  serving_label: string | null;
  serving_grams: number | null;
  barcode: string;
};

export type BarcodeResult =
  | { status: 'found'; food: BarcodeFood }
  | { status: 'not_found' }
  | { status: 'rate_limited' }
  | { status: 'failed' };

/**
 * Look up a scanned barcode via the food-barcode-lookup Edge fn (OpenFoodFacts proxy).
 * Returns a discriminated result so the UI can show "not found" vs. "try again" — never
 * throws on a miss (only a transport error maps to 'failed').
 */
export async function lookupBarcode(barcode: string): Promise<BarcodeResult> {
  const { data, error } = await supabase.functions.invoke('food-barcode-lookup', { body: { barcode } });
  if (error) return { status: 'failed' };
  const r = data as { status?: string; food?: BarcodeFood };
  if (r?.status === 'found' && r.food) return { status: 'found', food: r.food };
  if (r?.status === 'rate_limited') return { status: 'rate_limited' };
  if (r?.status === 'not_found') return { status: 'not_found' };
  return { status: 'failed' };
}

export async function updateFoodLog(entryId: string, input: UpdateFoodLog): Promise<void> {
  const v = updateFoodLogSchema.parse(input);
  const { error } = await supabase.from('food_log_entries').update(v).eq('id', entryId);
  if (error) throw error;
}

export async function deleteFoodLog(entryId: string): Promise<void> {
  const { error } = await supabase.from('food_log_entries').delete().eq('id', entryId);
  if (error) throw error;
}

// ── Quick-logging kit ────────────────────────────────────────────────────────

/** Distinct foods the user logged recently, most-recent first (for quick re-add). */
export async function recentFoods(userId: string, limit = 12): Promise<FoodLogEntry[]> {
  const { data, error } = await supabase
    .from('food_log_entries')
    .select(ENTRY_COLS)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(80);
  if (error) throw error;
  const seen = new Set<string>();
  const out: FoodLogEntry[] = [];
  for (const e of (data ?? []) as FoodLogEntry[]) {
    const key = `${e.food_id ?? 'custom'}:${e.food_name.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
    if (out.length >= limit) break;
  }
  return out;
}

/** Copy a previous day's entries onto another date (re-snapshots macros + links). */
export async function copyDay(userId: string, fromDate: string, toDate: string): Promise<number> {
  const src = await listFoodLog(userId, fromDate);
  if (src.length === 0) return 0;
  const rows = src.map((e) => ({
    user_id: userId,
    log_date: toDate,
    meal_slot: e.meal_slot,
    food_id: e.food_id,
    plan_meal_item_id: e.plan_meal_item_id,
    food_name: e.food_name,
    kcal_per_100g: e.kcal_per_100g,
    protein_g_per_100g: e.protein_g_per_100g,
    carbs_g_per_100g: e.carbs_g_per_100g,
    fat_g_per_100g: e.fat_g_per_100g,
    grams: e.grams,
    note: e.note,
  }));
  const { error } = await supabase.from('food_log_entries').insert(rows);
  if (error) throw error;
  return rows.length;
}

// ── Targets ──────────────────────────────────────────────────────────────────

export async function getTargets(userId: string): Promise<NutritionTargets | null> {
  const { data, error } = await supabase
    .from('nutrition_targets')
    .select(TARGET_COLS)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return (data as NutritionTargets) ?? null;
}

/** Upsert the current target for `userId` (self or, for a coach, their client). */
export async function upsertTargets(userId: string, input: UpsertTargets): Promise<NutritionTargets> {
  const v = upsertTargetsSchema.parse(input);
  const { data, error } = await supabase
    .from('nutrition_targets')
    .upsert({ user_id: userId, ...v }, { onConflict: 'user_id' })
    .select(TARGET_COLS)
    .single();
  if (error) throw error;
  return data as NutritionTargets;
}

// ── Derived metrics (tenant-safe via the invoker view / RPC) ──────────────────

export async function getDailyNutrition(userId: string, date: string): Promise<DailyNutrition | null> {
  const { data, error } = await supabase
    .from('v_daily_nutrition')
    .select(DAILY_COLS)
    .eq('user_id', userId)
    .eq('log_date', date)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  // count/sum columns arrive as numbers here (already cast ::integer in the view),
  // but coerce defensively in case a driver returns bigint strings.
  const r = data as Record<string, unknown>;
  return {
    user_id: String(r.user_id),
    log_date: String(r.log_date),
    kcal_total: Number(r.kcal_total),
    protein_total: Number(r.protein_total),
    carbs_total: Number(r.carbs_total),
    fat_total: Number(r.fat_total),
    entry_count: Number(r.entry_count),
  };
}

export type WeekNutrition = {
  days: DailyNutrition[]; // up to 7, ascending
  daysLogged: number;
  average: Macros;
};

/** Last 7 days ending `endDate`, with a per-day-logged average (weekly average). */
export async function getWeekNutrition(userId: string, endDate: string): Promise<WeekNutrition> {
  const start = shiftDate(endDate, -6);
  const { data, error } = await supabase
    .from('v_daily_nutrition')
    .select(DAILY_COLS)
    .eq('user_id', userId)
    .gte('log_date', start)
    .lte('log_date', endDate)
    .order('log_date', { ascending: true });
  if (error) throw error;
  const days = (data ?? []).map((d) => {
    const r = d as Record<string, unknown>;
    return {
      user_id: String(r.user_id),
      log_date: String(r.log_date),
      kcal_total: Number(r.kcal_total),
      protein_total: Number(r.protein_total),
      carbs_total: Number(r.carbs_total),
      fat_total: Number(r.fat_total),
      entry_count: Number(r.entry_count),
    } as DailyNutrition;
  });
  const n = days.length || 1;
  const avg = days.reduce<Macros>(
    (a, d) => ({
      kcal: a.kcal + d.kcal_total,
      protein: a.protein + d.protein_total,
      carbs: a.carbs + d.carbs_total,
      fat: a.fat + d.fat_total,
    }),
    { kcal: 0, protein: 0, carbs: 0, fat: 0 },
  );
  return {
    days,
    daysLogged: days.length,
    average: {
      kcal: Math.round(avg.kcal / n),
      protein: Math.round(avg.protein / n),
      carbs: Math.round(avg.carbs / n),
      fat: Math.round(avg.fat / n),
    },
  };
}

/** Consecutive-day logging streak (defaults to the caller). Tenant-safe via RLS. */
export async function getNutritionStreak(userId?: string): Promise<number> {
  const { data, error } = await supabase.rpc('nutrition_streak', userId ? { p_user: userId } : {});
  if (error) throw error;
  return Number(data ?? 0);
}

// ── Target estimation (pure; seeded from the Phase 9 profile) ─────────────────

/** Latest logged body weight in grams (the TDEE input), or null if none yet. */
export async function getLatestWeightGrams(userId: string): Promise<number | null> {
  const { data, error } = await supabase
    .from('progress_entries')
    .select('weight_grams, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? Number((data as { weight_grams: number }).weight_grams) : null;
}

const ACTIVITY_FACTOR: Record<string, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
};

// Calorie adjustment applied to TDEE for the athlete's primary goal.
const GOAL_ADJUST: Record<string, number> = {
  lose_fat: -0.2,
  build_muscle: 0.1,
  gain_strength: 0.08,
  sport_performance: 0.05,
  maintain: 0,
  improve_health: 0,
};

function ageFrom(birthDate: string): number {
  const b = new Date(`${birthDate}T00:00:00`);
  const now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age -= 1;
  return age;
}

/**
 * Mifflin–St Jeor TDEE + goal adjustment → integer kcal/macro targets. Returns
 * null if the profile is missing an input (sex/height/birth_date and a weight),
 * so the UI can prompt the athlete to finish their profile instead of guessing.
 */
export function estimateTargets(
  profile: Pick<AthleteProfile, 'sex' | 'birth_date' | 'height_cm' | 'activity_level' | 'primary_goal' | 'target_weight_grams'>,
  currentWeightGrams: number | null,
): UpsertTargets | null {
  const weightGrams = currentWeightGrams ?? profile.target_weight_grams;
  if (!profile.sex || !profile.birth_date || !profile.height_cm || !weightGrams) return null;

  const kg = weightGrams / 1000;
  const age = ageFrom(profile.birth_date);
  const bmr =
    10 * kg + 6.25 * profile.height_cm - 5 * age + (profile.sex === 'male' ? 5 : -161);

  const tdee = bmr * (ACTIVITY_FACTOR[profile.activity_level ?? 'moderate'] ?? 1.55);
  const goalAdj = GOAL_ADJUST[profile.primary_goal ?? 'maintain'] ?? 0;
  const kcal = Math.round(tdee * (1 + goalAdj));

  const proteinPerKg =
    profile.primary_goal === 'maintain' || profile.primary_goal === 'improve_health' ? 1.8 : 2.0;
  const protein = Math.round(proteinPerKg * kg);
  const fat = Math.round((0.25 * kcal) / 9);
  const carbsKcal = Math.max(0, kcal - protein * 4 - fat * 9);
  const carbs = Math.round(carbsKcal / 4);

  return {
    kcal_target: kcal,
    protein_g_target: protein,
    carbs_g_target: carbs,
    fat_g_target: fat,
    source: 'auto_estimated',
  };
}

// ── Targets from the assigned nutrition plan (prescribed side) ────────────────

/** The athlete's current published nutrition plan, if any (most recent). */
export async function getAssignedNutritionPlanId(userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('plans')
    .select('id, created_at')
    .eq('client_id', userId)
    .eq('type', 'nutrition')
    .eq('status', 'published')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? String((data as { id: string }).id) : null;
}

export type PlanMealWithItems = { id: string; name: string; items: MealItem[] };

/**
 * The athlete's assigned nutrition plan as meals + their items, so the Nutrition
 * tab can show the prescribed meals and let the athlete LOG them in one tap
 * (mirrors logging a workout). Empty array if no published plan.
 */
export async function getAssignedNutritionPlanMeals(userId: string): Promise<PlanMealWithItems[]> {
  const planId = await getAssignedNutritionPlanId(userId);
  if (!planId) return [];
  const meals = await listMeals(planId);
  return Promise.all(
    meals.map(async (m) => ({ id: m.id, name: m.name, items: await listMealItems(m.id) })),
  );
}

/** Sum the prescribed daily macros of a nutrition plan (Plan → meals → items). */
export async function plannedDailyMacros(planId: string): Promise<UpsertTargets | null> {
  const { data: meals, error: mErr } = await supabase
    .from('plan_meals')
    .select('id')
    .eq('plan_id', planId);
  if (mErr) throw mErr;
  const mealIds = (meals ?? []).map((m) => (m as { id: string }).id);
  if (mealIds.length === 0) return null;

  const { data: items, error: iErr } = await supabase
    .from('plan_meal_items')
    .select('grams, kcal_per_100g, protein_g_per_100g, carbs_g_per_100g, fat_g_per_100g')
    .in('meal_id', mealIds);
  if (iErr) throw iErr;

  const total = (items ?? []).reduce<Macros>(
    (acc, raw) => {
      const m = entryMacros(raw as FoodLogEntry);
      return {
        kcal: acc.kcal + m.kcal,
        protein: acc.protein + m.protein,
        carbs: acc.carbs + m.carbs,
        fat: acc.fat + m.fat,
      };
    },
    { kcal: 0, protein: 0, carbs: 0, fat: 0 },
  );
  if (total.kcal === 0) return null;
  return {
    kcal_target: total.kcal,
    protein_g_target: total.protein,
    carbs_g_target: total.carbs,
    fat_g_target: total.fat,
    source: 'from_plan',
  };
}
