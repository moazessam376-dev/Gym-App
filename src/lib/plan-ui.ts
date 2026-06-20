// Shared visual bits for plan screens (kept out of components so coach + client
// views render statuses identically).
import type { PlanStatus, TrainingBlock } from '../schemas/plan';
import type { MealItem } from './plans';

export const PLAN_STATUS_STYLE: Record<PlanStatus, { backgroundColor: string }> = {
  draft: { backgroundColor: '#9a6700' },
  published: { backgroundColor: '#1a7f37' },
  archived: { backgroundColor: '#6e7781' },
};

// Block display order + labels (groups exercises within a day).
export const BLOCK_ORDER: TrainingBlock[] = [
  'warmup',
  'primary',
  'accessory',
  'conditioning',
  'cooldown',
];
export const BLOCK_LABEL: Record<TrainingBlock, string> = {
  warmup: 'Warm-up',
  primary: 'Primary',
  accessory: 'Accessory',
  conditioning: 'Conditioning',
  cooldown: 'Cool-down',
};

export type Macros = { kcal: number; protein: number; carbs: number; fat: number };

/** Sum a meal's items: grams × per-100g snapshot / 100, integer rounded. */
export function sumMacros(items: MealItem[]): Macros {
  return items.reduce<Macros>(
    (acc, it) => {
      const f = it.grams / 100;
      acc.kcal += Math.round(it.kcal_per_100g * f);
      acc.protein += Math.round(it.protein_g_per_100g * f);
      acc.carbs += Math.round(it.carbs_g_per_100g * f);
      acc.fat += Math.round(it.fat_g_per_100g * f);
      return acc;
    },
    { kcal: 0, protein: 0, carbs: 0, fat: 0 },
  );
}

export function addMacros(a: Macros, b: Macros): Macros {
  return {
    kcal: a.kcal + b.kcal,
    protein: a.protein + b.protein,
    carbs: a.carbs + b.carbs,
    fat: a.fat + b.fat,
  };
}

export const EMPTY_MACROS: Macros = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
