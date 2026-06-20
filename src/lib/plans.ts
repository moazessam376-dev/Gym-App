// Data layer for Phase 3 plans. Every read goes through RLS (a coach sees plans
// for their own clients; a client sees only their non-draft plans). Every write
// is validated against the shared Zod schemas first (§4); `coach_id`/`version`
// are server-controlled and never sent from a form.
import { supabase } from './supabase';
import {
  createPlanItemSchema,
  createPlanSchema,
  updatePlanItemSchema,
  updatePlanSchema,
  type CreatePlan,
  type CreatePlanItem,
  type PlanStatus,
  type PlanType,
  type UpdatePlan,
  type UpdatePlanItem,
} from '../schemas/plan';

export type Plan = {
  id: string;
  coach_id: string;
  client_id: string;
  type: PlanType;
  title: string;
  status: PlanStatus;
  version: number;
  created_at: string;
  updated_at: string;
};

export type PlanItem = {
  id: string;
  plan_id: string;
  position: number;
  name: string;
  notes: string | null;
  payload: Record<string, unknown>;
};

const PLAN_COLS = 'id, coach_id, client_id, type, title, status, version, created_at, updated_at';
const ITEM_COLS = 'id, plan_id, position, name, notes, payload';

/** Plans for one client. RLS decides visibility (coach: all; client: non-draft). */
export async function listPlansForClient(clientId: string): Promise<Plan[]> {
  const { data, error } = await supabase
    .from('plans')
    .select(PLAN_COLS)
    .eq('client_id', clientId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as Plan[];
}

export async function getPlan(planId: string): Promise<Plan | null> {
  const { data, error } = await supabase
    .from('plans')
    .select(PLAN_COLS)
    .eq('id', planId)
    .maybeSingle();
  if (error) throw error;
  return (data as Plan) ?? null;
}

export async function listPlanItems(planId: string): Promise<PlanItem[]> {
  const { data, error } = await supabase
    .from('plan_items')
    .select(ITEM_COLS)
    .eq('plan_id', planId)
    .order('position', { ascending: true });
  if (error) throw error;
  return (data ?? []) as PlanItem[];
}

/** Create a draft plan for a client. RLS enforces is_coach_of(client_id). */
export async function createPlan(coachId: string, input: CreatePlan): Promise<Plan> {
  const v = createPlanSchema.parse(input);
  const { data, error } = await supabase
    .from('plans')
    .insert({ coach_id: coachId, client_id: v.client_id, type: v.type, title: v.title })
    .select(PLAN_COLS)
    .single();
  if (error) throw error;
  return data as Plan;
}

/** Update allowlisted plan fields (title/status). */
export async function updatePlan(planId: string, input: UpdatePlan): Promise<void> {
  const v = updatePlanSchema.parse(input);
  const { error } = await supabase.from('plans').update(v).eq('id', planId);
  if (error) throw error;
}

export async function setPlanStatus(planId: string, status: PlanStatus): Promise<void> {
  return updatePlan(planId, { status });
}

export async function deletePlan(planId: string): Promise<void> {
  const { error } = await supabase.from('plans').delete().eq('id', planId);
  if (error) throw error;
}

export async function createPlanItem(input: CreatePlanItem): Promise<PlanItem> {
  const v = createPlanItemSchema.parse(input);
  const { data, error } = await supabase
    .from('plan_items')
    .insert({
      plan_id: v.plan_id,
      name: v.name,
      notes: v.notes ?? null,
      position: v.position ?? 0,
      payload: v.payload ?? {},
    })
    .select(ITEM_COLS)
    .single();
  if (error) throw error;
  return data as PlanItem;
}

export async function updatePlanItem(itemId: string, input: UpdatePlanItem): Promise<void> {
  const v = updatePlanItemSchema.parse(input);
  const { error } = await supabase.from('plan_items').update(v).eq('id', itemId);
  if (error) throw error;
}

export async function deletePlanItem(itemId: string): Promise<void> {
  const { error } = await supabase.from('plan_items').delete().eq('id', itemId);
  if (error) throw error;
}
