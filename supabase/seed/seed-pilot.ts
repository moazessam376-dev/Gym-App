// seed-pilot.ts — populate a Supabase project with a realistic pilot dataset so the coach
// Performance / Leaderboard / Discover surfaces (which are empty only because the DB is
// empty) can actually be evaluated. Creates 1 admin + 20 coaches + 220 athletes with
// plans, completed sessions (progressive overload → PRs), coach-verified body metrics,
// food logs, messages and a per-coach analytics insight.
//
// RUN (host-side; never bundled to the app):
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run seed:pilot            # seed
//   ... npm run seed:pilot -- --dry-run                                          # plan only
//   ... npm run seed:pilot -- --reset                                            # wipe pilot users first, then seed
//
// PREREQUISITE #1 (the #1 "seeded but surfaces still empty" failure): the access-token hook
// must be registered in the dashboard → Authentication → Hooks → "Customize Access Token
// (JWT) Claims" → public.custom_access_token_hook. Without it every coach/admin RPC returns
// 0 rows.
//
// SECURITY: SUPABASE_SERVICE_ROLE_KEY is read from the runtime env ONLY — never committed,
// never EXPO_PUBLIC_ (§3). The generated credentials file is gitignored. This is an
// outward-facing write to the chosen project — run only with the founder's go-ahead.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import 'dotenv/config';

// ── Config ───────────────────────────────────────────────────────────────────
const N_COACHES = 20;
const N_ATHLETES = 220;
const SHARED_PASSWORD = 'Pilot-Raptor-2025!';
const EMAIL_DOMAIN = 'pilot.test'; // RFC 6761 reserved — no real mail bounces
const SETLOG_CHUNK = 5000; // PostgREST default batch limit is 1000; we send 5k via one POST body
const ROW_CHUNK = 1000;

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const DRY_RUN = process.argv.includes('--dry-run');
const RESET = process.argv.includes('--reset');

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error(
    'Missing env. Set SUPABASE_URL (or EXPO_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY.\n' +
      'The service-role key is server-only — pass it at runtime, never commit it.',
  );
  process.exit(1);
}

// ── Deterministic PRNG (reproducible distributions across runs) ───────────────
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(0x9e3779b1);
const randInt = (lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));
const pick = <T,>(arr: T[]): T => arr[Math.floor(rng() * arr.length)];
const uuid = () => randomUUID();
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
/** ISO timestamp `n` days before now. */
const daysAgoISO = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
/** YYYY-MM-DD `n` days before today (UTC). */
const dateAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

// ── Name + content pools ──────────────────────────────────────────────────────
const FIRST = ['Ahmed', 'Mohamed', 'Mahmoud', 'Omar', 'Youssef', 'Khaled', 'Karim', 'Hassan', 'Tarek', 'Amr', 'Mostafa', 'Ali', 'Sara', 'Nour', 'Mariam', 'Hana', 'Laila', 'Salma', 'Dina', 'Yara', 'Farida', 'Habiba', 'Aya', 'Reem'];
const LAST = ['Hassan', 'Ibrahim', 'Mahmoud', 'Said', 'Fahmy', 'Sobhy', 'Zaki', 'Naguib', 'Saleh', 'Abdel Aziz', 'El Sayed', 'Mansour', 'Kamal', 'Refaat', 'Gad', 'Shawky', 'Helmy', 'Adel', 'Fouad', 'Nabil'];
const SPECIALTIES = ['hypertrophy', 'powerlifting', 'fat_loss', 'strength', 'bodybuilding', 'general_fitness', 'sports_performance', 'nutrition'];
const GOALS = ['lose_fat', 'build_muscle', 'gain_strength', 'maintain', 'improve_health', 'sport_performance'] as const;
const GOAL_WEIGHTS: [(typeof GOALS)[number], number][] = [['lose_fat', 30], ['build_muscle', 30], ['gain_strength', 15], ['maintain', 10], ['improve_health', 10], ['sport_performance', 5]];
const EXPERIENCE = ['beginner', 'intermediate', 'advanced'] as const;
const ACTIVITY = ['sedentary', 'light', 'moderate', 'active', 'very_active'] as const;
const DAY_NAMES = ['Day 1 — Push', 'Day 2 — Pull', 'Day 3 — Legs'];

function fullName(i: number): string {
  return `${FIRST[i % FIRST.length]} ${LAST[(i * 7) % LAST.length]}`;
}
function weightedGoal(): (typeof GOALS)[number] {
  const total = GOAL_WEIGHTS.reduce((a, [, w]) => a + w, 0);
  let r = rng() * total;
  for (const [g, w] of GOAL_WEIGHTS) {
    if ((r -= w) <= 0) return g;
  }
  return 'maintain';
}

// ── Athlete cohort buckets (so "Needs attention" + leaderboards populate) ─────
// 0..9  → zero sessions (needs attention: no_sessions)
// 10..24 → inactive (last session 6–14d ago)
// 25..49 → low adherence (~1 session/week)
// 50.. → active (3/week, recent)
const isZeroSessions = (i: number) => i < 10;
const isInactive = (i: number) => i >= 10 && i < 25;
const isLowAdherence = (i: number) => i >= 25 && i < 50;
// Public + leaderboard opt-in (→ Top Athletes board); these always get verified metrics.
const isPublic = (i: number) => i < 88; // ~40%
// Verified body-metric readings (→ board + coach "improved" + Performance metrics tiles).
const hasMetrics = (i: number) => isPublic(i) || i % 5 !== 0; // ~80%, incl. all public ones

const svc: SupabaseClient = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function insertBatched(table: string, rows: Record<string, unknown>[], size = ROW_CHUNK) {
  for (const part of chunk(rows, size)) {
    const { error } = await svc.from(table).insert(part);
    if (error) throw new Error(`${table} insert failed: ${error.message}`);
  }
}

type UserSpec = { email: string; name: string; role: 'admin' | 'coach' | 'client' };

async function listAllAuthUsers(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  let page = 1;
  for (;;) {
    const { data, error } = await svc.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`listUsers failed: ${error.message}`);
    for (const u of data.users) if (u.email) map.set(u.email.toLowerCase(), u.id);
    if (data.users.length < 1000) break;
    page += 1;
  }
  return map;
}

async function main() {
  console.log(`Seeding ${SUPABASE_URL}  (dry-run: ${DRY_RUN}, reset: ${RESET})`);

  // Reference the GLOBAL catalogs seeded by migrations (do not reinsert).
  const { data: ex, error: exErr } = await svc
    .from('exercise_library')
    .select('id, name')
    .is('coach_id', null)
    .limit(60);
  const { data: fd, error: fdErr } = await svc
    .from('food_library')
    .select('id, name, kcal_per_100g, protein_g_per_100g, carbs_g_per_100g, fat_g_per_100g')
    .is('coach_id', null)
    .limit(40);
  if (exErr || fdErr) throw new Error(`catalog read failed: ${exErr?.message ?? fdErr?.message}`);
  const exercises = ex ?? [];
  const foods = fd ?? [];
  if (exercises.length < 6 || foods.length < 4) {
    throw new Error('Global catalogs look empty — apply migrations 0010/0047 first.');
  }

  // Build the user specs.
  const specs: UserSpec[] = [{ email: `admin@${EMAIL_DOMAIN}`, name: 'Pilot Admin', role: 'admin' }];
  for (let c = 1; c <= N_COACHES; c++) {
    specs.push({ email: `coach.${String(c).padStart(2, '0')}@${EMAIL_DOMAIN}`, name: `Coach ${fullName(c)}`, role: 'coach' });
  }
  for (let a = 1; a <= N_ATHLETES; a++) {
    specs.push({ email: `athlete.${String(a).padStart(3, '0')}@${EMAIL_DOMAIN}`, name: fullName(a + 50), role: 'client' });
  }

  if (DRY_RUN) {
    console.log(`Would create ${specs.length} users: 1 admin + ${N_COACHES} coaches + ${N_ATHLETES} athletes`);
    console.log(`Catalogs: ${exercises.length} exercises, ${foods.length} foods available to reference.`);
    console.log('Distribution: ~10 zero-session, ~15 inactive, ~25 low-adherence; ~88 public+opted-in; ~80% with verified metrics.');
    console.log('No writes performed (--dry-run).');
    return;
  }

  // Optional reset: delete existing pilot users (cascades all their data).
  if (RESET) {
    const existing = await listAllAuthUsers();
    let deleted = 0;
    for (const [email, id] of existing) {
      if (email.endsWith(`@${EMAIL_DOMAIN}`)) {
        const { error } = await svc.auth.admin.deleteUser(id);
        if (error) console.warn(`reset: deleteUser ${email} failed: ${error.message}`);
        else deleted++;
      }
    }
    console.log(`Reset: deleted ${deleted} existing @${EMAIL_DOMAIN} users.`);
  }

  // Create (or reuse) auth users → email→id map. createUser fires on_auth_user_created,
  // which makes a 'client' profile with full_name from metadata.
  const existing = await listAllAuthUsers();
  const idByEmail = new Map<string, string>();
  for (const s of specs) {
    const known = existing.get(s.email.toLowerCase());
    if (known) {
      idByEmail.set(s.email, known);
      continue;
    }
    const { data, error } = await svc.auth.admin.createUser({
      email: s.email,
      password: SHARED_PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: s.name },
    });
    if (error || !data.user) throw new Error(`createUser ${s.email} failed: ${error?.message}`);
    idByEmail.set(s.email, data.user.id);
  }
  console.log(`Users ready: ${idByEmail.size}`);

  const adminId = idByEmail.get(`admin@${EMAIL_DOMAIN}`)!;
  const coachIds = Array.from({ length: N_COACHES }, (_, k) => idByEmail.get(`coach.${String(k + 1).padStart(2, '0')}@${EMAIL_DOMAIN}`)!);
  const athleteIds = Array.from({ length: N_ATHLETES }, (_, k) => idByEmail.get(`athlete.${String(k + 1).padStart(3, '0')}@${EMAIL_DOMAIN}`)!);

  // Roles + coach assignment (service role satisfies enforce_profile_immutables).
  const { error: adminErr } = await svc.from('profiles').update({ role: 'admin' }).eq('id', adminId);
  if (adminErr) throw new Error(`admin role update failed: ${adminErr.message}`);
  for (const id of coachIds) {
    const { error } = await svc.from('profiles').update({ role: 'coach' }).eq('id', id);
    if (error) throw new Error(`coach role update failed: ${error.message}`);
  }
  // Round-robin clients onto coaches (each coach ≥ 11 → board needs ≥3 tracked).
  const coachOf = (ai: number) => coachIds[ai % N_COACHES];
  for (let ai = 0; ai < N_ATHLETES; ai++) {
    const { error } = await svc.from('profiles').update({ coach_id: coachOf(ai) }).eq('id', athleteIds[ai]);
    if (error) throw new Error(`coach_id update failed: ${error.message}`);
  }
  console.log('Roles + coach assignment done.');

  // coach_profile (all public + opted-in → Discover + Top Coaches populate).
  await insertBatched(
    'coach_profile',
    coachIds.map((id, k) => ({
      user_id: id,
      bio: `Egypt-based coach. ${randInt(2, 15)}+ years turning clients' goals into measurable results.`,
      specialties: [pick(SPECIALTIES), pick(SPECIALTIES)].filter((v, i, a) => a.indexOf(v) === i),
      years_experience: randInt(3, 15),
      certifications: 'NASM-CPT',
      is_public: true,
      leaderboard_opt_in: true,
      achievements: ['Verified coach'],
      onboarded_at: daysAgoISO(randInt(40, 200)),
    })),
    200,
  );

  // athlete_profile.
  const athleteGoal: string[] = [];
  await insertBatched(
    'athlete_profile',
    athleteIds.map((id, i) => {
      const goal = weightedGoal();
      athleteGoal[i] = goal;
      const male = i % 100 < 65; // ~65% male
      return {
        user_id: id,
        primary_goal: goal,
        experience_level: pick([...EXPERIENCE]),
        sex: male ? 'male' : 'female',
        birth_date: dateAgo(randInt(20 * 365, 45 * 365)),
        height_cm: male ? randInt(168, 190) : randInt(155, 175),
        target_weight_grams: (male ? randInt(72, 92) : randInt(55, 72)) * 1000,
        activity_level: pick([...ACTIVITY]),
        training_days: randInt(3, 5),
        dietary_tags: [],
        is_public: isPublic(i),
        leaderboard_opt_in: isPublic(i),
        public_achievements: isPublic(i) ? ['Pilot athlete'] : [],
        onboarded_at: daysAgoISO(randInt(30, 120)),
      };
    }),
    200,
  );
  console.log('Profiles (coach + athlete) done.');

  // Plans → weeks → days → exercises; then sessions → set logs.
  const plans: Record<string, unknown>[] = [];
  const weeks: Record<string, unknown>[] = [];
  const days: Record<string, unknown>[] = [];
  const planExercises: Record<string, unknown>[] = [];
  const sessions: Record<string, unknown>[] = [];
  const setLogs: Record<string, unknown>[] = [];
  const activePlanByAthlete: { id: string; planId: string }[] = [];

  for (let i = 0; i < N_ATHLETES; i++) {
    const athlete = athleteIds[i];
    const coach = coachOf(i);
    const planId = uuid();
    plans.push({
      id: planId,
      coach_id: coach,
      client_id: athlete,
      type: 'training',
      title: `${(athleteGoal[i] ?? 'training').replace(/_/g, ' ')} block`,
      status: 'published',
      ai_generated: i % 5 < 2, // ~40% AI-generated (AI-vs-handbuilt split)
    });
    activePlanByAthlete.push({ id: athlete, planId });

    const weekId = uuid();
    weeks.push({ id: weekId, plan_id: planId, position: 0, name: 'Week 1' });

    // 3 days × 4 exercises.
    const dayIds: string[] = [];
    for (let d = 0; d < 3; d++) {
      const dayId = uuid();
      dayIds.push(dayId);
      days.push({ id: dayId, plan_id: planId, week_id: weekId, position: d + 1, name: DAY_NAMES[d] });
      const dayExercises = Array.from({ length: 4 }, () => pick(exercises));
      dayExercises.forEach((e, p) => {
        planExercises.push({
          day_id: dayId,
          exercise_id: e.id,
          exercise_name: e.name,
          block: p === 0 ? 'primary' : 'accessory',
          position: p + 1,
          sets: 3,
          reps: p === 0 ? '5' : '8-12',
        });
      });
    }

    // How many sessions + how recent, by cohort.
    let nSessions = 0;
    let mostRecentDay = 0; // days-ago of the latest session
    if (isZeroSessions(i)) {
      nSessions = 0;
    } else if (isInactive(i)) {
      nSessions = randInt(4, 8);
      mostRecentDay = randInt(6, 14);
    } else if (isLowAdherence(i)) {
      nSessions = randInt(4, 7); // ~1/week over ~6 weeks
      mostRecentDay = randInt(0, 3);
    } else {
      nSessions = randInt(15, 24); // ~3/week over 5–8 weeks
      mostRecentDay = randInt(0, 2);
    }

    // Walk back from mostRecentDay, ~every 2–3 days, cycling days; progressive overload.
    let dayOffset = mostRecentDay;
    for (let s = 0; s < nSessions; s++) {
      const sessionId = uuid();
      const dayIdx = s % 3;
      sessions.push({
        id: sessionId,
        user_id: athlete,
        plan_id: planId,
        day_id: dayIds[dayIdx],
        session_date: dateAgo(dayOffset),
        status: 'completed',
        completed_at: daysAgoISO(dayOffset),
      });
      // 4 exercises × 3 sets; load ramps as sessions get more recent (s grows → heavier).
      let setIndex = 0;
      for (let e = 0; e < 4; e++) {
        const baseKg = 20 + e * 10 + Math.floor(s / 2) * 2.5; // progressive overload
        for (let set = 0; set < 3; set++) {
          setLogs.push({
            id: uuid(),
            session_id: sessionId,
            plan_exercise_id: null,
            exercise_name: pick(exercises).name,
            set_index: setIndex++,
            reps_done: randInt(5, 12),
            load_grams: Math.round(baseKg * 1000),
            is_completed: true,
          });
        }
      }
      dayOffset += randInt(2, 3);
    }
  }

  await insertBatched('plans', plans, 200);
  await insertBatched('plan_weeks', weeks, 200);
  await insertBatched('plan_days', days, 500);
  await insertBatched('plan_exercises', planExercises, 1000);
  console.log(`Plans done: ${plans.length} plans, ${days.length} days, ${planExercises.length} exercises.`);
  await insertBatched('workout_sessions', sessions, 1000);
  console.log(`Sessions done: ${sessions.length}.`);
  await insertBatched('exercise_set_logs', setLogs, SETLOG_CHUNK);
  console.log(`Set logs done: ${setLogs.length}.`);

  // Set each athlete's active plan (best-effort).
  for (const a of activePlanByAthlete) {
    await svc.from('athlete_profile').update({ active_training_plan_id: a.planId }).eq('user_id', a.id);
  }

  // Body metrics — coach-entered (→ verified), baseline + improving latest (recent).
  const metrics: Record<string, unknown>[] = [];
  for (let i = 0; i < N_ATHLETES; i++) {
    if (!hasMetrics(i)) continue;
    const athlete = athleteIds[i];
    const male = i % 100 < 65;
    const n = randInt(2, 5);
    // Trend: ~50% improving, 25% flat, 25% regressing (only improving ones lift the coach board).
    const trend = i % 4 === 0 ? 'flat' : i % 4 === 1 ? 'regress' : 'improve';
    let weight = (male ? randInt(78, 100) : randInt(60, 85)) * 1000;
    let bf = randInt(1800, 3200); // basis points (18–32%)
    let smm = (male ? randInt(33, 42) : randInt(22, 30)) * 1000;
    for (let r = 0; r < n; r++) {
      // r=0 is the oldest (baseline); spread readings ~30 days apart, latest within ~14d.
      const measuredDaysAgo = (n - 1 - r) * 28 + randInt(2, 14);
      metrics.push({
        id: uuid(),
        user_id: athlete,
        measured_at: daysAgoISO(measuredDaysAgo),
        weight_grams: weight,
        body_fat_bp: bf,
        skeletal_muscle_mass_grams: smm,
        source: 'coach_entered', // → trigger stamps verified_at (counts for boards)
      });
      // Step toward the next (more recent) reading.
      if (trend === 'improve') {
        bf -= randInt(40, 120);
        smm += randInt(150, 400);
        weight -= randInt(200, 700);
      } else if (trend === 'regress') {
        bf += randInt(20, 90);
        smm -= randInt(50, 200);
      }
    }
  }
  await insertBatched('body_metrics', metrics, 1000);
  console.log(`Body metrics done: ${metrics.length}.`);

  // Nutrition targets + a few food-log days for ~50 athletes (drives nutrition adherence).
  const targets: Record<string, unknown>[] = [];
  const foodLogs: Record<string, unknown>[] = [];
  for (let i = 0; i < N_ATHLETES; i++) {
    if (isZeroSessions(i)) continue;
    const athlete = athleteIds[i];
    targets.push({
      user_id: athlete,
      kcal_target: randInt(1900, 2800),
      protein_g_target: randInt(140, 200),
      carbs_g_target: randInt(180, 320),
      fat_g_target: randInt(50, 90),
      source: 'coach_set',
      set_by: coachOf(i),
    });
    if (i < 60) {
      const days_ = randInt(3, 5);
      for (let d = 0; d < days_; d++) {
        for (const slot of ['breakfast', 'lunch', 'dinner'] as const) {
          const f = pick(foods);
          foodLogs.push({
            id: uuid(),
            user_id: athlete,
            log_date: dateAgo(d),
            meal_slot: slot,
            food_id: f.id,
            plan_meal_item_id: null,
            food_name: f.name,
            kcal_per_100g: f.kcal_per_100g,
            protein_g_per_100g: f.protein_g_per_100g,
            carbs_g_per_100g: f.carbs_g_per_100g,
            fat_g_per_100g: f.fat_g_per_100g,
            grams: randInt(80, 300),
          });
        }
      }
    }
  }
  await insertBatched('nutrition_targets', targets, 1000);
  await insertBatched('food_log_entries', foodLogs, 1000);
  console.log(`Nutrition done: ${targets.length} targets, ${foodLogs.length} food logs.`);

  // Messages + read state for ~first 4 athletes of each coach (service role bypasses the
  // send trigger + disclaimer gate). A short coach↔client exchange each.
  const messages: Record<string, unknown>[] = [];
  const readState: Record<string, unknown>[] = [];
  for (let i = 0; i < N_ATHLETES; i++) {
    if (i % N_COACHES >= 4) continue; // first 4 per coach
    const athlete = athleteIds[i];
    const coach = coachOf(i);
    const exchange = [
      { from: coach, to: athlete, body: 'Welcome aboard! Logged your first sessions — nice work.' },
      { from: athlete, to: coach, body: 'Thanks coach! Felt strong this week.' },
      { from: coach, to: athlete, body: 'Keep the protein up and we will hit your target.' },
    ];
    exchange.forEach((m, k) => {
      messages.push({ id: uuid(), sender_id: m.from, recipient_id: m.to, body: m.body, created_at: daysAgoISO(3 - k) });
    });
    readState.push({ user_id: coach, peer_id: athlete, last_read_at: daysAgoISO(1) });
  }
  await insertBatched('messages', messages, 1000);
  await insertBatched('conversation_read_state', readState, 1000);
  console.log(`Chat done: ${messages.length} messages.`);

  // One pre-written analytics insight per coach (don't burn AI quota generating them).
  await insertBatched(
    'coach_analytics_insights',
    coachIds.map((id) => ({
      coach_id: id,
      analysis:
        'Roster adherence is solid this month. Most fat-loss clients are trending down on body fat; a few clients have gone quiet — reach out to re-engage them.',
      provider: 'seed',
      model: 'seed',
    })),
    200,
  );
  console.log('Analytics insights done.');

  // ── Credentials file (gitignored) + stdout ─────────────────────────────────
  const lines: string[] = [];
  lines.push('# Pilot Seed Credentials');
  lines.push(`Database: ${SUPABASE_URL} (seeded ${new Date().toISOString()})`);
  lines.push(`Shared password: ${SHARED_PASSWORD}`);
  lines.push('Custom access-token hook: confirm registered (Authentication → Hooks).');
  lines.push('');
  lines.push('## Admin');
  lines.push(`- admin@${EMAIL_DOMAIN}`);
  lines.push('');
  lines.push('## Coaches (20)');
  for (let c = 1; c <= N_COACHES; c++) lines.push(`- coach.${String(c).padStart(2, '0')}@${EMAIL_DOMAIN}`);
  lines.push('');
  lines.push('## Athletes (220)');
  lines.push(`- athlete.001@${EMAIL_DOMAIN} … athlete.${String(N_ATHLETES).padStart(3, '0')}@${EMAIL_DOMAIN}`);
  lines.push('');
  lines.push('## Quick check');
  lines.push('1. coach.01 → Performance tab: clients, adherence, top athletes, plan effectiveness, AI summary.');
  lines.push('2. an athlete with is_public → Leaderboards "You · #N of M".');
  lines.push('3. admin → Users: 241 accounts.');
  const credPath = join(process.cwd(), 'supabase', 'seed', 'PILOT_CREDENTIALS.md');
  writeFileSync(credPath, lines.join('\n') + '\n');
  console.log(`\nCredentials written to ${credPath} (gitignored).`);
  console.log(lines.join('\n'));
  console.log('\n✅ Seed complete.');
}

main().catch((e) => {
  console.error('\n❌ Seed failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
