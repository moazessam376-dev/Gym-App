// ⚠️ DUMMY DEMO DATA — remove when the real InBody body-metrics + ranking system
// lands. Ranks/deltas/body-composition require structured InBody data that does
// not exist in the schema yet (InBody is stored only as a raw photo/PDF; the
// verification + OCR system is a future phase). Until then, these placeholders
// make the dashboard look alive. Nothing here touches the database.
//
// To remove later: delete this file and the imports of `MOCK_*` in
// src/components/home/CoachHome.tsx, then wire the real readers.

export const IS_DEMO_DATA = true;

// Headline "how's my roster doing" ring on the coach home (0..1). Demo only.
export const MOCK_TEAM_MOMENTUM = 0.78;

// Per-client progress shown on the coach's client-detail screen. Demo only —
// real values come from completion logging (streak/adherence) + the future
// InBody system (lean-mass delta).
export const MOCK_CLIENT_PROGRESS = {
  streak: 5,
  workoutsThisWeek: 3,
  adherencePct: 72,
  leanMassDelta: 2.1,
};

export type TopPerformer = {
  id: string;
  name: string;
  metricLabel: string; // what earned the rank
  deltaPct: number; // weekly change
  trend: number[]; // sparkline points
};

export const MOCK_TOP_PERFORMERS: TopPerformer[] = [
  { id: 'm1', name: 'Taha Mohammed', metricLabel: 'Lean mass', deltaPct: 2.1, trend: [62, 63, 62, 64, 66, 67, 69] },
  { id: 'm2', name: 'Adam Khaled', metricLabel: 'Body fat', deltaPct: -1.4, trend: [22, 21, 21, 20, 19, 19, 18] },
  { id: 'm3', name: 'Mariam Saleh', metricLabel: 'Strength index', deltaPct: 3.6, trend: [40, 42, 43, 45, 47, 48, 51] },
];

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
