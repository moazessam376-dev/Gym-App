// Shared visual bits for plan screens (kept out of components so coach + client
// views render statuses identically).
import type { PlanStatus } from '../schemas/plan';

export const PLAN_STATUS_STYLE: Record<PlanStatus, { backgroundColor: string }> = {
  draft: { backgroundColor: '#9a6700' },
  published: { backgroundColor: '#1a7f37' },
  archived: { backgroundColor: '#6e7781' },
};
