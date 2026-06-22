// ⚠️ DUMMY DEMO DATA — the remaining placeholders here keep the coach dashboard
// looking alive until their real sources land. Nothing here touches the database.
//
// Phase 12a REPLACED the body-composition demos with real data: the coach "Top
// performers" board (MOCK_TOP_PERFORMERS + MOCK_TEAM_MOMENTUM, removed) now reads
// the goal-relative `coach_body_metrics_board` RPC, and the client-detail lean-mass
// delta is real when verified InBody readings exist. What's LEFT here is the
// per-client streak/adherence sample (until those readers are wired) and the
// recent-activity feed (until an activity log lands).

export const IS_DEMO_DATA = true;

// Per-client progress shown on the coach's client-detail screen. The streak/
// workouts/adherence are still demo; the lean-mass delta is now REAL when verified
// InBody readings exist (Phase 12a) — `leanMassDelta` here is only the fallback.
export const MOCK_CLIENT_PROGRESS = {
  streak: 5,
  workoutsThisWeek: 3,
  adherencePct: 72,
  leanMassDelta: 2.1,
};

export type ActivityItem = {
  id: string;
  icon: 'trophy' | 'barbell' | 'person-add' | 'analytics';
  text: string;
  when: string;
};

export const MOCK_ACTIVITY: ActivityItem[] = [
  { id: 'a1', icon: 'trophy', text: 'Taha M. updated InBody → Rank up', when: '2h ago' },
  { id: 'a2', icon: 'barbell', text: 'Adam completed Week 4 · Upper A', when: '5h ago' },
  { id: 'a3', icon: 'analytics', text: 'Mariam logged a new weigh-in', when: 'Yesterday' },
  { id: 'a4', icon: 'person-add', text: 'Omar accepted your invite', when: '2d ago' },
];
