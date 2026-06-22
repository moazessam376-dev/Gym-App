// Data layer for the exercise & food libraries. Reads go through RLS, which
// returns global entries (coach_id IS NULL) plus the caller's own customs.
// Creating an entry sets coach_id = the caller, so it's always a private custom
// (the RLS INSERT policy enforces coach_id = auth.uid()). Inputs Zod-validated.
import { supabase } from './supabase';
import {
  createExerciseSchema,
  createFoodSchema,
  type CreateExercise,
  type CreateFood,
  type FoodCategory,
  type MuscleGroup,
} from '../schemas/library';

export type Exercise = {
  id: string;
  coach_id: string | null; // null = global (platform) entry
  name: string;
  muscle_group: MuscleGroup;
  primary_muscle: string | null;
};

export type Food = {
  id: string;
  coach_id: string | null;
  name: string;
  kcal_per_100g: number;
  protein_g_per_100g: number;
  carbs_g_per_100g: number;
  fat_g_per_100g: number;
  category: FoodCategory | null;
};

const EXERCISE_COLS = 'id, coach_id, name, muscle_group, primary_muscle';
const FOOD_COLS =
  'id, coach_id, name, kcal_per_100g, protein_g_per_100g, carbs_g_per_100g, fat_g_per_100g, category';

/** Exercises visible to the coach (globals + own customs), optionally filtered. */
export async function listExercises(opts?: { muscleGroup?: MuscleGroup }): Promise<Exercise[]> {
  let q = supabase.from('exercise_library').select(EXERCISE_COLS).order('name', { ascending: true });
  if (opts?.muscleGroup) q = q.eq('muscle_group', opts.muscleGroup);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as Exercise[];
}

/** Create a custom exercise owned by this coach. */
export async function createExercise(coachId: string, input: CreateExercise): Promise<Exercise> {
  const v = createExerciseSchema.parse(input);
  const { data, error } = await supabase
    .from('exercise_library')
    .insert({
      coach_id: coachId,
      name: v.name,
      muscle_group: v.muscle_group,
      primary_muscle: v.primary_muscle ?? null,
    })
    .select(EXERCISE_COLS)
    .single();
  if (error) throw error;
  return data as Exercise;
}

export async function listFoods(): Promise<Food[]> {
  const { data, error } = await supabase
    .from('food_library')
    .select(FOOD_COLS)
    .order('name', { ascending: true });
  if (error) throw error;
  return (data ?? []) as Food[];
}

export async function createFood(coachId: string, input: CreateFood): Promise<Food> {
  const v = createFoodSchema.parse(input);
  const { data, error } = await supabase
    .from('food_library')
    .insert({
      coach_id: coachId,
      name: v.name,
      kcal_per_100g: v.kcal_per_100g,
      protein_g_per_100g: v.protein_g_per_100g,
      carbs_g_per_100g: v.carbs_g_per_100g,
      fat_g_per_100g: v.fat_g_per_100g,
      category: v.category ?? null,
    })
    .select(FOOD_COLS)
    .single();
  if (error) throw error;
  return data as Food;
}
