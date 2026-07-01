// cases.test.ts — the RLS build gate (CLAUDE.md §11).
//
// Cross-tenant reads must return 0 rows; privilege escalation must be rejected;
// service_role must be the only path to mutate role/ownership; every public
// table must have RLS enabled. Any failure => non-zero exit => CI red.

import { afterAll, describe, expect, it } from 'vitest';
import { asAnon, asService, asUser, pool, type Identity } from './helpers';

// Must match seed.sql.
const COACH_A: Identity = { sub: '11111111-1111-1111-1111-111111111111', userRole: 'coach' };
const CLIENT_A1: Identity = { sub: 'aaaa0001-0000-0000-0000-000000000001', userRole: 'client' };
const CLIENT_A2 = 'aaaa0002-0000-0000-0000-000000000002';
const CLIENT_B1 = 'bbbb0001-0000-0000-0000-000000000001';
const COACH_B_ID = '22222222-2222-2222-2222-222222222222';
const NEW_USER: Identity = { sub: 'eeee0001-0000-0000-0000-000000000001', userRole: 'client' };

afterAll(async () => {
  await pool.end();
});

describe('tenant isolation — cross-tenant reads return 0 rows', () => {
  it('coach A cannot read coach B clients profile', async () => {
    const r = await asUser(COACH_A, (c) =>
      c.query('select id from public.profiles where id = $1', [CLIENT_B1]),
    );
    expect(r.rows).toHaveLength(0);
  });

  it('coach A cannot read coach B clients progress', async () => {
    const r = await asUser(COACH_A, (c) =>
      c.query('select id from public.progress_entries where user_id = $1', [CLIENT_B1]),
    );
    expect(r.rows).toHaveLength(0);
  });

  it('client A1 cannot read another clients profile or progress', async () => {
    const prof = await asUser(CLIENT_A1, (c) =>
      c.query('select id from public.profiles where id = $1', [CLIENT_A2]),
    );
    const prog = await asUser(CLIENT_A1, (c) =>
      c.query('select id from public.progress_entries where user_id = $1', [CLIENT_A2]),
    );
    expect(prof.rows).toHaveLength(0);
    expect(prog.rows).toHaveLength(0);
  });

  it('anon sees nothing (deny-by-default through the public key)', async () => {
    const prof = await asAnon((c) => c.query('select id from public.profiles'));
    const prog = await asAnon((c) => c.query('select id from public.progress_entries'));
    expect(prof.rows).toHaveLength(0);
    expect(prog.rows).toHaveLength(0);
  });
});

describe('positive controls — owners and coaches see what they should', () => {
  it('coach A sees their own two clients and their three progress rows', async () => {
    const prof = await asUser(COACH_A, (c) =>
      c.query("select id from public.profiles where role = 'client'"),
    );
    const prog = await asUser(COACH_A, (c) => c.query('select id from public.progress_entries'));
    // Coach A sees A1 + A2 (not B1); coach A's own row is role 'coach' so excluded above.
    expect(prof.rows).toHaveLength(2);
    expect(prog.rows).toHaveLength(3);
  });

  it('client A1 sees their own profile + their coach, and their own two progress rows', async () => {
    // The 0008 own-coach policy lets a client read their coach's profile row, so
    // A1 now sees exactly two profiles: themselves and Coach A.
    const prof = await asUser(CLIENT_A1, (c) => c.query('select id from public.profiles'));
    const prog = await asUser(CLIENT_A1, (c) => c.query('select id from public.progress_entries'));
    const ids = prof.rows.map((r) => r.id);
    expect(prof.rows).toHaveLength(2);
    expect(ids).toContain(CLIENT_A1.sub);
    expect(ids).toContain('11111111-1111-1111-1111-111111111111'); // Coach A
    expect(prog.rows).toHaveLength(2);
  });

  it('client A1 can read their OWN coach but not another coach (own-coach policy)', async () => {
    const ownCoach = await asUser(CLIENT_A1, (c) =>
      c.query('select id from public.profiles where id = $1', [
        '11111111-1111-1111-1111-111111111111', // Coach A — A1's coach
      ]),
    );
    const otherCoach = await asUser(CLIENT_A1, (c) =>
      c.query('select id from public.profiles where id = $1', [COACH_B_ID]),
    );
    expect(ownCoach.rows).toHaveLength(1);
    expect(otherCoach.rows).toHaveLength(0);
  });
});

describe('privilege escalation & mass-assignment are rejected', () => {
  it('client cannot elevate their own role', async () => {
    await expect(
      asUser(CLIENT_A1, (c) =>
        c.query("update public.profiles set role = 'coach' where id = $1", [CLIENT_A1.sub]),
      ),
    ).rejects.toThrow();
  });

  it('client cannot reassign their own coach (tenant hop)', async () => {
    await expect(
      asUser(CLIENT_A1, (c) =>
        c.query('update public.profiles set coach_id = $1 where id = $2', [
          COACH_B_ID,
          CLIENT_A1.sub,
        ]),
      ),
    ).rejects.toThrow();
  });

  it('client cannot insert a progress row owned by someone else', async () => {
    await expect(
      asUser(CLIENT_A1, (c) =>
        c.query('insert into public.progress_entries (user_id, weight_grams) values ($1, $2)', [
          CLIENT_B1,
          12345,
        ]),
      ),
    ).rejects.toThrow();
  });

  it('a client can no longer self-insert a profile — creation is server-side (§2)', async () => {
    // Phase 1 dropped the self-insert policy; deny-by-default now rejects every
    // client profile INSERT, even a plain one. Profiles come from the trigger.
    await expect(
      asUser(NEW_USER, (c) =>
        c.query("insert into public.profiles (id, role) values ($1, 'client')", [NEW_USER.sub]),
      ),
    ).rejects.toThrow();
  });

  it('client cannot insert a profile for another user id', async () => {
    await expect(
      asUser(NEW_USER, (c) =>
        c.query("insert into public.profiles (id, role) values ($1, 'client')", [COACH_B_ID]),
      ),
    ).rejects.toThrow();
  });
});

describe('profile bootstrap — signup creates the profile server-side', () => {
  it('inserting an auth.users row auto-creates exactly one client profile', async () => {
    const NEW_ID = 'ffff0001-0000-0000-0000-000000000001';
    // The privileged base connection mirrors Supabase Auth inserting a user;
    // wrapped in a rolled-back transaction so it never pollutes other cases.
    const c = await pool.connect();
    try {
      await c.query('begin');
      await c.query('insert into auth.users (id, email) values ($1, $2)', [
        NEW_ID,
        'bootstrap@example.test',
      ]);
      const prof = await c.query('select role, coach_id from public.profiles where id = $1', [
        NEW_ID,
      ]);
      expect(prof.rows).toHaveLength(1);
      expect(prof.rows[0].role).toBe('client');
      expect(prof.rows[0].coach_id).toBeNull();
    } finally {
      await c.query('rollback').catch(() => {});
      c.release();
    }
  });

  it('reads full_name from signup metadata into the profile (0008)', async () => {
    const NEW_ID = 'ffff0002-0000-0000-0000-000000000002';
    const c = await pool.connect();
    try {
      await c.query('begin');
      await c.query(
        'insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3::jsonb)',
        [NEW_ID, 'named@example.test', JSON.stringify({ full_name: '  Named User  ' })],
      );
      const prof = await c.query('select full_name from public.profiles where id = $1', [NEW_ID]);
      expect(prof.rows[0].full_name).toBe('Named User'); // trimmed
    } finally {
      await c.query('rollback').catch(() => {});
      c.release();
    }
  });
});

describe('service_role is the trusted server path', () => {
  it('service_role reads across all tenants', async () => {
    const prof = await asService((c) => c.query('select id from public.profiles'));
    const prog = await asService((c) => c.query('select id from public.progress_entries'));
    expect(prof.rows.length).toBeGreaterThanOrEqual(6);
    expect(prog.rows).toHaveLength(4);
  });

  it('service_role may reassign a clients coach (the move clients are denied)', async () => {
    const r = await asService((c) =>
      c.query('update public.profiles set coach_id = $1 where id = $2', [COACH_B_ID, CLIENT_A1.sub]),
    );
    expect(r.rowCount).toBe(1);
  });
});

describe('schema invariant — every public table has RLS enabled (§2)', () => {
  it('no public base table ships without row level security', async () => {
    const r = await asService((c) =>
      c.query(
        `select c.relname, c.relrowsecurity
           from pg_class c
           join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relkind = 'r'`,
      ),
    );
    expect(r.rows.length).toBeGreaterThan(0);
    for (const row of r.rows) {
      expect(row.relrowsecurity, `table ${row.relname} must have RLS enabled`).toBe(true);
    }
  });
});

describe('custom access token hook — role is injected server-side from the DB', () => {
  it('stamps profiles.role into the JWT claims (run as supabase_auth_admin)', async () => {
    const c = await pool.connect();
    try {
      await c.query('begin');
      await c.query('set local role supabase_auth_admin');
      const event = JSON.stringify({
        user_id: COACH_A.sub,
        claims: { sub: COACH_A.sub, role: 'authenticated' },
      });
      const r = await c.query('select public.custom_access_token_hook($1::jsonb) as out', [event]);
      expect(r.rows[0].out.claims.user_role).toBe('coach');
    } finally {
      await c.query('rollback').catch(() => {});
      c.release();
    }
  });

  it('yields a null role for a user without a profile (→ onboarding)', async () => {
    const c = await pool.connect();
    try {
      await c.query('begin');
      await c.query('set local role supabase_auth_admin');
      const event = JSON.stringify({ user_id: NEW_USER.sub, claims: {} });
      const r = await c.query('select public.custom_access_token_hook($1::jsonb) as out', [event]);
      expect(r.rows[0].out.claims.user_role).toBeNull();
    } finally {
      await c.query('rollback').catch(() => {});
      c.release();
    }
  });
});

describe('invitations — coach-scoped, server-side assignment (§2)', () => {
  const COACH_B: Identity = { sub: COACH_B_ID, userRole: 'coach' };

  it('a coach creates only their own pending invitation', async () => {
    const r = await asUser(COACH_A, (c) =>
      c.query("insert into public.invitations (coach_id, email) values ($1, 'x@example.test')", [
        COACH_A.sub,
      ]),
    );
    expect(r.rowCount).toBe(1);
  });

  it('a coach cannot create an invitation owned by another coach', async () => {
    await expect(
      asUser(COACH_A, (c) =>
        c.query("insert into public.invitations (coach_id, email) values ($1, 'x@example.test')", [
          COACH_B.sub,
        ]),
      ),
    ).rejects.toThrow();
  });

  it('a client cannot create an invitation', async () => {
    await expect(
      asUser(CLIENT_A1, (c) =>
        c.query("insert into public.invitations (coach_id, email) values ($1, 'x@example.test')", [
          CLIENT_A1.sub,
        ]),
      ),
    ).rejects.toThrow();
  });

  it('a coach cannot read another coach\'s invitations', async () => {
    const a = await asUser(COACH_A, (c) => c.query('select id from public.invitations'));
    const b = await asUser(COACH_B, (c) => c.query('select id from public.invitations'));
    expect(a.rows).toHaveLength(0); // Coach A owns none
    expect(b.rows).toHaveLength(1); // Coach B sees their own (seeded)
  });

  it('anon sees no invitations', async () => {
    const r = await asAnon((c) => c.query('select id from public.invitations'));
    expect(r.rows).toHaveLength(0);
  });
});

describe('assignment functions (0006) — service-side coach_id writes (§2)', () => {
  // The 0006 functions are the ONLY writers of coach_id / invitation status.
  // These cases call them exactly as the Edge Functions do: as service_role (the
  // sole grantee), which BYPASSes RLS and satisfies the profiles immutability
  // trigger. Fixtures are created on the privileged base connection and rolled
  // back, so nothing leaks between cases. Inserting an auth.users row fires the
  // 0003 trigger, which creates the invitee/client's profile (client, no coach).

  const INVITEE_ID = '0a000001-0000-0000-0000-000000000001';
  const INVITEE_EMAIL = 'fresh.invitee@example.test';
  const TOKEN = '0a000002-0000-0000-0000-000000000002';

  it('accept_invitation assigns the coach and consumes the token (single-use)', async () => {
    const c = await pool.connect();
    try {
      await c.query('begin');
      await c.query('insert into auth.users (id, email) values ($1, $2)', [
        INVITEE_ID,
        INVITEE_EMAIL,
      ]);
      await c.query(
        'insert into public.invitations (coach_id, email, token) values ($1, $2, $3)',
        [COACH_A.sub, INVITEE_EMAIL, TOKEN],
      );

      // Redeem as the Edge Function would — as service_role.
      await c.query('set local role service_role');
      const r = await c.query('select public.accept_invitation($1, $2, $3) as coach', [
        TOKEN,
        INVITEE_ID,
        INVITEE_EMAIL,
      ]);
      expect(r.rows[0].coach).toBe(COACH_A.sub);
      await c.query('reset role');

      const prof = await c.query('select coach_id from public.profiles where id = $1', [INVITEE_ID]);
      expect(prof.rows[0].coach_id).toBe(COACH_A.sub);
      const inv = await c.query(
        'select status, accepted_by from public.invitations where token = $1',
        [TOKEN],
      );
      expect(inv.rows[0].status).toBe('accepted');
      expect(inv.rows[0].accepted_by).toBe(INVITEE_ID);

      // Single-use: a second redemption of the now-accepted token is rejected.
      await c.query('set local role service_role');
      await expect(
        c.query('select public.accept_invitation($1, $2, $3)', [TOKEN, INVITEE_ID, INVITEE_EMAIL]),
      ).rejects.toThrow();
    } finally {
      await c.query('rollback').catch(() => {});
      c.release();
    }
  });

  it('accept_invitation rejects an expired token', async () => {
    const c = await pool.connect();
    try {
      await c.query('begin');
      await c.query('insert into auth.users (id, email) values ($1, $2)', [
        INVITEE_ID,
        INVITEE_EMAIL,
      ]);
      await c.query(
        `insert into public.invitations (coach_id, email, token, expires_at)
         values ($1, $2, $3, now() - interval '1 day')`,
        [COACH_A.sub, INVITEE_EMAIL, TOKEN],
      );
      await c.query('set local role service_role');
      await expect(
        c.query('select public.accept_invitation($1, $2, $3)', [TOKEN, INVITEE_ID, INVITEE_EMAIL]),
      ).rejects.toThrow();
    } finally {
      await c.query('rollback').catch(() => {});
      c.release();
    }
  });

  it('accept_invitation rejects a mismatched email (leaked-link defense)', async () => {
    const c = await pool.connect();
    try {
      await c.query('begin');
      await c.query('insert into auth.users (id, email) values ($1, $2)', [
        INVITEE_ID,
        INVITEE_EMAIL,
      ]);
      await c.query(
        'insert into public.invitations (coach_id, email, token) values ($1, $2, $3)',
        [COACH_A.sub, INVITEE_EMAIL, TOKEN],
      );
      // A raised error aborts the surrounding transaction, so wrap the expected
      // failure in a savepoint we can roll back to and keep querying.
      await c.query('savepoint sp');
      await c.query('set local role service_role');
      await expect(
        c.query('select public.accept_invitation($1, $2, $3)', [
          TOKEN,
          INVITEE_ID,
          'someone.else@example.test',
        ]),
      ).rejects.toThrow();
      await c.query('rollback to savepoint sp'); // clears the aborted state + the set role
      // The token must still be pending after a rejected attempt.
      const inv = await c.query('select status from public.invitations where token = $1', [TOKEN]);
      expect(inv.rows[0].status).toBe('pending');
    } finally {
      await c.query('rollback').catch(() => {});
      c.release();
    }
  });

  it('assign_client links an unassigned client to a coach', async () => {
    const CLIENT_ID = '0a000003-0000-0000-0000-000000000003';
    const c = await pool.connect();
    try {
      await c.query('begin');
      await c.query('insert into auth.users (id, email) values ($1, $2)', [
        CLIENT_ID,
        'fresh.client@example.test',
      ]);
      await c.query('set local role service_role');
      await c.query('select public.assign_client($1, $2)', [COACH_A.sub, CLIENT_ID]);
      await c.query('reset role');
      const prof = await c.query('select coach_id from public.profiles where id = $1', [CLIENT_ID]);
      expect(prof.rows[0].coach_id).toBe(COACH_A.sub);
    } finally {
      await c.query('rollback').catch(() => {});
      c.release();
    }
  });

  it('assign_client refuses to steal an already-assigned client', async () => {
    // CLIENT_A1 belongs to COACH_A (seed); COACH_B may not pull them over.
    await expect(
      asService((c) => c.query('select public.assign_client($1, $2)', [COACH_B_ID, CLIENT_A1.sub])),
    ).rejects.toThrow();
  });

  it('assign_client rejects a non-coach actor', async () => {
    await expect(
      asService((c) => c.query('select public.assign_client($1, $2)', [CLIENT_A2, CLIENT_B1])),
    ).rejects.toThrow();
  });

  it('the assignment functions are not executable by authenticated/anon', async () => {
    await expect(
      asUser(CLIENT_A1, (c) =>
        c.query('select public.accept_invitation($1, $2, $3)', [TOKEN, CLIENT_A1.sub, INVITEE_EMAIL]),
      ),
    ).rejects.toThrow();
    await expect(
      asUser(COACH_A, (c) => c.query('select public.assign_client($1, $2)', [COACH_A.sub, CLIENT_A2])),
    ).rejects.toThrow();
  });

  it('accept_invitation refuses a client who already has a coach (one-coach lock)', async () => {
    // CLIENT_A1 already belongs to Coach A; a Coach B invite to their email must
    // be rejected with the distinct already_has_coach signal.
    const TOKEN2 = '0a000004-0000-0000-0000-000000000004';
    await expect(
      asService(async (c) => {
        await c.query(
          'insert into public.invitations (coach_id, email, token) values ($1, $2, $3)',
          [COACH_B_ID, 'client.a1@example.test', TOKEN2],
        );
        return c.query('select public.accept_invitation($1, $2, $3)', [
          TOKEN2,
          CLIENT_A1.sub,
          'client.a1@example.test',
        ]);
      }),
    ).rejects.toThrow(/already_has_coach/);
  });

  it('rejects a duplicate PENDING invite to the same (coach, email) — 0008 dedupe', async () => {
    await expect(
      asUser(COACH_A, async (c) => {
        await c.query(
          "insert into public.invitations (coach_id, email) values ($1, 'dup@example.test')",
          [COACH_A.sub],
        );
        return c.query(
          "insert into public.invitations (coach_id, email) values ($1, 'DUP@example.test')",
          [COACH_A.sub],
        );
      }),
    ).rejects.toThrow();
  });
});

describe('plans v2 (0010) — templates, library, hierarchy, clone (§2)', () => {
  const COACH_B: Identity = { sub: COACH_B_ID, userRole: 'coach' };
  const A1_PUB_TRAIN = '99990001-0000-0000-0000-000000000001';
  const A1_DRAFT_NUT = '99990002-0000-0000-0000-000000000002';
  const A1_PUB_NUT = '99990004-0000-0000-0000-000000000004';
  const B1_PLAN = '99990003-0000-0000-0000-000000000003';
  const TEMPLATE_A_TRAIN = '99990010-0000-0000-0000-000000000010';
  const TEMPLATE_A_NUT = '99990011-0000-0000-0000-000000000011';
  const DAY_A1_PUB = 'da000001-0000-0000-0000-000000000001';
  const WEEK_A1_PUB = 'ee000001-0000-0000-0000-000000000001';
  const WEEK_B1 = 'ee000003-0000-0000-0000-000000000003';
  const MEAL_A1_PUB_NUT = 'dd000004-0000-0000-0000-000000000004';
  const MEAL_A1_DRAFT = 'dd000002-0000-0000-0000-000000000002';
  const CUSTOM_EX_A = 'ca000001-0000-0000-0000-00000000000a';
  const CUSTOM_FOOD_B = 'cb000001-0000-0000-0000-00000000000b';
  const GLOBAL_EX = 'e0000000-0000-0000-0000-000000000001';
  const GLOBAL_FOOD = 'f0000000-0000-0000-0000-000000000001';

  // ── templates vs assigned ──────────────────────────────────────────────────
  it('coach A sees their templates + their assigned plans; coach B only theirs', async () => {
    // Filter to OWN plans — every coach now ALSO sees the global system templates.
    const a = await asUser(COACH_A, (c) => c.query('select id from public.plans where coach_id = $1', [COACH_A.sub]));
    const b = await asUser(COACH_B, (c) => c.query('select id from public.plans where coach_id = $1', [COACH_B_ID]));
    expect(a.rows).toHaveLength(5); // 3 assigned to A1 + 2 templates
    expect(b.rows).toHaveLength(1); // B1 assigned
  });

  it('a client reads only their non-draft assigned plans — never a template', async () => {
    const all = await asUser(CLIENT_A1, (c) => c.query('select id from public.plans'));
    const ids = all.rows.map((r) => r.id);
    expect(all.rows).toHaveLength(2); // pub training + pub nutrition
    expect(ids).toContain(A1_PUB_TRAIN);
    expect(ids).toContain(A1_PUB_NUT);
    expect(ids).not.toContain(A1_DRAFT_NUT); // draft hidden
    expect(ids).not.toContain(B1_PLAN); // other tenant

    const templates = await asUser(CLIENT_A1, (c) =>
      c.query('select id from public.plans where client_id is null'),
    );
    expect(templates.rows).toHaveLength(0); // cannot read ANY template
  });

  it('coach B cannot read coach A’s template', async () => {
    const r = await asUser(COACH_B, (c) =>
      c.query('select id from public.plans where id = $1', [TEMPLATE_A_TRAIN]),
    );
    expect(r.rows).toHaveLength(0);
  });

  it('a coach can create a template (no client) but a client cannot', async () => {
    const ok = await asUser(COACH_A, (c) =>
      c.query(
        "insert into public.plans (coach_id, client_id, type, title) values ($1, null, 'training', 'T')",
        [COACH_A.sub],
      ),
    );
    expect(ok.rowCount).toBe(1);
    await expect(
      asUser(CLIENT_A1, (c) =>
        c.query(
          "insert into public.plans (coach_id, client_id, type, title) values ($1, null, 'training', 'T')",
          [CLIENT_A1.sub],
        ),
      ),
    ).rejects.toThrow();
  });

  // ── hierarchy reads/writes ─────────────────────────────────────────────────
  it('client reads children of their published plans only (through the helper chain)', async () => {
    const days = await asUser(CLIENT_A1, (c) =>
      c.query('select id from public.plan_days where plan_id = $1', [A1_PUB_TRAIN]),
    );
    const exs = await asUser(CLIENT_A1, (c) =>
      c.query('select id from public.plan_exercises where day_id = $1', [DAY_A1_PUB]),
    );
    const pubMeals = await asUser(CLIENT_A1, (c) =>
      c.query('select id from public.plan_meals where plan_id = $1', [A1_PUB_NUT]),
    );
    const draftMeals = await asUser(CLIENT_A1, (c) =>
      c.query('select id from public.plan_meals where plan_id = $1', [A1_DRAFT_NUT]),
    );
    expect(days.rows).toHaveLength(1);
    expect(exs.rows).toHaveLength(2);
    expect(pubMeals.rows).toHaveLength(1);
    expect(draftMeals.rows).toHaveLength(0); // draft plan's children hidden
  });

  it('client cannot read another tenant’s plan children', async () => {
    const r = await asUser(CLIENT_A1, (c) =>
      c.query(
        'select e.id from public.plan_exercises e join public.plan_days d on d.id = e.day_id where d.plan_id = $1',
        [B1_PLAN],
      ),
    );
    expect(r.rows).toHaveLength(0);
  });

  it('coach writes children only on plans they own; a client cannot write at all', async () => {
    const ok = await asUser(COACH_A, (c) =>
      c.query("insert into public.plan_days (plan_id, week_id, name) values ($1, $2, 'D')", [A1_PUB_TRAIN, WEEK_A1_PUB]),
    );
    expect(ok.rowCount).toBe(1);
    await expect(
      asUser(COACH_A, (c) =>
        c.query("insert into public.plan_days (plan_id, week_id, name) values ($1, $2, 'D')", [B1_PLAN, WEEK_B1]),
      ),
    ).rejects.toThrow();
    await expect(
      asUser(CLIENT_A1, (c) =>
        c.query("insert into public.plan_days (plan_id, week_id, name) values ($1, $2, 'D')", [A1_PUB_TRAIN, WEEK_A1_PUB]),
      ),
    ).rejects.toThrow();
  });

  it('coach writes meal items only on plans they own (grandchild helper chain)', async () => {
    const ok = await asUser(COACH_A, (c) =>
      c.query(
        "insert into public.plan_meal_items (meal_id, food_id, food_name, grams) values ($1, $2, 'X', 100)",
        [MEAL_A1_PUB_NUT, GLOBAL_FOOD],
      ),
    );
    expect(ok.rowCount).toBe(1);
    await expect(
      asUser(CLIENT_A1, (c) =>
        c.query(
          "insert into public.plan_meal_items (meal_id, food_id, food_name, grams) values ($1, $2, 'X', 100)",
          [MEAL_A1_DRAFT, GLOBAL_FOOD],
        ),
      ),
    ).rejects.toThrow();
  });

  // ── library: globals shared, customs private ───────────────────────────────
  it('every coach reads global library entries', async () => {
    const a = await asUser(COACH_A, (c) =>
      c.query('select id from public.exercise_library where id = $1', [GLOBAL_EX]),
    );
    const b = await asUser(COACH_B, (c) =>
      c.query('select id from public.food_library where id = $1', [GLOBAL_FOOD]),
    );
    expect(a.rows).toHaveLength(1);
    expect(b.rows).toHaveLength(1);
  });

  it('a coach reads their own custom entry but not another coach’s', async () => {
    const ownEx = await asUser(COACH_A, (c) =>
      c.query('select id from public.exercise_library where id = $1', [CUSTOM_EX_A]),
    );
    const otherEx = await asUser(COACH_B, (c) =>
      c.query('select id from public.exercise_library where id = $1', [CUSTOM_EX_A]),
    );
    const otherFood = await asUser(COACH_A, (c) =>
      c.query('select id from public.food_library where id = $1', [CUSTOM_FOOD_B]),
    );
    expect(ownEx.rows).toHaveLength(1);
    expect(otherEx.rows).toHaveLength(0);
    expect(otherFood.rows).toHaveLength(0);
  });

  it('a coach can create their own custom exercise, but cannot forge a global or another coach’s', async () => {
    const ok = await asUser(COACH_A, (c) =>
      c.query(
        "insert into public.exercise_library (coach_id, name, muscle_group) values ($1, 'X', 'push')",
        [COACH_A.sub],
      ),
    );
    expect(ok.rowCount).toBe(1);
    await expect(
      asUser(COACH_A, (c) =>
        c.query(
          "insert into public.exercise_library (coach_id, name, muscle_group) values (null, 'G', 'push')",
        ),
      ),
    ).rejects.toThrow(); // can't forge a global
    await expect(
      asUser(COACH_A, (c) =>
        c.query(
          "insert into public.exercise_library (coach_id, name, muscle_group) values ($1, 'X', 'push')",
          [COACH_B_ID],
        ),
      ),
    ).rejects.toThrow(); // can't insert as another coach
  });

  it('a client cannot create a library entry', async () => {
    await expect(
      asUser(CLIENT_A1, (c) =>
        c.query(
          "insert into public.exercise_library (coach_id, name, muscle_group) values ($1, 'X', 'push')",
          [CLIENT_A1.sub],
        ),
      ),
    ).rejects.toThrow();
  });

  // ── clone / assign ─────────────────────────────────────────────────────────
  it('assign_plan_to_client deep-copies a template into an independent assigned plan', async () => {
    const r = await asUser(COACH_A, async (c) => {
      const res = await c.query('select public.assign_plan_to_client($1, $2) as id', [
        TEMPLATE_A_TRAIN,
        CLIENT_A1.sub,
      ]);
      const newId = res.rows[0].id;
      const plan = await c.query(
        'select coach_id, client_id, source_plan_id, status, type from public.plans where id = $1',
        [newId],
      );
      const days = await c.query('select id from public.plan_days where plan_id = $1', [newId]);
      const exs = await c.query(
        'select e.id from public.plan_exercises e join public.plan_days d on d.id = e.day_id where d.plan_id = $1',
        [newId],
      );
      return { plan: plan.rows[0], days: days.rows.length, exs: exs.rows.length };
    });
    expect(r.plan.coach_id).toBe(COACH_A.sub);
    expect(r.plan.client_id).toBe(CLIENT_A1.sub);
    expect(r.plan.source_plan_id).toBe(TEMPLATE_A_TRAIN);
    expect(r.plan.status).toBe('draft');
    expect(r.days).toBe(1); // template had 1 day
    expect(r.exs).toBe(1); // template had 1 exercise
  });

  it('assign_plan_to_client clones a nutrition template’s meals + items', async () => {
    const r = await asUser(COACH_A, async (c) => {
      const res = await c.query('select public.assign_plan_to_client($1, $2) as id', [
        TEMPLATE_A_NUT,
        CLIENT_A1.sub,
      ]);
      const newId = res.rows[0].id;
      const meals = await c.query('select id from public.plan_meals where plan_id = $1', [newId]);
      const items = await c.query(
        'select i.id from public.plan_meal_items i join public.plan_meals m on m.id = i.meal_id where m.plan_id = $1',
        [newId],
      );
      return { meals: meals.rows.length, items: items.rows.length };
    });
    expect(r.meals).toBe(1);
    expect(r.items).toBe(1);
  });

  it('assign_plan_to_client rejects a non-client, a non-template, another coach, and a client caller', async () => {
    await expect(
      asUser(COACH_A, (c) =>
        c.query('select public.assign_plan_to_client($1, $2)', [TEMPLATE_A_TRAIN, CLIENT_B1]),
      ),
    ).rejects.toThrow(); // not coach A's client
    await expect(
      asUser(COACH_A, (c) =>
        c.query('select public.assign_plan_to_client($1, $2)', [A1_PUB_TRAIN, CLIENT_A1.sub]),
      ),
    ).rejects.toThrow(); // not a template (has client_id)
    await expect(
      asUser(COACH_B, (c) =>
        c.query('select public.assign_plan_to_client($1, $2)', [TEMPLATE_A_TRAIN, CLIENT_B1]),
      ),
    ).rejects.toThrow(); // coach A's template, not B's
    await expect(
      asUser(CLIENT_A1, (c) =>
        c.query('select public.assign_plan_to_client($1, $2)', [TEMPLATE_A_TRAIN, CLIENT_A1.sub]),
      ),
    ).rejects.toThrow(); // client cannot assign
  });

  it('anon sees no plans, library, or plan children', async () => {
    for (const t of [
      'plans',
      'plan_days',
      'plan_exercises',
      'plan_meals',
      'plan_meal_items',
      'exercise_library',
      'food_library',
    ]) {
      const r = await asAnon((c) => c.query(`select * from public.${t} limit 5`));
      expect(r.rows, `anon must see 0 rows in ${t}`).toHaveLength(0);
    }
  });
});

describe('coach applications (0011) — client applies, admin reviews, role flip (§2)', () => {
  const ADMIN: Identity = { sub: 'dddddddd-dddd-dddd-dddd-dddddddddddd', userRole: 'admin' };
  const SEED_APP = '0bbb0001-0000-0000-0000-000000000001'; // pending, owned by Client A2

  it('a client applies for themselves (own pending insert)', async () => {
    const r = await asUser(CLIENT_A1, (c) =>
      c.query('insert into public.coach_applications (user_id) values ($1)', [CLIENT_A1.sub]),
    );
    expect(r.rowCount).toBe(1);
  });

  it('a client cannot apply for another user', async () => {
    await expect(
      asUser(CLIENT_A1, (c) =>
        c.query('insert into public.coach_applications (user_id) values ($1)', [CLIENT_B1]),
      ),
    ).rejects.toThrow();
  });

  it('a coach cannot apply (role check)', async () => {
    await expect(
      asUser(COACH_A, (c) =>
        c.query('insert into public.coach_applications (user_id) values ($1)', [COACH_A.sub]),
      ),
    ).rejects.toThrow();
  });

  it('rejects a duplicate PENDING application for the same user (dedupe)', async () => {
    await expect(
      asUser(CLIENT_A1, async (c) => {
        await c.query('insert into public.coach_applications (user_id) values ($1)', [CLIENT_A1.sub]);
        return c.query('insert into public.coach_applications (user_id) values ($1)', [CLIENT_A1.sub]);
      }),
    ).rejects.toThrow();
  });

  it('a client reads only their own application; an admin reads all', async () => {
    const a1 = await asUser(CLIENT_A1, (c) => c.query('select id from public.coach_applications'));
    const a2 = await asUser({ sub: CLIENT_A2, userRole: 'client' }, (c) =>
      c.query('select id from public.coach_applications'),
    );
    const admin = await asUser(ADMIN, (c) => c.query('select id from public.coach_applications'));
    expect(a1.rows).toHaveLength(0); // A1 owns none
    expect(a2.rows).toHaveLength(1); // A2 owns the seeded pending one
    expect(admin.rows.length).toBeGreaterThanOrEqual(1); // admin sees it
  });

  it('review_coach_application is not executable by authenticated/anon', async () => {
    await expect(
      asUser(ADMIN, (c) =>
        c.query('select public.review_coach_application($1, true, $2)', [SEED_APP, ADMIN.sub]),
      ),
    ).rejects.toThrow();
    await expect(
      asAnon((c) =>
        c.query('select public.review_coach_application($1, true, $2)', [SEED_APP, ADMIN.sub]),
      ),
    ).rejects.toThrow();
  });

  it('approve flips the applicant to coach, clears coach_id, marks approved', async () => {
    const r = await asService(async (c) => {
      await c.query('select public.review_coach_application($1, true, $2)', [SEED_APP, ADMIN.sub]);
      const app = await c.query('select status, reviewed_by from public.coach_applications where id = $1', [
        SEED_APP,
      ]);
      const prof = await c.query('select role, coach_id from public.profiles where id = $1', [
        CLIENT_A2,
      ]);
      return { app: app.rows[0], prof: prof.rows[0] };
    });
    expect(r.app.status).toBe('approved');
    expect(r.app.reviewed_by).toBe(ADMIN.sub);
    expect(r.prof.role).toBe('coach');
    expect(r.prof.coach_id).toBeNull();
  });

  it('reject marks the application rejected and leaves the role unchanged', async () => {
    const r = await asService(async (c) => {
      await c.query('select public.review_coach_application($1, false, $2)', [SEED_APP, ADMIN.sub]);
      const app = await c.query('select status from public.coach_applications where id = $1', [SEED_APP]);
      const prof = await c.query('select role from public.profiles where id = $1', [CLIENT_A2]);
      return { status: app.rows[0].status, role: prof.rows[0].role };
    });
    expect(r.status).toBe('rejected');
    expect(r.role).toBe('client');
  });

  it('a non-admin reviewer is rejected', async () => {
    await expect(
      asService((c) =>
        c.query('select public.review_coach_application($1, true, $2)', [SEED_APP, COACH_A.sub]),
      ),
    ).rejects.toThrow();
  });

  it('anon sees no applications', async () => {
    const r = await asAnon((c) => c.query('select id from public.coach_applications'));
    expect(r.rows).toHaveLength(0);
  });
});

describe('messages (0012) — coach⇄client DMs, server-set sender, rate limit (§8)', () => {
  const COACH_B: Identity = { sub: COACH_B_ID, userRole: 'coach' };
  const CLIENT_B1_ID: Identity = { sub: CLIENT_B1, userRole: 'client' };

  it('a coach messages their own client, and a client their own coach', async () => {
    const a = await asUser(COACH_A, (c) =>
      c.query('insert into public.messages (recipient_id, body) values ($1, $2)', [
        CLIENT_A1.sub,
        'hi A1',
      ]),
    );
    const b = await asUser(CLIENT_A1, (c) =>
      c.query('insert into public.messages (recipient_id, body) values ($1, $2)', [
        '11111111-1111-1111-1111-111111111111',
        'hi coach',
      ]),
    );
    expect(a.rowCount).toBe(1);
    expect(b.rowCount).toBe(1);
  });

  it('the server forces sender_id = auth.uid() (a forged sender is overwritten)', async () => {
    const r = await asUser(COACH_A, (c) =>
      c.query(
        'insert into public.messages (sender_id, recipient_id, body) values ($1, $2, $3) returning sender_id',
        [COACH_B_ID, CLIENT_A1.sub, 'forged'],
      ),
    );
    expect(r.rows[0].sender_id).toBe(COACH_A.sub); // not the forged COACH_B_ID
  });

  it('cannot message someone you are not paired with', async () => {
    // Coach A -> Coach B's client; and Client A1 -> Coach B.
    await expect(
      asUser(COACH_A, (c) =>
        c.query('insert into public.messages (recipient_id, body) values ($1, $2)', [CLIENT_B1, 'x']),
      ),
    ).rejects.toThrow();
    await expect(
      asUser(CLIENT_A1, (c) =>
        c.query('insert into public.messages (recipient_id, body) values ($1, $2)', [COACH_B_ID, 'x']),
      ),
    ).rejects.toThrow();
  });

  it('cannot message yourself', async () => {
    await expect(
      asUser(COACH_A, (c) =>
        c.query('insert into public.messages (recipient_id, body) values ($1, $2)', [
          COACH_A.sub,
          'me',
        ]),
      ),
    ).rejects.toThrow();
  });

  it('only the two parties read a message; outsiders see nothing', async () => {
    // Seeded: 2 messages between Coach A and Client A1.
    const coachA = await asUser(COACH_A, (c) => c.query('select id from public.messages'));
    const clientA1 = await asUser(CLIENT_A1, (c) => c.query('select id from public.messages'));
    const coachB = await asUser(COACH_B, (c) => c.query('select id from public.messages'));
    const clientB1 = await asUser(CLIENT_B1_ID, (c) => c.query('select id from public.messages'));
    expect(coachA.rows.length).toBeGreaterThanOrEqual(2);
    expect(clientA1.rows.length).toBeGreaterThanOrEqual(2);
    expect(coachB.rows).toHaveLength(0);
    expect(clientB1.rows).toHaveLength(0);
  });

  it('rate-limits a burst of sends from one sender', async () => {
    // 10/10s cap (tightened in 0063); the 11th in the same transaction trips it (now()
    // is constant within the txn, so all rows fall inside the window).
    await expect(
      asUser(COACH_A, async (c) => {
        for (let i = 0; i < 21; i++) {
          await c.query('insert into public.messages (recipient_id, body) values ($1, $2)', [
            CLIENT_A1.sub,
            `msg ${i}`,
          ]);
        }
      }),
    ).rejects.toThrow(/rate_limited/);
  });

  it('anon sees no messages', async () => {
    const r = await asAnon((c) => c.query('select id from public.messages'));
    expect(r.rows).toHaveLength(0);
  });
});

describe('media (0013) — owner/coach/admin read, writes are service-role-only (§2/§7)', () => {
  const ADMIN: Identity = { sub: 'dddddddd-dddd-dddd-dddd-dddddddddddd', userRole: 'admin' };
  const COACH_B: Identity = { sub: COACH_B_ID, userRole: 'coach' };
  const CLIENT_B1_ID: Identity = { sub: CLIENT_B1, userRole: 'client' };
  const SEED_MEDIA = 'ed000001-0000-0000-0000-000000000001'; // Client A1's progress photo

  it('the owner and their coach read the row; admin sees it too', async () => {
    const owner = await asUser(CLIENT_A1, (c) => c.query('select id from public.media'));
    const coach = await asUser(COACH_A, (c) => c.query('select id from public.media'));
    const admin = await asUser(ADMIN, (c) => c.query('select id from public.media'));
    expect(owner.rows.length).toBeGreaterThanOrEqual(1);
    expect(coach.rows.length).toBeGreaterThanOrEqual(1); // is_coach_of(owner)
    expect(admin.rows.length).toBeGreaterThanOrEqual(1);
  });

  it('a different tenant (other coach / other client) sees no PRIVATE media', async () => {
    // Avatars of PUBLIC profiles are an intentional exception (0044) — readable by any
    // authenticated user — so scope this tenant-isolation check to private health media.
    const coachB = await asUser(COACH_B, (c) =>
      c.query("select id from public.media where kind <> 'avatar'"),
    );
    const clientB1 = await asUser(CLIENT_B1_ID, (c) =>
      c.query("select id from public.media where kind <> 'avatar'"),
    );
    expect(coachB.rows).toHaveLength(0);
    expect(clientB1.rows).toHaveLength(0);
  });

  it('anon sees no media', async () => {
    const r = await asAnon((c) => c.query('select id from public.media'));
    expect(r.rows).toHaveLength(0);
  });

  it('an authenticated client cannot INSERT a media row (server-side only)', async () => {
    // No insert policy AND no insert grant to authenticated — even for own rows.
    await expect(
      asUser(CLIENT_A1, (c) =>
        c.query(
          `insert into public.media (owner_id, kind, bucket, path, mime_type, size_bytes)
             values ($1, 'progress_photo', 'media', $2, 'image/jpeg', 100)`,
          [CLIENT_A1.sub, `${CLIENT_A1.sub}/forged.jpg`],
        ),
      ),
    ).rejects.toThrow();
  });

  it('an authenticated client cannot UPDATE or DELETE a media row', async () => {
    await expect(
      asUser(CLIENT_A1, (c) =>
        c.query("update public.media set kind = 'inbody' where id = $1", [SEED_MEDIA]),
      ),
    ).rejects.toThrow();
    await expect(
      asUser(CLIENT_A1, (c) => c.query('delete from public.media where id = $1', [SEED_MEDIA])),
    ).rejects.toThrow();
  });

  it('the service role is the trusted writer (and reads all)', async () => {
    const all = await asService((c) => c.query('select id from public.media'));
    expect(all.rows.length).toBeGreaterThanOrEqual(1);
    const ins = await asService((c) =>
      c.query(
        `insert into public.media (owner_id, kind, bucket, path, mime_type, size_bytes)
           values ($1, 'inbody', 'media', $2, 'application/pdf', 2048) returning id`,
        [CLIENT_A1.sub, `${CLIENT_A1.sub}/inbody-1.pdf`],
      ),
    );
    expect(ins.rowCount).toBe(1);
  });
});

describe('plans v3 (0014/0015) — weeks, system templates, clone, duplicate (§2)', () => {
  const COACH_B: Identity = { sub: COACH_B_ID, userRole: 'coach' };
  const SYSTEM_TPL = '7e510000-0000-0000-0000-000000000002'; // 4-Day Upper/Lower (global)
  const OWN_TPL = '99990010-0000-0000-0000-000000000010'; // Coach A's own training template
  const A1_PUB_TRAIN = '99990001-0000-0000-0000-000000000001';
  const B1_PLAN = '99990003-0000-0000-0000-000000000003';
  const WEEK_A1 = 'ee000001-0000-0000-0000-000000000001';
  const WEEK_B1 = 'ee000003-0000-0000-0000-000000000003';

  it('every coach can READ a global system template; a client cannot', async () => {
    const a = await asUser(COACH_A, (c) => c.query('select id from public.plans where id = $1', [SYSTEM_TPL]));
    const b = await asUser(COACH_B, (c) => c.query('select id from public.plans where id = $1', [SYSTEM_TPL]));
    const cl = await asUser(CLIENT_A1, (c) => c.query('select id from public.plans where id = $1', [SYSTEM_TPL]));
    expect(a.rows).toHaveLength(1);
    expect(b.rows).toHaveLength(1);
    expect(cl.rows).toHaveLength(0);
  });

  it('a system template is read-only — a coach cannot add a week to it', async () => {
    await expect(
      asUser(COACH_A, (c) => c.query("insert into public.plan_weeks (plan_id, name) values ($1, 'W')", [SYSTEM_TPL])),
    ).rejects.toThrow();
  });

  it('weeks are tenant-scoped: a coach reads/writes only their own plan’s weeks', async () => {
    const own = await asUser(COACH_A, (c) => c.query('select id from public.plan_weeks where plan_id = $1', [A1_PUB_TRAIN]));
    const cross = await asUser(COACH_B, (c) => c.query('select id from public.plan_weeks where plan_id = $1', [A1_PUB_TRAIN]));
    expect(own.rows.length).toBeGreaterThanOrEqual(1);
    expect(cross.rows).toHaveLength(0);
    const ok = await asUser(COACH_A, (c) => c.query("insert into public.plan_weeks (plan_id, name) values ($1, 'W2')", [A1_PUB_TRAIN]));
    expect(ok.rowCount).toBe(1);
    await expect(
      asUser(COACH_A, (c) => c.query("insert into public.plan_weeks (plan_id, name) values ($1, 'W')", [B1_PLAN])),
    ).rejects.toThrow();
  });

  it('the composite FK rejects a day whose week belongs to another plan', async () => {
    // RLS would allow (coach A owns A1_PUB_TRAIN) but the week is B1's → FK violation.
    await expect(
      asUser(COACH_A, (c) =>
        c.query("insert into public.plan_days (plan_id, week_id, name) values ($1, $2, 'D')", [A1_PUB_TRAIN, WEEK_B1]),
      ),
    ).rejects.toThrow();
  });

  it('clone_template copies a GLOBAL template into a new editable coach-owned template', async () => {
    const r = await asUser(COACH_A, async (c) => {
      const res = await c.query('select public.clone_template($1) as id', [SYSTEM_TPL]);
      const newId = res.rows[0].id;
      const plan = await c.query('select coach_id, client_id, source_plan_id, status from public.plans where id = $1', [newId]);
      const weeks = await c.query('select id from public.plan_weeks where plan_id = $1', [newId]);
      const days = await c.query('select id from public.plan_days where plan_id = $1', [newId]);
      const exs = await c.query(
        'select e.id from public.plan_exercises e join public.plan_days d on d.id = e.day_id where d.plan_id = $1',
        [newId],
      );
      return { plan: plan.rows[0], weeks: weeks.rows.length, days: days.rows.length, exs: exs.rows.length };
    });
    expect(r.plan.coach_id).toBe(COACH_A.sub);
    expect(r.plan.client_id).toBeNull();
    expect(r.plan.source_plan_id).toBe(SYSTEM_TPL);
    expect(r.plan.status).toBe('draft');
    expect(r.weeks).toBe(1);
    expect(r.days).toBe(4); // 4-Day Upper/Lower
    expect(r.exs).toBeGreaterThanOrEqual(15);
  });

  it('a client cannot clone a template', async () => {
    await expect(
      asUser(CLIENT_A1, (c) => c.query('select public.clone_template($1)', [SYSTEM_TPL])),
    ).rejects.toThrow();
  });

  it('duplicate_plan_week copies a week + its days into a new week in the same plan', async () => {
    const r = await asUser(COACH_A, async (c) => {
      const before = await c.query('select count(*)::int as n from public.plan_weeks where plan_id = $1', [A1_PUB_TRAIN]);
      const srcDays = await c.query('select count(*)::int as n from public.plan_days where week_id = $1', [WEEK_A1]);
      const res = await c.query('select public.duplicate_plan_week($1) as id', [WEEK_A1]);
      const newWeek = res.rows[0].id;
      const after = await c.query('select count(*)::int as n from public.plan_weeks where plan_id = $1', [A1_PUB_TRAIN]);
      const newDays = await c.query('select count(*)::int as n from public.plan_days where week_id = $1', [newWeek]);
      return {
        before: before.rows[0].n,
        after: after.rows[0].n,
        srcDays: srcDays.rows[0].n,
        newDays: newDays.rows[0].n,
      };
    });
    expect(r.after).toBe(r.before + 1);
    expect(r.newDays).toBe(r.srcDays);
  });

  it('a coach cannot duplicate a week in another coach’s plan', async () => {
    await expect(
      asUser(COACH_B, (c) => c.query('select public.duplicate_plan_week($1)', [WEEK_A1])),
    ).rejects.toThrow();
  });

  it('assign_plan_to_client clones the weeks layer', async () => {
    const weeks = await asUser(COACH_A, async (c) => {
      const res = await c.query('select public.assign_plan_to_client($1, $2) as id', [OWN_TPL, CLIENT_A1.sub]);
      const w = await c.query('select count(*)::int as n from public.plan_weeks where plan_id = $1', [res.rows[0].id]);
      return w.rows[0].n;
    });
    expect(weeks).toBeGreaterThanOrEqual(1);
  });

  it('anon sees no weeks', async () => {
    const r = await asAnon((c) => c.query('select id from public.plan_weeks'));
    expect(r.rows).toHaveLength(0);
  });
});

describe('completion logging (0016) — sessions, set logs, derived metrics (§2)', () => {
  const COACH_B: Identity = { sub: COACH_B_ID, userRole: 'coach' };
  const CLIENT_A2_ID: Identity = { sub: CLIENT_A2, userRole: 'client' };
  const CLIENT_B1_ID: Identity = { sub: CLIENT_B1, userRole: 'client' };
  const SESS_A1 = '5e550001-0000-0000-0000-000000000001'; // A1, today, 3 set logs
  const SESS_B1 = '5e550005-0000-0000-0000-000000000005'; // B1 (Coach B's client)

  // ── cross-tenant denial ────────────────────────────────────────────────────
  it('coach A cannot read coach B’s client sessions; a client cannot read a sibling’s', async () => {
    const coach = await asUser(COACH_A, (c) =>
      c.query('select id from public.workout_sessions where user_id = $1', [CLIENT_B1]),
    );
    const sibling = await asUser(CLIENT_A1, (c) =>
      c.query('select id from public.workout_sessions where user_id = $1', [CLIENT_A2]),
    );
    expect(coach.rows).toHaveLength(0);
    expect(sibling.rows).toHaveLength(0);
  });

  it('anon sees no sessions and no set logs', async () => {
    const s = await asAnon((c) => c.query('select id from public.workout_sessions'));
    const l = await asAnon((c) => c.query('select id from public.exercise_set_logs'));
    expect(s.rows).toHaveLength(0);
    expect(l.rows).toHaveLength(0);
  });

  // ── owner / coach positive controls ────────────────────────────────────────
  it('a client logs their own session + set, and reads their own history', async () => {
    const sess = await asUser(CLIENT_A1, (c) =>
      c.query(
        `insert into public.workout_sessions (user_id, session_date, status)
           values ($1, current_date - 10, 'completed')`,
        [CLIENT_A1.sub],
      ),
    );
    expect(sess.rowCount).toBe(1);

    const set = await asUser(CLIENT_A1, (c) =>
      c.query(
        `insert into public.exercise_set_logs (session_id, exercise_name, set_index, reps_done, load_grams)
           values ($1, 'Extra Set', 0, 10, 50000)`,
        [SESS_A1],
      ),
    );
    expect(set.rowCount).toBe(1);

    const own = await asUser(CLIENT_A1, (c) => c.query('select id from public.workout_sessions'));
    expect(own.rows.length).toBeGreaterThanOrEqual(3); // 3 seeded
  });

  it('coach A reads their two clients’ sessions but never coach B’s client', async () => {
    const rows = await asUser(COACH_A, (c) =>
      c.query('select user_id from public.workout_sessions'),
    );
    const owners = new Set(rows.rows.map((r) => r.user_id));
    expect(owners.has(CLIENT_A1.sub)).toBe(true);
    expect(owners.has(CLIENT_A2)).toBe(true);
    expect(owners.has(CLIENT_B1)).toBe(false);
  });

  it('the owner + their coach read a session’s set logs; outsiders see none', async () => {
    const owner = await asUser(CLIENT_A1, (c) =>
      c.query('select id from public.exercise_set_logs where session_id = $1', [SESS_A1]),
    );
    const coach = await asUser(COACH_A, (c) =>
      c.query('select id from public.exercise_set_logs where session_id = $1', [SESS_A1]),
    );
    const otherCoach = await asUser(COACH_B, (c) =>
      c.query('select id from public.exercise_set_logs where session_id = $1', [SESS_A1]),
    );
    const otherClient = await asUser(CLIENT_B1_ID, (c) =>
      c.query('select id from public.exercise_set_logs where session_id = $1', [SESS_A1]),
    );
    expect(owner.rows).toHaveLength(3);
    expect(coach.rows).toHaveLength(3); // is_coach_of(owner)
    expect(otherCoach.rows).toHaveLength(0);
    expect(otherClient.rows).toHaveLength(0);
  });

  // ── forgery / mass-assignment rejection ────────────────────────────────────
  it('a client cannot insert a session owned by someone else', async () => {
    await expect(
      asUser(CLIENT_A1, (c) =>
        c.query(
          "insert into public.workout_sessions (user_id, session_date, status) values ($1, current_date, 'completed')",
          [CLIENT_B1],
        ),
      ),
    ).rejects.toThrow();
  });

  it('a client cannot write set logs into another client’s session', async () => {
    await expect(
      asUser(CLIENT_A1, (c) =>
        c.query(
          "insert into public.exercise_set_logs (session_id, exercise_name, set_index) values ($1, 'X', 0)",
          [SESS_B1],
        ),
      ),
    ).rejects.toThrow();
  });

  // ── derived: adherence view ────────────────────────────────────────────────
  it('the adherence view reports sets done vs planned for the owner, and is tenant-scoped', async () => {
    const a1 = await asUser(CLIENT_A1, (c) =>
      c.query('select sets_done, sets_planned from public.v_session_adherence where session_id = $1', [
        SESS_A1,
      ]),
    );
    expect(a1.rows).toHaveLength(1);
    expect(Number(a1.rows[0].sets_done)).toBe(3);
    expect(Number(a1.rows[0].sets_planned)).toBe(7); // day da000001: 4 + 3 sets

    // Another coach's view of A1's session: nothing (base-table RLS via security_invoker).
    const cross = await asUser(COACH_B, (c) =>
      c.query('select session_id from public.v_session_adherence where session_id = $1', [SESS_A1]),
    );
    expect(cross.rows).toHaveLength(0);
  });

  // ── derived: streak ────────────────────────────────────────────────────────
  it('current_streak counts the owner’s consecutive days; a coach sees their client’s, an outsider 0', async () => {
    const own = await asUser(CLIENT_A1, (c) =>
      c.query('select public.current_streak($1) as n', [CLIENT_A1.sub]),
    );
    const coach = await asUser(COACH_A, (c) =>
      c.query('select public.current_streak($1) as n', [CLIENT_A1.sub]),
    );
    const outsider = await asUser(COACH_B, (c) =>
      c.query('select public.current_streak($1) as n', [CLIENT_A1.sub]),
    );
    expect(own.rows[0].n).toBe(3);
    expect(coach.rows[0].n).toBe(3); // is_coach_of(A1)
    expect(outsider.rows[0].n).toBe(0); // can't read A1's sessions
  });

  // ── derived: leaderboard (cross-tenant, must not leak) ─────────────────────
  it('coach_leaderboard returns only the caller’s own clients', async () => {
    const a = await asUser(COACH_A, (c) =>
      c.query('select client_id, sessions_done from public.coach_leaderboard((current_date - 6)::date)'),
    );
    const ids = a.rows.map((r) => r.client_id);
    expect(ids).toContain(CLIENT_A1.sub);
    expect(ids).toContain(CLIENT_A2);
    expect(ids).not.toContain(CLIENT_B1);
    const a1Row = a.rows.find((r) => r.client_id === CLIENT_A1.sub);
    expect(a1Row.sessions_done).toBe(3);

    const b = await asUser(COACH_B, (c) =>
      c.query('select client_id from public.coach_leaderboard((current_date - 6)::date)'),
    );
    const bIds = b.rows.map((r) => r.client_id);
    expect(bIds).toContain(CLIENT_B1);
    expect(bIds).not.toContain(CLIENT_A1.sub);
  });

  it('coach_leaderboard rejects a client caller and anon', async () => {
    await expect(
      asUser(CLIENT_A1, (c) =>
        c.query('select * from public.coach_leaderboard((current_date - 6)::date)'),
      ),
    ).rejects.toThrow(); // not_a_coach
    await expect(
      asAnon((c) => c.query('select * from public.coach_leaderboard((current_date - 6)::date)')),
    ).rejects.toThrow(); // no execute grant
  });
});

describe('profiles & goals (0017) — athlete_profile + coach_profile (§2)', () => {
  const COACH_B: Identity = { sub: COACH_B_ID, userRole: 'coach' };
  const CLIENT_A2_ID: Identity = { sub: CLIENT_A2, userRole: 'client' };
  const CLIENT_B1_ID: Identity = { sub: CLIENT_B1, userRole: 'client' };
  const COACH_A_ID = '11111111-1111-1111-1111-111111111111';

  // ── athlete_profile: client-owned, coach-readable ──────────────────────────
  it('the owner + their coach read an athlete_profile; outsiders see nothing', async () => {
    const owner = await asUser(CLIENT_A1, (c) =>
      c.query('select user_id from public.athlete_profile where user_id = $1', [CLIENT_A1.sub]),
    );
    const coach = await asUser(COACH_A, (c) =>
      c.query('select user_id from public.athlete_profile where user_id = $1', [CLIENT_A1.sub]),
    );
    const otherCoach = await asUser(COACH_B, (c) =>
      c.query('select user_id from public.athlete_profile where user_id = $1', [CLIENT_A1.sub]),
    );
    const sibling = await asUser(CLIENT_A2_ID, (c) =>
      c.query('select user_id from public.athlete_profile where user_id = $1', [CLIENT_A1.sub]),
    );
    expect(owner.rows).toHaveLength(1);
    expect(coach.rows).toHaveLength(1); // is_coach_of(A1)
    expect(otherCoach.rows).toHaveLength(0);
    expect(sibling.rows).toHaveLength(0);
  });

  it('anon sees no athlete or coach profiles', async () => {
    const a = await asAnon((c) => c.query('select user_id from public.athlete_profile'));
    const co = await asAnon((c) => c.query('select user_id from public.coach_profile'));
    expect(a.rows).toHaveLength(0);
    expect(co.rows).toHaveLength(0);
  });

  it('a client upserts their OWN athlete_profile but cannot forge another owner', async () => {
    const ok = await asUser(CLIENT_A2_ID, (c) =>
      c.query("insert into public.athlete_profile (user_id, primary_goal) values ($1, 'lose_fat')", [CLIENT_A2]),
    );
    expect(ok.rowCount).toBe(1);
    await expect(
      asUser(CLIENT_A2_ID, (c) =>
        c.query("insert into public.athlete_profile (user_id, primary_goal) values ($1, 'lose_fat')", [CLIENT_B1]),
      ),
    ).rejects.toThrow();
  });

  it('a coach cannot write an athlete_profile for their client (self-report only)', async () => {
    await expect(
      asUser(COACH_A, (c) =>
        c.query("insert into public.athlete_profile (user_id, primary_goal) values ($1, 'maintain')", [CLIENT_A1.sub]),
      ),
    ).rejects.toThrow();
  });

  // ── coach_profile: coach-owned, readable by their clients ──────────────────
  it('a client reads THEIR coach’s profile but not another coach’s', async () => {
    const ownCoach = await asUser(CLIENT_A1, (c) =>
      c.query('select user_id from public.coach_profile where user_id = $1', [COACH_A_ID]),
    );
    const otherCoach = await asUser(CLIENT_B1_ID, (c) =>
      c.query('select user_id from public.coach_profile where user_id = $1', [COACH_A_ID]),
    );
    expect(ownCoach.rows).toHaveLength(1); // my_coach_id() = Coach A
    expect(otherCoach.rows).toHaveLength(0); // B1's coach is Coach B
  });

  it('a coach upserts their own coach_profile but cannot forge another coach’s', async () => {
    const ok = await asUser(COACH_B, (c) =>
      c.query("insert into public.coach_profile (user_id, bio) values ($1, 'hi')", [COACH_B_ID]),
    );
    expect(ok.rowCount).toBe(1);
    await expect(
      asUser(COACH_B, (c) =>
        c.query("insert into public.coach_profile (user_id, bio) values ($1, 'forged')", [COACH_A_ID]),
      ),
    ).rejects.toThrow();
  });
});

describe('food logging (0019) — diary, targets, daily roll-up, streak (§2)', () => {
  const COACH_B: Identity = { sub: COACH_B_ID, userRole: 'coach' };
  const CLIENT_A2_ID: Identity = { sub: CLIENT_A2, userRole: 'client' };
  const CLIENT_B1_ID: Identity = { sub: CLIENT_B1, userRole: 'client' };
  const ENTRY_A1 = 'f10d0001-0000-0000-0000-000000000001'; // A1, today, Chicken 200g

  // ── cross-tenant denial ────────────────────────────────────────────────────
  it('a coach cannot read another coach’s client diary; a client cannot read a sibling’s', async () => {
    const coach = await asUser(COACH_B, (c) =>
      c.query('select id from public.food_log_entries where user_id = $1', [CLIENT_A1.sub]),
    );
    const sibling = await asUser(CLIENT_A2_ID, (c) =>
      c.query('select id from public.food_log_entries where user_id = $1', [CLIENT_A1.sub]),
    );
    expect(coach.rows).toHaveLength(0);
    expect(sibling.rows).toHaveLength(0);
  });

  it('anon sees no diary entries, targets, or daily roll-ups', async () => {
    const e = await asAnon((c) => c.query('select id from public.food_log_entries'));
    const t = await asAnon((c) => c.query('select user_id from public.nutrition_targets'));
    const v = await asAnon((c) => c.query('select user_id from public.v_daily_nutrition'));
    expect(e.rows).toHaveLength(0);
    expect(t.rows).toHaveLength(0);
    expect(v.rows).toHaveLength(0);
  });

  // ── owner / coach positive controls ────────────────────────────────────────
  it('a client logs + reads their own diary; their coach reads it but a stranger cannot', async () => {
    const own = await asUser(CLIENT_A1, (c) =>
      c.query('select id from public.food_log_entries where user_id = $1', [CLIENT_A1.sub]),
    );
    expect(own.rows.length).toBeGreaterThanOrEqual(2); // 2 seeded today (+1 yesterday)

    const coach = await asUser(COACH_A, (c) =>
      c.query('select id from public.food_log_entries where user_id = $1', [CLIENT_A1.sub]),
    );
    expect(coach.rows.length).toBeGreaterThanOrEqual(2); // is_coach_of(A1)

    const stranger = await asUser(CLIENT_B1_ID, (c) =>
      c.query('select id from public.food_log_entries where user_id = $1', [CLIENT_A1.sub]),
    );
    expect(stranger.rows).toHaveLength(0);
  });

  // ── 0055 (Slice G4): the serving-snapshot columns are writable by the owner ──
  it('an athlete can log a food carrying a serving snapshot (0055 columns)', async () => {
    const r = await asUser(CLIENT_A1, (c) =>
      c.query(
        `insert into public.food_log_entries
           (user_id, log_date, meal_slot, food_name, kcal_per_100g, protein_g_per_100g, carbs_g_per_100g, fat_g_per_100g, grams, serving_label, serving_grams)
         values ($1, current_date, 'snack', 'Protein Bar', 350, 30, 40, 10, 60, '1 bar', 60)
         returning serving_label, serving_grams`,
        [CLIENT_A1.sub],
      ),
    );
    expect(r.rows[0].serving_label).toBe('1 bar');
    expect(Number(r.rows[0].serving_grams)).toBe(60);
  });

  it('a client adds an off-plan entry (null plan_meal_item_id) owned by themselves', async () => {
    const r = await asUser(CLIENT_A1, (c) =>
      c.query(
        `insert into public.food_log_entries (user_id, meal_slot, food_name, grams)
           values ($1, 'snack', 'Protein Shake', 300) returning user_id, plan_meal_item_id`,
        [CLIENT_A1.sub],
      ),
    );
    expect(r.rows[0].user_id).toBe(CLIENT_A1.sub);
    expect(r.rows[0].plan_meal_item_id).toBeNull(); // off-plan extra
  });

  // ── forgery / mass-assignment: the trigger forces the owner ────────────────
  it('the server forces user_id = auth.uid() (a forged owner is overwritten, not honoured)', async () => {
    const r = await asUser(CLIENT_A1, (c) =>
      c.query(
        `insert into public.food_log_entries (user_id, meal_slot, food_name, grams)
           values ($1, 'lunch', 'Forged', 100) returning user_id`,
        [CLIENT_B1], // attempt to log into B1's diary
      ),
    );
    expect(r.rows[0].user_id).toBe(CLIENT_A1.sub); // coerced back to the caller
  });

  it('a coach cannot edit or delete a client’s diary entry (read-only for coaches)', async () => {
    const upd = await asUser(COACH_A, (c) =>
      c.query("update public.food_log_entries set note = 'coach edit' where id = $1", [ENTRY_A1]),
    );
    const del = await asUser(COACH_A, (c) =>
      c.query('delete from public.food_log_entries where id = $1', [ENTRY_A1]),
    );
    expect(upd.rowCount).toBe(0); // RLS: not the owner
    expect(del.rowCount).toBe(0);
  });

  // ── targets: client-owned, coach-overridable ───────────────────────────────
  it('the owner + their coach read a target; another coach cannot', async () => {
    const own = await asUser(CLIENT_A1, (c) =>
      c.query('select kcal_target from public.nutrition_targets where user_id = $1', [CLIENT_A1.sub]),
    );
    const coach = await asUser(COACH_A, (c) =>
      c.query('select kcal_target from public.nutrition_targets where user_id = $1', [CLIENT_A1.sub]),
    );
    const otherCoach = await asUser(COACH_B, (c) =>
      c.query('select kcal_target from public.nutrition_targets where user_id = $1', [CLIENT_A1.sub]),
    );
    expect(own.rows).toHaveLength(1);
    expect(coach.rows).toHaveLength(1); // is_coach_of(A1)
    expect(otherCoach.rows).toHaveLength(0);
  });

  it('a coach may override their client’s target (set_by forced); another coach may not', async () => {
    const coachA = await asUser(COACH_A, (c) =>
      c.query(
        'update public.nutrition_targets set kcal_target = 2500 where user_id = $1 returning set_by',
        [CLIENT_A1.sub],
      ),
    );
    expect(coachA.rowCount).toBe(1);
    expect(coachA.rows[0].set_by).toBe(COACH_A.sub); // server-forced writer

    const coachB = await asUser(COACH_B, (c) =>
      c.query('update public.nutrition_targets set kcal_target = 9999 where user_id = $1', [
        CLIENT_A1.sub,
      ]),
    );
    expect(coachB.rowCount).toBe(0); // not A1's coach
  });

  it('a client upserts their OWN target but cannot create one for someone else', async () => {
    const ok = await asUser(CLIENT_A2_ID, (c) =>
      c.query(
        `insert into public.nutrition_targets (user_id, kcal_target, protein_g_target, carbs_g_target, fat_g_target, source)
           values ($1, 2000, 150, 200, 60, 'self_set')`,
        [CLIENT_A2],
      ),
    );
    expect(ok.rowCount).toBe(1);
    await expect(
      asUser(CLIENT_A2_ID, (c) =>
        c.query(
          `insert into public.nutrition_targets (user_id, kcal_target, protein_g_target, carbs_g_target, fat_g_target, source)
             values ($1, 2000, 150, 200, 60, 'self_set')`,
          [CLIENT_B1],
        ),
      ),
    ).rejects.toThrow();
  });

  // ── derived: daily roll-up view + streak ───────────────────────────────────
  it('v_daily_nutrition rolls up the owner’s day and is tenant-scoped', async () => {
    const a1 = await asUser(CLIENT_A1, (c) =>
      c.query(
        'select kcal_total, entry_count from public.v_daily_nutrition where user_id = $1 and log_date = current_date',
        [CLIENT_A1.sub],
      ),
    );
    expect(a1.rows).toHaveLength(1);
    expect(Number(a1.rows[0].kcal_total)).toBeGreaterThan(0);
    expect(Number(a1.rows[0].entry_count)).toBeGreaterThanOrEqual(2);

    const cross = await asUser(COACH_B, (c) =>
      c.query('select log_date from public.v_daily_nutrition where user_id = $1', [CLIENT_A1.sub]),
    );
    expect(cross.rows).toHaveLength(0); // security_invoker → base-table RLS
  });

  it('nutrition_streak counts the owner’s consecutive logged days; a coach sees it, an outsider 0', async () => {
    const own = await asUser(CLIENT_A1, (c) =>
      c.query('select public.nutrition_streak($1) as n', [CLIENT_A1.sub]),
    );
    const coach = await asUser(COACH_A, (c) =>
      c.query('select public.nutrition_streak($1) as n', [CLIENT_A1.sub]),
    );
    const outsider = await asUser(COACH_B, (c) =>
      c.query('select public.nutrition_streak($1) as n', [CLIENT_A1.sub]),
    );
    expect(own.rows[0].n).toBe(2); // today + yesterday
    expect(coach.rows[0].n).toBe(2); // is_coach_of(A1)
    expect(outsider.rows[0].n).toBe(0); // can't read A1's entries
  });
});

describe('food preferences (0020) — athlete-owned likes/avoids, coach-readable (§2)', () => {
  const COACH_B: Identity = { sub: COACH_B_ID, userRole: 'coach' };
  const CLIENT_A2_ID: Identity = { sub: CLIENT_A2, userRole: 'client' };
  const BANANA = 'f0000000-0000-0000-0000-00000000000d';
  const ALMONDS = 'f0000000-0000-0000-0000-000000000010';
  const APPLE = 'f0000000-0000-0000-0000-00000000000e';

  it('the global food library is categorised (0020 backfill)', async () => {
    const r = await asUser(CLIENT_A1, (c) =>
      c.query('select count(*)::int as n from public.food_library where coach_id is null and category is null'),
    );
    expect(r.rows[0].n).toBe(0); // every global food has a category
  });

  it('the owner + their coach read a preference; another coach and a sibling cannot', async () => {
    const owner = await asUser(CLIENT_A1, (c) =>
      c.query('select food_id, kind from public.food_preferences where user_id = $1', [CLIENT_A1.sub]),
    );
    const coach = await asUser(COACH_A, (c) =>
      c.query('select food_id from public.food_preferences where user_id = $1', [CLIENT_A1.sub]),
    );
    const otherCoach = await asUser(COACH_B, (c) =>
      c.query('select food_id from public.food_preferences where user_id = $1', [CLIENT_A1.sub]),
    );
    const sibling = await asUser(CLIENT_A2_ID, (c) =>
      c.query('select food_id from public.food_preferences where user_id = $1', [CLIENT_A1.sub]),
    );
    expect(owner.rows.length).toBe(2); // ♥ Banana, ⊘ Almonds
    expect(coach.rows.length).toBe(2); // is_coach_of(A1)
    expect(otherCoach.rows).toHaveLength(0);
    expect(sibling.rows).toHaveLength(0);
  });

  it('a coach’s cohort read returns only their own clients’ preferences', async () => {
    const a = await asUser(COACH_A, (c) => c.query('select user_id from public.food_preferences'));
    const owners = new Set(a.rows.map((r) => r.user_id));
    expect(owners.has(CLIENT_A1.sub)).toBe(true);
    expect(owners.has(CLIENT_B1)).toBe(false); // Coach B's client
  });

  it('anon sees no preferences', async () => {
    const r = await asAnon((c) => c.query('select user_id from public.food_preferences'));
    expect(r.rows).toHaveLength(0);
  });

  it('an athlete sets their own preference; a forged owner is coerced back to the caller', async () => {
    const ok = await asUser(CLIENT_A2_ID, (c) =>
      c.query(
        "insert into public.food_preferences (user_id, food_id, kind) values ($1, $2, 'like') returning user_id",
        [CLIENT_A2, APPLE],
      ),
    );
    expect(ok.rows[0].user_id).toBe(CLIENT_A2);

    const forged = await asUser(CLIENT_A2_ID, (c) =>
      c.query(
        "insert into public.food_preferences (user_id, food_id, kind) values ($1, $2, 'like') returning user_id",
        [CLIENT_B1, BANANA],
      ),
    );
    expect(forged.rows[0].user_id).toBe(CLIENT_A2); // not B1
  });

  it('a coach cannot write preferences (read-only): insert rejected, delete affects nothing', async () => {
    // Trigger forces user_id=coach; the role='client' check then rejects the coach.
    await expect(
      asUser(COACH_A, (c) =>
        c.query("insert into public.food_preferences (user_id, food_id, kind) values ($1, $2, 'like')", [
          CLIENT_A1.sub,
          APPLE,
        ]),
      ),
    ).rejects.toThrow();
    const del = await asUser(COACH_A, (c) =>
      c.query('delete from public.food_preferences where user_id = $1 and food_id = $2', [CLIENT_A1.sub, ALMONDS]),
    );
    expect(del.rowCount).toBe(0); // not the owner
    // A1's data is untouched.
    const a1 = await asUser(CLIENT_A1, (c) =>
      c.query('select food_id from public.food_preferences where user_id = $1', [CLIENT_A1.sub]),
    );
    expect(a1.rows.length).toBe(2);
  });
});

describe('workout logging (0021) — exercise PRs + athlete→coach feedback notes (§2)', () => {
  const COACH_B: Identity = { sub: COACH_B_ID, userRole: 'coach' };
  const CLIENT_A2_ID: Identity = { sub: CLIENT_A2, userRole: 'client' };
  const A1_SESSION = '5e550001-0000-0000-0000-000000000001';
  const A2_SESSION = '5e550004-0000-0000-0000-000000000004';

  it('the owner + their coach read a note; another coach and a sibling cannot', async () => {
    const owner = await asUser(CLIENT_A1, (c) =>
      c.query('select id from public.workout_notes where user_id = $1', [CLIENT_A1.sub]),
    );
    const coach = await asUser(COACH_A, (c) =>
      c.query('select id from public.workout_notes where user_id = $1', [CLIENT_A1.sub]),
    );
    const otherCoach = await asUser(COACH_B, (c) =>
      c.query('select id from public.workout_notes where user_id = $1', [CLIENT_A1.sub]),
    );
    const sibling = await asUser(CLIENT_A2_ID, (c) =>
      c.query('select id from public.workout_notes where user_id = $1', [CLIENT_A1.sub]),
    );
    expect(owner.rows.length).toBe(2); // one Challenge, one Compliment
    expect(coach.rows.length).toBe(2); // is_coach_of(A1)
    expect(otherCoach.rows).toHaveLength(0);
    expect(sibling.rows).toHaveLength(0);
  });

  it('a coach’s cohort read returns only their own clients’ notes', async () => {
    const a = await asUser(COACH_A, (c) => c.query('select user_id from public.workout_notes'));
    const owners = new Set(a.rows.map((r) => r.user_id));
    expect(owners.has(CLIENT_A1.sub)).toBe(true);
    expect(owners.has(CLIENT_B1)).toBe(false); // Coach B's client
  });

  it('anon sees no notes', async () => {
    const r = await asAnon((c) => c.query('select id from public.workout_notes'));
    expect(r.rows).toHaveLength(0);
  });

  it('an athlete writes their own note; a forged owner is coerced back to the caller', async () => {
    const ok = await asUser(CLIENT_A2_ID, (c) =>
      c.query(
        "insert into public.workout_notes (user_id, session_id, category, body) values ($1, $2, 'challenge', 'felt great') returning user_id",
        [CLIENT_A2, A2_SESSION],
      ),
    );
    expect(ok.rows[0].user_id).toBe(CLIENT_A2);

    const forged = await asUser(CLIENT_A2_ID, (c) =>
      c.query(
        "insert into public.workout_notes (user_id, session_id, category, body) values ($1, $2, 'compliment', 'forged') returning user_id",
        [CLIENT_B1, A2_SESSION],
      ),
    );
    expect(forged.rows[0].user_id).toBe(CLIENT_A2); // not B1
  });

  it('a coach cannot author notes (read-only): insert rejected', async () => {
    // Trigger forces user_id=coach; the role='client' with-check then rejects them.
    await expect(
      asUser(COACH_A, (c) =>
        c.query(
          "insert into public.workout_notes (user_id, session_id, category, body) values ($1, $2, 'challenge', 'coach note')",
          [CLIENT_A1.sub, A1_SESSION],
        ),
      ),
    ).rejects.toThrow();
  });

  it('v_exercise_prs gives an athlete their own bests; their coach can read them, others cannot', async () => {
    const own = await asUser(CLIENT_A1, (c) =>
      c.query(
        'select exercise_name, best_load_grams, best_e1rm_grams, best_reps from public.v_exercise_prs where user_id = $1',
        [CLIENT_A1.sub],
      ),
    );
    const best = new Map(own.rows.map((r) => [r.exercise_name, Number(r.best_load_grams)]));
    expect(best.get('Barbell Bench Press')).toBe(60000); // integer grams, never float
    expect(best.get('Triceps Pushdown')).toBe(20000);
    // e1RM (0023): Bench 60000×(30+8)/30 = 76000; best reps tracks the rep PR.
    const e1rm = new Map(own.rows.map((r) => [r.exercise_name, Number(r.best_e1rm_grams)]));
    const reps = new Map(own.rows.map((r) => [r.exercise_name, Number(r.best_reps)]));
    expect(e1rm.get('Barbell Bench Press')).toBe(76000);
    expect(reps.get('Barbell Bench Press')).toBe(8);
    expect(reps.get('Triceps Pushdown')).toBe(12);

    const coach = await asUser(COACH_A, (c) =>
      c.query('select exercise_name from public.v_exercise_prs where user_id = $1', [CLIENT_A1.sub]),
    );
    expect(coach.rows.length).toBe(2);

    const otherCoach = await asUser(COACH_B, (c) =>
      c.query('select exercise_name from public.v_exercise_prs where user_id = $1', [CLIENT_A1.sub]),
    );
    expect(otherCoach.rows).toHaveLength(0);

    const anon = await asAnon((c) => c.query('select user_id from public.v_exercise_prs'));
    expect(anon.rows).toHaveLength(0);
  });
});

describe('workout note delete keeps the chat copy (0056) — FK SET NULL is not an edit', () => {
  const A1_SESSION = '5e550001-0000-0000-0000-000000000001';

  // One transaction: the harness rolls back each asUser() call (helpers.ts), and the
  // mirror message + the delete cascade must all be visible within the same write.
  it('deleting a note unlinks its mirrored chat message but preserves it (no edit_window, no edited_at)', async () => {
    await asUser(CLIENT_A1, async (c) => {
      // 1. Author a note → the 0051 trigger mirrors it into the client↔coach chat.
      const note = await c.query(
        "insert into public.workout_notes (user_id, session_id, category, body) values ($1, $2, 'challenge', 'delete-me note') returning id",
        [CLIENT_A1.sub, A1_SESSION],
      );
      const noteId = note.rows[0].id;

      // The mirror message exists, linked to the note and not yet edited.
      const mirror = await c.query('select id, edited_at from public.messages where workout_note_id = $1', [noteId]);
      expect(mirror.rows).toHaveLength(1);
      const msgId = mirror.rows[0].id;
      expect(mirror.rows[0].edited_at).toBeNull();

      // 2. Delete the note — the FK ON DELETE SET NULL cascade must NOT raise (edit_window)
      //    nor stamp edited_at. Before 0056 this threw / marked the message edited.
      await c.query('delete from public.workout_notes where id = $1', [noteId]);

      // 3. The note is gone; the chat copy survives, unlinked and unedited.
      const after = await c.query('select workout_note_id, edited_at from public.messages where id = $1', [msgId]);
      expect(after.rows).toHaveLength(1);
      expect(after.rows[0].workout_note_id).toBeNull();
      expect(after.rows[0].edited_at).toBeNull();
    });
  });
});

describe('workout note: hide vs delete-for-everyone (0060)', () => {
  const A1_SESSION = '5e550001-0000-0000-0000-000000000001';

  // One transaction (the harness rolls back each asUser() call): the mirror message
  // is created by the note-insert trigger, so author + act + assert must share a txn.
  it('"hide from my log" sets hidden_at but keeps the mirrored chat message linked', async () => {
    await asUser(CLIENT_A1, async (c) => {
      const note = await c.query(
        "insert into public.workout_notes (user_id, session_id, category, body) values ($1, $2, 'challenge', 'hide-me note') returning id",
        [CLIENT_A1.sub, A1_SESSION],
      );
      const noteId = note.rows[0].id;
      expect(
        (await c.query('select id from public.messages where workout_note_id = $1', [noteId])).rows,
      ).toHaveLength(1);

      // Hide is a plain owner UPDATE (workout_notes owner UPDATE policy).
      await c.query('update public.workout_notes set hidden_at = now() where id = $1', [noteId]);

      const note2 = await c.query('select hidden_at from public.workout_notes where id = $1', [noteId]);
      expect(note2.rows[0].hidden_at).not.toBeNull();
      // The chat copy is untouched and still a note card (workout_note_id intact).
      expect(
        (await c.query('select id from public.messages where workout_note_id = $1', [noteId])).rows,
      ).toHaveLength(1);
    });
  });

  it('delete_workout_note_everywhere removes the note AND retracts its mirrored chat message', async () => {
    await asUser(CLIENT_A1, async (c) => {
      const note = await c.query(
        "insert into public.workout_notes (user_id, session_id, category, body) values ($1, $2, 'challenge', 'nuke-me note') returning id",
        [CLIENT_A1.sub, A1_SESSION],
      );
      const noteId = note.rows[0].id;
      const mirror = await c.query('select id from public.messages where workout_note_id = $1', [noteId]);
      expect(mirror.rows).toHaveLength(1);
      const msgId = mirror.rows[0].id;

      await c.query('select public.delete_workout_note_everywhere($1)', [noteId]);

      expect((await c.query('select id from public.workout_notes where id = $1', [noteId])).rows).toHaveLength(0);
      expect((await c.query('select id from public.messages where id = $1', [msgId])).rows).toHaveLength(0);
    });
  });
});

describe('nutrition system templates (0022) — clonable global starters (§2)', () => {
  it('a coach sees the seeded nutrition system templates, each with meals + items', async () => {
    const tpls = await asUser(COACH_A, (c) =>
      c.query(
        "select id from public.plans where coach_id is null and client_id is null and type = 'nutrition' and status = 'published'",
      ),
    );
    expect(tpls.rows.length).toBeGreaterThanOrEqual(3); // Lean Cut, Lean Bulk, Maintenance

    const items = await asUser(COACH_A, (c) =>
      c.query(
        `select count(*)::int as n
           from public.plan_meal_items mi
           join public.plan_meals m on m.id = mi.meal_id
           join public.plans p on p.id = m.plan_id
          where p.coach_id is null and p.type = 'nutrition'`,
      ),
    );
    expect(items.rows[0].n).toBeGreaterThan(0); // macros snapshotted from food_library
  });

  it('a client cannot see system templates (they are not assigned plans)', async () => {
    const r = await asUser(CLIENT_A1, (c) =>
      c.query('select id from public.plans where coach_id is null and client_id is null'),
    );
    expect(r.rows).toHaveLength(0);
  });
});

describe('one published plan per type (0024) — publishing supersedes the previous', () => {
  const A1_TRAINING_PUB = '99990001-0000-0000-0000-000000000001';
  const A1_NUTRITION_DRAFT = '99990002-0000-0000-0000-000000000002';
  const A1_NUTRITION_PUB = '99990004-0000-0000-0000-000000000004';

  it('publishing a second nutrition plan archives the previously published one (same type only)', async () => {
    // Whole flow in one tx (rolled back by the helper) so seed isn't mutated.
    const rows = await asUser(COACH_A, async (c) => {
      await c.query("update public.plans set status = 'published' where id = $1", [A1_NUTRITION_DRAFT]);
      return c.query('select id, status from public.plans where id = any($1)', [
        [A1_NUTRITION_DRAFT, A1_NUTRITION_PUB, A1_TRAINING_PUB],
      ]);
    });
    const status = new Map(rows.rows.map((r) => [r.id, r.status]));
    expect(status.get(A1_NUTRITION_DRAFT)).toBe('published'); // newly published
    expect(status.get(A1_NUTRITION_PUB)).toBe('archived'); // superseded by the new one
    expect(status.get(A1_TRAINING_PUB)).toBe('published'); // different type — untouched
  });
});

describe('exercise unit prefs (0025) — per-exercise kg/lb, athlete-owned', () => {
  const COACH_B: Identity = { sub: COACH_B_ID, userRole: 'coach' };
  const CLIENT_A2_ID: Identity = { sub: CLIENT_A2, userRole: 'client' };

  it('the owner + their coach read a unit pref; another coach and anon cannot', async () => {
    const owner = await asUser(CLIENT_A1, (c) =>
      c.query('select exercise_name, unit from public.exercise_unit_prefs where user_id = $1', [CLIENT_A1.sub]),
    );
    const coach = await asUser(COACH_A, (c) =>
      c.query('select unit from public.exercise_unit_prefs where user_id = $1', [CLIENT_A1.sub]),
    );
    const otherCoach = await asUser(COACH_B, (c) =>
      c.query('select unit from public.exercise_unit_prefs where user_id = $1', [CLIENT_A1.sub]),
    );
    const anon = await asAnon((c) => c.query('select unit from public.exercise_unit_prefs'));
    expect(owner.rows[0]?.unit).toBe('lb');
    expect(coach.rows).toHaveLength(1);
    expect(otherCoach.rows).toHaveLength(0);
    expect(anon.rows).toHaveLength(0);
  });

  it('an athlete sets their own pref; a forged owner is coerced back to the caller', async () => {
    const ok = await asUser(CLIENT_A2_ID, (c) =>
      c.query(
        "insert into public.exercise_unit_prefs (user_id, exercise_name, unit) values ($1, 'Deadlift', 'kg') returning user_id",
        [CLIENT_A2],
      ),
    );
    expect(ok.rows[0].user_id).toBe(CLIENT_A2);

    const forged = await asUser(CLIENT_A2_ID, (c) =>
      c.query(
        "insert into public.exercise_unit_prefs (user_id, exercise_name, unit) values ($1, 'Squat', 'lb') returning user_id",
        [CLIENT_B1],
      ),
    );
    expect(forged.rows[0].user_id).toBe(CLIENT_A2); // not B1
  });

  it('a coach cannot write a client’s unit pref (read-only): insert rejected', async () => {
    await expect(
      asUser(COACH_A, (c) =>
        c.query("insert into public.exercise_unit_prefs (user_id, exercise_name, unit) values ($1, 'Bench', 'kg')", [
          CLIENT_A1.sub,
        ]),
      ),
    ).rejects.toThrow();
  });
});

describe('body metrics (0026) — coach-verified, athletes never self-write (§2/§4)', () => {
  const COACH_B: Identity = { sub: COACH_B_ID, userRole: 'coach' };

  it('the athlete + their coach read metrics; another coach and anon cannot', async () => {
    const owner = await asUser(CLIENT_A1, (c) =>
      c.query('select id from public.body_metrics where user_id = $1', [CLIENT_A1.sub]),
    );
    const coach = await asUser(COACH_A, (c) =>
      c.query('select id from public.body_metrics where user_id = $1', [CLIENT_A1.sub]),
    );
    const otherCoach = await asUser(COACH_B, (c) =>
      c.query('select id from public.body_metrics where user_id = $1', [CLIENT_A1.sub]),
    );
    const anon = await asAnon((c) => c.query('select id from public.body_metrics'));
    expect(owner.rows).toHaveLength(2);
    expect(coach.rows).toHaveLength(2);
    expect(otherCoach.rows).toHaveLength(0); // cross-tenant denial
    expect(anon.rows).toHaveLength(0);
  });

  it('an athlete CANNOT self-write a metric (anti-cheat): insert rejected', async () => {
    await expect(
      asUser(CLIENT_A1, (c) =>
        c.query(
          "insert into public.body_metrics (user_id, weight_grams, source) values ($1, 88000, 'coach_entered')",
          [CLIENT_A1.sub],
        ),
      ),
    ).rejects.toThrow();
  });

  it('a coach writes a verified metric for their client; verifier is server-stamped to the caller', async () => {
    // measured_at pinned mid-range so it changes neither the baseline (60d) nor the
    // latest (5d) the board test below asserts on.
    const r = await asUser(COACH_A, (c) =>
      c.query(
        "insert into public.body_metrics (user_id, measured_at, weight_grams, body_fat_bp, source) values ($1, now() - interval '50 days', 89000, 2200, 'coach_entered') returning verified_by, verified_at",
        [CLIENT_A1.sub],
      ),
    );
    expect(r.rows[0].verified_by).toBe(COACH_A.sub); // forced from auth.uid()
    expect(r.rows[0].verified_at).not.toBeNull();
  });

  it('verification cannot be forged on a non-coach_entered source: verified_* nulled', async () => {
    // A coach tries to insert a 'self_reported' row pre-stamped as verified by
    // someone else — the trigger forces it UNVERIFIED (so ranks ignore it).
    const r = await asUser(COACH_A, (c) =>
      c.query(
        "insert into public.body_metrics (user_id, weight_grams, source, verified_at, verified_by) values ($1, 88000, 'self_reported', now(), $2) returning verified_at, verified_by",
        [CLIENT_A1.sub, COACH_B_ID],
      ),
    );
    expect(r.rows[0].verified_at).toBeNull();
    expect(r.rows[0].verified_by).toBeNull();
  });

  it('a coach cannot write a metric for a client they do not coach: insert rejected', async () => {
    await expect(
      asUser(COACH_A, (c) =>
        c.query("insert into public.body_metrics (user_id, weight_grams, source) values ($1, 70000, 'coach_entered')", [
          CLIENT_B1, // Coach B's client
        ]),
      ),
    ).rejects.toThrow();
  });

  it('coach_body_metrics_board returns only the caller’s own clients', async () => {
    const a = await asUser(COACH_A, (c) =>
      c.query('select client_id, entries, baseline_weight_grams, latest_weight_grams from public.coach_body_metrics_board()'),
    );
    const ids = a.rows.map((r) => r.client_id);
    expect(ids).toContain(CLIENT_A1.sub);
    expect(ids).not.toContain(CLIENT_B1); // never another coach's client
    const a1 = a.rows.find((r) => r.client_id === CLIENT_A1.sub);
    expect(a1.baseline_weight_grams).toBe(92500); // earliest verified
    expect(a1.latest_weight_grams).toBe(90000); // most-recent verified

    const b = await asUser(COACH_B, (c) => c.query('select client_id from public.coach_body_metrics_board()'));
    expect(b.rows.map((r) => r.client_id)).toContain(CLIENT_B1);
    expect(b.rows.map((r) => r.client_id)).not.toContain(CLIENT_A1.sub);
  });

  it('coach_body_metrics_board rejects a client caller and anon', async () => {
    await expect(
      asUser(CLIENT_A1, (c) => c.query('select * from public.coach_body_metrics_board()')),
    ).rejects.toThrow();
    await expect(asAnon((c) => c.query('select * from public.coach_body_metrics_board()'))).rejects.toThrow();
  });
});

describe('ai usage ledger (0027) — owner-only read, service-role-only write (§9)', () => {
  const COACH_B: Identity = { sub: COACH_B_ID, userRole: 'coach' };

  it('the owner reads their own AI usage; their coach, another coach, and anon cannot', async () => {
    const owner = await asUser(CLIENT_A1, (c) =>
      c.query('select id from public.ai_usage_events where user_id = $1', [CLIENT_A1.sub]),
    );
    const coach = await asUser(COACH_A, (c) =>
      c.query('select id from public.ai_usage_events where user_id = $1', [CLIENT_A1.sub]),
    );
    const otherCoach = await asUser(COACH_B, (c) =>
      c.query('select id from public.ai_usage_events where user_id = $1', [CLIENT_A1.sub]),
    );
    const anon = await asAnon((c) => c.query('select id from public.ai_usage_events'));
    expect(owner.rows).toHaveLength(1);
    expect(coach.rows).toHaveLength(0); // a coach cannot read a client's AI counters
    expect(otherCoach.rows).toHaveLength(0);
    expect(anon.rows).toHaveLength(0);
  });

  it('a client CANNOT write the ledger (service-role only): insert rejected', async () => {
    await expect(
      asUser(CLIENT_A1, (c) =>
        c.query("insert into public.ai_usage_events (user_id, kind) values ($1, 'inbody_ocr')", [CLIENT_A1.sub]),
      ),
    ).rejects.toThrow();
  });
});

describe('InBody OCR confirm (0026 + 12b) — coach confirms, athlete cannot self-verify', () => {
  const OCR_ROW = 'b0d70004-0000-0000-0000-000000000004';
  const CLIENT_A2_IDENT: Identity = { sub: CLIENT_A2, userRole: 'client' };

  it('the staged inbody_ocr reading is UNVERIFIED (trigger forces verified_*=null)', async () => {
    const r = await asUser(COACH_A, (c) =>
      c.query('select source, verified_at, verified_by from public.body_metrics where id = $1', [OCR_ROW]),
    );
    expect(r.rows[0].source).toBe('inbody_ocr');
    expect(r.rows[0].verified_at).toBeNull();
    expect(r.rows[0].verified_by).toBeNull();
  });

  it('the athlete CANNOT confirm their own OCR row (anti-cheat): RLS hides it from their UPDATE', async () => {
    const r = await asUser(CLIENT_A2_IDENT, (c) =>
      c.query("update public.body_metrics set source = 'coach_entered' where id = $1 returning id", [OCR_ROW]),
    );
    expect(r.rows).toHaveLength(0); // USING (is_coach_of) is false for the owner → 0 rows updated
    const after = await asUser(COACH_A, (c) =>
      c.query('select verified_at from public.body_metrics where id = $1', [OCR_ROW]),
    );
    expect(after.rows[0].verified_at).toBeNull(); // still unverified
  });

  it('the client’s coach confirms it: source→coach_entered server-stamps the verifier', async () => {
    const r = await asUser(COACH_A, (c) =>
      c.query(
        "update public.body_metrics set source = 'coach_entered' where id = $1 returning verified_by, verified_at",
        [OCR_ROW],
      ),
    );
    expect(r.rows[0].verified_by).toBe(COACH_A.sub); // forced from auth.uid()
    expect(r.rows[0].verified_at).not.toBeNull();
  });
});

describe('InBody insights + comments (0028) — coach-only analysis, coach→client comments', () => {
  const COACH_B: Identity = { sub: COACH_B_ID, userRole: 'coach' };
  const CLIENT_A2_IDENT: Identity = { sub: CLIENT_A2, userRole: 'client' };
  const METRIC = 'b0d70004-0000-0000-0000-000000000004';

  it('AI insight is COACH-ONLY: the coach reads it; the athlete (owner), another coach, and anon cannot', async () => {
    const coach = await asUser(COACH_A, (c) =>
      c.query('select metric_id from public.body_metric_insights where metric_id = $1', [METRIC]),
    );
    const owner = await asUser(CLIENT_A2_IDENT, (c) =>
      c.query('select metric_id from public.body_metric_insights where metric_id = $1', [METRIC]),
    );
    const otherCoach = await asUser(COACH_B, (c) =>
      c.query('select metric_id from public.body_metric_insights where metric_id = $1', [METRIC]),
    );
    const anon = await asAnon((c) => c.query('select metric_id from public.body_metric_insights'));
    expect(coach.rows).toHaveLength(1);
    expect(owner.rows).toHaveLength(0); // the client never sees the coach's analysis
    expect(otherCoach.rows).toHaveLength(0);
    expect(anon.rows).toHaveLength(0);
  });

  it('a client CANNOT write an insight (service-role only): insert rejected', async () => {
    await expect(
      asUser(CLIENT_A2_IDENT, (c) =>
        c.query("insert into public.body_metric_insights (metric_id, analysis) values ($1, 'x')", [METRIC]),
      ),
    ).rejects.toThrow();
  });

  it('comments: the reading’s owner + their coach read them; another coach and anon cannot', async () => {
    const owner = await asUser(CLIENT_A2_IDENT, (c) =>
      c.query('select id from public.body_metric_comments where metric_id = $1', [METRIC]),
    );
    const coach = await asUser(COACH_A, (c) =>
      c.query('select id from public.body_metric_comments where metric_id = $1', [METRIC]),
    );
    const otherCoach = await asUser(COACH_B, (c) =>
      c.query('select id from public.body_metric_comments where metric_id = $1', [METRIC]),
    );
    const anon = await asAnon((c) => c.query('select id from public.body_metric_comments'));
    expect(owner.rows).toHaveLength(1); // the client reads the coach's feedback
    expect(coach.rows).toHaveLength(1);
    expect(otherCoach.rows).toHaveLength(0); // cross-tenant denial
    expect(anon.rows).toHaveLength(0);
  });

  it('the coach comments on their client’s reading; author is server-stamped to the caller', async () => {
    const r = await asUser(COACH_A, (c) =>
      c.query("insert into public.body_metric_comments (metric_id, body) values ($1, 'Nice work') returning author_id", [
        METRIC,
      ]),
    );
    expect(r.rows[0].author_id).toBe(COACH_A.sub); // forced from auth.uid()
  });

  it('the athlete CANNOT comment on their own reading (coach→client only): insert rejected', async () => {
    await expect(
      asUser(CLIENT_A2_IDENT, (c) =>
        c.query("insert into public.body_metric_comments (metric_id, body) values ($1, 'me')", [METRIC]),
      ),
    ).rejects.toThrow();
  });

  it('a coach cannot comment on a client they do not coach: insert rejected', async () => {
    await expect(
      asUser(COACH_B, (c) =>
        c.query("insert into public.body_metric_comments (metric_id, body) values ($1, 'x')", [METRIC]),
      ),
    ).rejects.toThrow();
  });
});

describe('coach AI plan_insights (0029) — coach-only nudges, athlete never sees them (§2)', () => {
  const COACH_B: Identity = { sub: COACH_B_ID, userRole: 'coach' };
  const CLIENT = CLIENT_A1.sub; // Coach A's client, owner of the seeded nudge

  it('the nudge is COACH-ONLY: the client’s coach reads it; the client (owner), another coach, and anon cannot', async () => {
    const coach = await asUser(COACH_A, (c) =>
      c.query('select client_id from public.plan_insights where client_id = $1', [CLIENT]),
    );
    const owner = await asUser(CLIENT_A1, (c) =>
      c.query('select client_id from public.plan_insights where client_id = $1', [CLIENT]),
    );
    const otherCoach = await asUser(COACH_B, (c) =>
      c.query('select client_id from public.plan_insights where client_id = $1', [CLIENT]),
    );
    const anon = await asAnon((c) => c.query('select client_id from public.plan_insights'));
    expect(coach.rows).toHaveLength(1);
    expect(owner.rows).toHaveLength(0); // the client never sees the coach's private suggestions
    expect(otherCoach.rows).toHaveLength(0); // cross-tenant denial
    expect(anon.rows).toHaveLength(0);
  });

  it('a client CANNOT write a nudge (service-role only): insert rejected', async () => {
    await expect(
      asUser(CLIENT_A1, (c) =>
        c.query("insert into public.plan_insights (client_id, analysis) values ($1, 'x')", [CLIENT]),
      ),
    ).rejects.toThrow();
  });
});

describe('coach analytics (0031, Phase 15) — coach-fenced KPI engine + coach-only summary (§2)', () => {
  const COACH_B: Identity = { sub: COACH_B_ID, userRole: 'coach' };

  // ── coach_analytics_insights: the AI roster summary is COACH-OWNED (read by the
  // owning coach, hidden from other coaches + clients; service-role write only). ──
  it('the summary is readable by the OWNING coach; another coach, a client, and anon get nothing', async () => {
    const owner = await asUser(COACH_A, (c) =>
      c.query('select coach_id from public.coach_analytics_insights where coach_id = $1', [COACH_A.sub]),
    );
    const otherCoach = await asUser(COACH_B, (c) =>
      c.query('select coach_id from public.coach_analytics_insights where coach_id = $1', [COACH_A.sub]),
    );
    const client = await asUser(CLIENT_A1, (c) =>
      c.query('select coach_id from public.coach_analytics_insights'),
    );
    const anon = await asAnon((c) => c.query('select coach_id from public.coach_analytics_insights'));
    expect(owner.rows).toHaveLength(1);
    expect(otherCoach.rows).toHaveLength(0); // cross-tenant denial
    expect(client.rows).toHaveLength(0); // not a coach surface
    expect(anon.rows).toHaveLength(0);
  });

  it('a client CANNOT write a summary (service-role only): insert rejected', async () => {
    await expect(
      asUser(COACH_A, (c) =>
        c.query("insert into public.coach_analytics_insights (coach_id, analysis) values ($1, 'x')", [COACH_A.sub]),
      ),
    ).rejects.toThrow();
  });

  // ── coach_adherence_overview: per-client roster counts, fenced to the caller ──
  it('coach_adherence_overview returns only the caller’s own clients with their counts', async () => {
    const a = await asUser(COACH_A, (c) =>
      c.query('select client_id, sessions_completed, nutrition_days from public.coach_adherence_overview((current_date - 30)::date)'),
    );
    const ids = a.rows.map((r) => r.client_id);
    expect(ids).toContain(CLIENT_A1.sub);
    expect(ids).toContain(CLIENT_A2);
    expect(ids).not.toContain(CLIENT_B1);
    const a1 = a.rows.find((r) => r.client_id === CLIENT_A1.sub);
    expect(a1.sessions_completed).toBe(3); // 3 completed sessions in the window (seed)
    expect(a1.nutrition_days).toBe(2); // logged today + yesterday (seed)

    const b = await asUser(COACH_B, (c) =>
      c.query('select client_id from public.coach_adherence_overview((current_date - 30)::date)'),
    );
    const bIds = b.rows.map((r) => r.client_id);
    expect(bIds).toContain(CLIENT_B1);
    expect(bIds).not.toContain(CLIENT_A1.sub);
  });

  it('coach_adherence_overview rejects a client caller and anon', async () => {
    await expect(
      asUser(CLIENT_A1, (c) => c.query('select * from public.coach_adherence_overview((current_date - 30)::date)')),
    ).rejects.toThrow(); // not_a_coach
    await expect(
      asAnon((c) => c.query('select * from public.coach_adherence_overview((current_date - 30)::date)')),
    ).rejects.toThrow(); // no execute grant
  });

  // ── coach_plan_effectiveness: PUBLISHED client plans only, fenced to the caller ──
  it('coach_plan_effectiveness returns only the caller’s published, client-assigned plans', async () => {
    const a = await asUser(COACH_A, (c) =>
      c.query('select plan_id, plan_type, ai_generated, client_id, entries from public.coach_plan_effectiveness()'),
    );
    const planIds = a.rows.map((r) => r.plan_id);
    // A1's published training plan (…0001) + published nutrition plan (…0004) appear.
    expect(planIds).toContain('99990001-0000-0000-0000-000000000001');
    expect(planIds).toContain('99990004-0000-0000-0000-000000000004');
    // The A1 DRAFT nutrition plan (…0002) and the unassigned TEMPLATES (…0010/…0011) do not.
    expect(planIds).not.toContain('99990002-0000-0000-0000-000000000002');
    expect(planIds).not.toContain('99990010-0000-0000-0000-000000000010');
    // Coach B's plan never leaks.
    expect(planIds).not.toContain('99990003-0000-0000-0000-000000000003');
    const training = a.rows.find((r) => r.plan_id === '99990001-0000-0000-0000-000000000001');
    expect(training.ai_generated).toBe(true); // seed flagged it
    expect(training.client_id).toBe(CLIENT_A1.sub);
    expect(training.entries).toBe(2); // A1 has 2 verified readings (seed)

    const b = await asUser(COACH_B, (c) =>
      c.query('select plan_id from public.coach_plan_effectiveness()'),
    );
    const bIds = b.rows.map((r) => r.plan_id);
    expect(bIds).toContain('99990003-0000-0000-0000-000000000003');
    expect(bIds).not.toContain('99990001-0000-0000-0000-000000000001');
  });

  it('coach_plan_effectiveness rejects a client caller and anon', async () => {
    await expect(
      asUser(CLIENT_A1, (c) => c.query('select * from public.coach_plan_effectiveness()')),
    ).rejects.toThrow(); // not_a_coach
    await expect(
      asAnon((c) => c.query('select * from public.coach_plan_effectiveness()')),
    ).rejects.toThrow(); // no execute grant
  });
});

describe('notifications (0032, Phase 17) — in-app feed, prefs, event triggers (§2/§8)', () => {
  const COACH_B: Identity = { sub: COACH_B_ID, userRole: 'coach' };
  const CLIENT_A2_ID: Identity = { sub: CLIENT_A2, userRole: 'client' };
  const A1_NUT_DRAFT = '99990002-0000-0000-0000-000000000002'; // A1 draft nutrition plan
  const SESS_A1 = '5e550001-0000-0000-0000-000000000001'; // A1 session w/ seeded bench sets

  // The seed commits notifications as a SIDE EFFECT of the event triggers: A1's
  // inbound "Welcome aboard!" message + two published assigned plans → A1 has a feed.

  // ── feed RLS: a personal surface, recipient-only (no coach/admin override, §8) ──
  it('a recipient reads only their OWN feed; their coach, another tenant, and anon see nothing', async () => {
    const owner = await asUser(CLIENT_A1, (c) =>
      c.query('select recipient_id from public.notifications'),
    );
    expect(owner.rows.length).toBeGreaterThanOrEqual(1); // seeded message + published plans
    expect(owner.rows.every((r) => r.recipient_id === CLIENT_A1.sub)).toBe(true);

    const coach = await asUser(COACH_A, (c) =>
      c.query('select id from public.notifications where recipient_id = $1', [CLIENT_A1.sub]),
    );
    const otherClient = await asUser(CLIENT_A2_ID, (c) =>
      c.query('select id from public.notifications where recipient_id = $1', [CLIENT_A1.sub]),
    );
    const otherCoach = await asUser(COACH_B, (c) =>
      c.query('select id from public.notifications where recipient_id = $1', [CLIENT_A1.sub]),
    );
    const anon = await asAnon((c) => c.query('select id from public.notifications'));
    expect(coach.rows).toHaveLength(0); // a personal feed — not even the assigned coach
    expect(otherClient.rows).toHaveLength(0);
    expect(otherCoach.rows).toHaveLength(0);
    expect(anon.rows).toHaveLength(0);
  });

  it('a client cannot INSERT or UPDATE notifications (server-side only); they may dismiss their own', async () => {
    // No insert grant/policy — a client must never mint a feed row (for self or others).
    await expect(
      asUser(CLIENT_A1, (c) =>
        c.query("insert into public.notifications (recipient_id, type) values ($1, 'message')", [CLIENT_A1.sub]),
      ),
    ).rejects.toThrow();
    await expect(
      asUser(CLIENT_A1, (c) =>
        c.query("insert into public.notifications (recipient_id, type) values ($1, 'message')", [CLIENT_A2]),
      ),
    ).rejects.toThrow();
    // No UPDATE path (read-state flips via the RPC) — a direct UPDATE can't tamper.
    await expect(
      asUser(CLIENT_A1, (c) =>
        c.query('update public.notifications set read_at = now() where recipient_id = $1', [CLIENT_A1.sub]),
      ),
    ).rejects.toThrow();
    // Dismiss own (delete) is allowed; deleting another's affects nothing.
    const own = await asUser(CLIENT_A1, (c) =>
      c.query('delete from public.notifications where recipient_id = $1', [CLIENT_A1.sub]),
    );
    expect(own.rowCount).toBeGreaterThanOrEqual(1);
    const cross = await asUser(COACH_B, (c) =>
      c.query('delete from public.notifications where recipient_id = $1', [CLIENT_A1.sub]),
    );
    expect(cross.rowCount).toBe(0);
  });

  it('mark_all_notifications_read clears the owner’s unread; a stranger cannot mark another’s', async () => {
    const cleared = await asUser(CLIENT_A1, async (c) => {
      await c.query('select public.mark_all_notifications_read()');
      return c.query(
        'select count(*)::int as n from public.notifications where recipient_id = $1 and read_at is null',
        [CLIENT_A1.sub],
      );
    });
    expect(cleared.rows[0].n).toBe(0);

    // A2 calling the single-row RPC on one of A1's rows updates nothing (scoped to auth.uid()).
    const c = await pool.connect();
    try {
      await c.query('begin');
      await c.query('set local role service_role');
      const row = await c.query(
        'select id from public.notifications where recipient_id = $1 and read_at is null limit 1',
        [CLIENT_A1.sub],
      );
      const id = row.rows[0]?.id;
      expect(id).toBeTruthy();
      await c.query('reset role');
      await c.query('set local role authenticated');
      await c.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: CLIENT_A2, role: 'authenticated', user_role: 'client' }),
      ]);
      await c.query('select public.mark_notification_read($1)', [id]);
      await c.query('reset role');
      await c.query('set local role service_role');
      const after = await c.query('select read_at from public.notifications where id = $1', [id]);
      expect(after.rows[0].read_at).toBeNull(); // A2's call left A1's row untouched
    } finally {
      await c.query('rollback').catch(() => {});
      c.release();
    }
  });

  // ── prefs: owner-controlled (with_check forces user_id = auth.uid()) ──────────
  it('a client upserts their OWN prefs but cannot create one for another user; anon sees none', async () => {
    const ok = await asUser(CLIENT_A1, (c) =>
      c.query('insert into public.notification_prefs (user_id, message) values ($1, false) returning user_id', [
        CLIENT_A1.sub,
      ]),
    );
    expect(ok.rows[0].user_id).toBe(CLIENT_A1.sub);
    await expect(
      asUser(CLIENT_A1, (c) =>
        c.query('insert into public.notification_prefs (user_id) values ($1)', [CLIENT_A2]),
      ),
    ).rejects.toThrow();
    const anon = await asAnon((c) => c.query('select user_id from public.notification_prefs'));
    expect(anon.rows).toHaveLength(0);
  });

  // ── event triggers (insert + observe in one service-role txn) ────────────────
  it('a new message emits a feed row for the recipient, deep-linked to the sender’s chat', async () => {
    const r = await asService(async (c) => {
      await c.query('insert into public.messages (sender_id, recipient_id, body) values ($1, $2, $3)', [
        COACH_B_ID,
        CLIENT_B1,
        'Trigger test',
      ]);
      return c.query(
        "select entity_type, entity_id from public.notifications where recipient_id = $1 and type = 'message' and actor_id = $2",
        [CLIENT_B1, COACH_B_ID],
      );
    });
    expect(r.rows.length).toBeGreaterThanOrEqual(1);
    expect(r.rows[0].entity_type).toBe('chat');
    expect(r.rows[0].entity_id).toBe(COACH_B_ID); // tap → open chat with the sender
  });

  it('a per-type opt-out suppresses the emit (smart, not spammy)', async () => {
    const n = await asService(async (c) => {
      await c.query('insert into public.notification_prefs (user_id, message) values ($1, false)', [CLIENT_B1]);
      await c.query('insert into public.messages (sender_id, recipient_id, body) values ($1, $2, $3)', [
        COACH_B_ID,
        CLIENT_B1,
        'Should be silent',
      ]);
      return c.query(
        "select count(*)::int as n from public.notifications where recipient_id = $1 and type = 'message' and actor_id = $2",
        [CLIENT_B1, COACH_B_ID],
      );
    });
    expect(n.rows[0].n).toBe(0); // pref off → no feed row
  });

  it('publishing a plan emits a plan_published feed row for the assigned client', async () => {
    const r = await asService(async (c) => {
      await c.query("update public.plans set status = 'published' where id = $1", [A1_NUT_DRAFT]);
      return c.query(
        "select params->>'plan_title' as title from public.notifications where recipient_id = $1 and type = 'plan_published' and entity_id = $2",
        [CLIENT_A1.sub, A1_NUT_DRAFT],
      );
    });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].title).toBe('A1 Cut (draft)');
  });

  it('a completed set beating the prior best emits one pr_achieved row (a first log is a baseline, not a PR)', async () => {
    const r = await asService(async (c) => {
      const before = await c.query(
        "select count(*)::int as n from public.notifications where recipient_id = $1 and type = 'pr_achieved'",
        [CLIENT_A1.sub],
      );
      // A1's seeded bench best e1RM is 76000g; 70kg×8 → 88667g beats it.
      await c.query(
        "insert into public.exercise_set_logs (session_id, exercise_name, set_index, reps_done, load_grams, is_completed) values ($1, 'Barbell Bench Press', 99, 8, 70000, true)",
        [SESS_A1],
      );
      const after = await c.query(
        "select count(*)::int as n from public.notifications where recipient_id = $1 and type = 'pr_achieved'",
        [CLIENT_A1.sub],
      );
      const row = await c.query(
        "select params->>'e1rm_grams' as e1rm from public.notifications where recipient_id = $1 and type = 'pr_achieved' order by created_at desc limit 1",
        [CLIENT_A1.sub],
      );
      return { before: before.rows[0].n, after: after.rows[0].n, e1rm: row.rows[0].e1rm };
    });
    expect(r.after).toBe(r.before + 1);
    expect(Number(r.e1rm)).toBe(88667); // round(70000 × (30+8) / 30)
  });
});

describe('chat safety (0034, Phase 18) — message reports + ban enforcement (§2/§8)', () => {
  const ADMIN: Identity = { sub: 'dddddddd-dddd-dddd-dddd-dddddddddddd', userRole: 'admin' };
  const COACH_B: Identity = { sub: COACH_B_ID, userRole: 'coach' };
  const COACH_A_ID = '11111111-1111-1111-1111-111111111111';
  const REPORT = '7e900001-0000-0000-0000-000000000001'; // seeded: A1 reported Coach A's ab000003
  const MSG_TO_A1 = 'ab000001-0000-0000-0000-000000000001'; // Coach A → A1 (unreported)
  const MSG_FROM_A1 = 'ab000002-0000-0000-0000-000000000002'; // A1 → Coach A
  const MSG_REPORTED = 'ab000003-0000-0000-0000-000000000003'; // Coach A → A1 (already reported)

  // ── report feed RLS: reporter + admin only; the REPORTED user never sees it ──
  it('the reporter and an admin read a report; the reported user, another tenant, and anon do not', async () => {
    const reporter = await asUser(CLIENT_A1, (c) => c.query('select id from public.message_reports'));
    const admin = await asUser(ADMIN, (c) => c.query('select id from public.message_reports'));
    const reported = await asUser(COACH_A, (c) => c.query('select id from public.message_reports')); // Coach A is reported
    const otherTenant = await asUser(COACH_B, (c) => c.query('select id from public.message_reports'));
    const anon = await asAnon((c) => c.query('select id from public.message_reports'));
    expect(reporter.rows.length).toBeGreaterThanOrEqual(1);
    expect(admin.rows.length).toBeGreaterThanOrEqual(1);
    expect(reported.rows).toHaveLength(0); // the reported user cannot read reports filed against them
    expect(otherTenant.rows).toHaveLength(0);
    expect(anon.rows).toHaveLength(0);
  });

  // ── report insert: reporter/reported server-set; only a message addressed to you ──
  it('a participant reports a message ADDRESSED TO THEM; reporter + reported are server-set', async () => {
    const r = await asUser(CLIENT_A1, (c) =>
      c.query(
        "insert into public.message_reports (message_id, reason) values ($1, 'spam') returning reporter_id, reported_user_id, status",
        [MSG_TO_A1],
      ),
    );
    expect(r.rows[0].reporter_id).toBe(CLIENT_A1.sub);
    expect(r.rows[0].reported_user_id).toBe(COACH_A_ID); // the message's sender, derived server-side
    expect(r.rows[0].status).toBe('open');
  });

  it('cannot report your OWN message, a message you cannot see, or file a duplicate', async () => {
    // ab000002 was SENT BY A1 (A1 is the sender, not the recipient) → rejected.
    await expect(
      asUser(CLIENT_A1, (c) =>
        c.query("insert into public.message_reports (message_id, reason) values ($1, 'other')", [MSG_FROM_A1]),
      ),
    ).rejects.toThrow();
    // Coach B can't see Coach A↔A1's DM (§8) → cannot report it (cross-tenant).
    await expect(
      asUser(COACH_B, (c) =>
        c.query("insert into public.message_reports (message_id, reason) values ($1, 'other')", [MSG_TO_A1]),
      ),
    ).rejects.toThrow();
    // A1 already reported ab000003 (seed) → unique (message_id, reporter_id) blocks a re-file.
    await expect(
      asUser(CLIENT_A1, (c) =>
        c.query("insert into public.message_reports (message_id, reason) values ($1, 'spam')", [MSG_REPORTED]),
      ),
    ).rejects.toThrow();
  });

  it('a client cannot UPDATE or DELETE a report (append-only; status is service-role-only)', async () => {
    await expect(
      asUser(CLIENT_A1, (c) =>
        c.query("update public.message_reports set status = 'dismissed' where id = $1", [REPORT]),
      ),
    ).rejects.toThrow();
    await expect(
      asUser(CLIENT_A1, (c) => c.query('delete from public.message_reports where id = $1', [REPORT])),
    ).rejects.toThrow();
  });

  // ── ban enforcement: a banned user cannot send (set ban + send in one txn) ────
  it('a banned account cannot send messages', async () => {
    const c = await pool.connect();
    try {
      await c.query('begin');
      // Ban Client A1 as the service role (bypasses the profiles immutability trigger).
      await c.query('set local role service_role');
      await c.query('update public.profiles set banned_at = now() where id = $1', [CLIENT_A1.sub]);
      // Now act as the banned A1 → the send trigger rejects.
      await c.query('reset role');
      await c.query('set local role authenticated');
      await c.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: CLIENT_A1.sub, role: 'authenticated', user_role: 'client' }),
      ]);
      await expect(
        c.query('insert into public.messages (recipient_id, body) values ($1, $2)', [COACH_A_ID, 'while banned']),
      ).rejects.toThrow();
    } finally {
      await c.query('rollback').catch(() => {});
      c.release();
    }
  });

  it('a client cannot ban anyone (banned_at is immutable from the client)', async () => {
    await expect(
      asUser(CLIENT_A1, (c) =>
        c.query('update public.profiles set banned_at = now() where id = $1', [CLIENT_A1.sub]),
      ),
    ).rejects.toThrow();
  });

  // ── moderation RPC: admin-only, the sole writer of report status + the ban ────
  it('moderate_message_report (ban) bans the reported user and actions the report', async () => {
    const r = await asService(async (c) => {
      await c.query('select public.moderate_message_report($1, $2, $3)', [REPORT, 'ban', ADMIN.sub]);
      const prof = await c.query('select banned_at from public.profiles where id = $1', [COACH_A_ID]);
      const rep = await c.query('select status, reviewed_by from public.message_reports where id = $1', [REPORT]);
      return { banned: prof.rows[0].banned_at, status: rep.rows[0].status, reviewer: rep.rows[0].reviewed_by };
    });
    expect(r.banned).not.toBeNull();
    expect(r.status).toBe('actioned');
    expect(r.reviewer).toBe(ADMIN.sub);
  });

  it('moderate_message_report rejects a non-admin reviewer and is not callable by clients', async () => {
    // A non-admin reviewer id → the in-function admin check fails.
    await expect(
      asService((c) =>
        c.query('select public.moderate_message_report($1, $2, $3)', [REPORT, 'dismiss', CLIENT_A1.sub]),
      ),
    ).rejects.toThrow();
    // EXECUTE is revoked from authenticated → a client can't call it at all.
    await expect(
      asUser(CLIENT_A1, (c) =>
        c.query('select public.moderate_message_report($1, $2, $3)', [REPORT, 'dismiss', CLIENT_A1.sub]),
      ),
    ).rejects.toThrow();
  });
});

describe('chat engagement (0036, Phase 18 Slice 2) — reactions + soft edit (§2/§8)', () => {
  const COACH_B: Identity = { sub: COACH_B_ID, userRole: 'coach' };
  const COACH_A_ID = '11111111-1111-1111-1111-111111111111';
  const MSG_TO_A1 = 'ab000001-0000-0000-0000-000000000001'; // Coach A → A1
  const MSG_FROM_A1 = 'ab000002-0000-0000-0000-000000000002'; // A1 → Coach A
  const SEED_REACTION = '4eac0001-0000-0000-0000-000000000001'; // A1 reacted 👍 to MSG_TO_A1

  // ── reactions read: both parties see them; outsiders + anon do not ───────────
  it('both parties read a reaction on their thread; another tenant and anon do not', async () => {
    const coachA = await asUser(COACH_A, (c) => c.query('select id from public.message_reactions'));
    const clientA1 = await asUser(CLIENT_A1, (c) => c.query('select id from public.message_reactions'));
    const coachB = await asUser(COACH_B, (c) => c.query('select id from public.message_reactions'));
    const anon = await asAnon((c) => c.query('select id from public.message_reactions'));
    expect(coachA.rows.length).toBeGreaterThanOrEqual(1);
    expect(clientA1.rows.length).toBeGreaterThanOrEqual(1);
    expect(coachB.rows).toHaveLength(0);
    expect(anon.rows).toHaveLength(0);
  });

  // ── reactions insert: server-set reactor; only on a message you can see ──────
  it('a participant reacts to a message in their thread; user_id is server-set', async () => {
    const r = await asUser(CLIENT_A1, (c) =>
      c.query(
        "insert into public.message_reactions (message_id, emoji) values ($1, '❤️') returning user_id",
        [MSG_TO_A1],
      ),
    );
    expect(r.rows[0].user_id).toBe(CLIENT_A1.sub);
  });

  it('the server forces user_id = auth.uid() (a forged reactor is overwritten)', async () => {
    const r = await asUser(CLIENT_A1, (c) =>
      c.query(
        "insert into public.message_reactions (user_id, message_id, emoji) values ($1, $2, '🔥') returning user_id",
        [COACH_B_ID, MSG_TO_A1],
      ),
    );
    expect(r.rows[0].user_id).toBe(CLIENT_A1.sub); // not the forged COACH_B_ID
  });

  it('cannot react to a message you cannot see (cross-tenant outsider)', async () => {
    await expect(
      asUser(COACH_B, (c) =>
        c.query("insert into public.message_reactions (message_id, emoji) values ($1, '🔥')", [MSG_TO_A1]),
      ),
    ).rejects.toThrow();
  });

  it('a reactor removes their OWN reaction; another party cannot delete it', async () => {
    const mine = await asUser(CLIENT_A1, (c) =>
      c.query('delete from public.message_reactions where id = $1', [SEED_REACTION]),
    );
    expect(mine.rowCount).toBe(1);
    // Coach A can SEE A1's reaction (party) but the delete policy is own-only → 0 rows.
    const others = await asUser(COACH_A, (c) =>
      c.query('delete from public.message_reactions where id = $1', [SEED_REACTION]),
    );
    expect(others.rowCount).toBe(0);
  });

  it('a banned account cannot react', async () => {
    const c = await pool.connect();
    try {
      await c.query('begin');
      await c.query('set local role service_role');
      await c.query('update public.profiles set banned_at = now() where id = $1', [CLIENT_A1.sub]);
      await c.query('reset role');
      await c.query('set local role authenticated');
      await c.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: CLIENT_A1.sub, role: 'authenticated', user_role: 'client' }),
      ]);
      await expect(
        c.query("insert into public.message_reactions (message_id, emoji) values ($1, '🔥')", [MSG_FROM_A1]),
      ).rejects.toThrow();
    } finally {
      await c.query('rollback').catch(() => {});
      c.release();
    }
  });

  // ── soft edit: sender-only, body-only, within window, not banned ─────────────
  it('the sender edits their OWN recent message; edited_at + original_body are set', async () => {
    const r = await asUser(COACH_A, (c) =>
      c.query(
        "update public.messages set body = 'fixed' where id = $1 returning edited_at, original_body, body",
        [MSG_TO_A1],
      ),
    );
    expect(r.rows[0].edited_at).not.toBeNull();
    expect(r.rows[0].original_body).toBe('Welcome aboard!'); // the first original is preserved
    expect(r.rows[0].body).toBe('fixed');
  });

  it('the recipient cannot edit the sender’s message (RLS update is sender-only)', async () => {
    const r = await asUser(CLIENT_A1, (c) =>
      c.query("update public.messages set body = 'nope' where id = $1", [MSG_TO_A1]),
    );
    expect(r.rowCount).toBe(0); // not their message → 0 rows, no leak
  });

  it('an edit cannot change sender / recipient / created_at', async () => {
    await expect(
      asUser(COACH_A, (c) =>
        c.query('update public.messages set recipient_id = $1 where id = $2', [COACH_B_ID, MSG_TO_A1]),
      ),
    ).rejects.toThrow(/message_immutable_fields/);
  });

  it('a message past the edit window cannot be edited', async () => {
    const c = await pool.connect();
    try {
      await c.query('begin');
      // Seed an OLD Coach A → A1 message as the service role (bypasses the send path).
      await c.query('set local role service_role');
      const old = await c.query(
        "insert into public.messages (sender_id, recipient_id, body, created_at) values ($1, $2, 'old', now() - interval '1 hour') returning id",
        [COACH_A_ID, CLIENT_A1.sub],
      );
      const oldId = old.rows[0].id;
      await c.query('reset role');
      await c.query('set local role authenticated');
      await c.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: COACH_A_ID, role: 'authenticated', user_role: 'coach' }),
      ]);
      await expect(
        c.query("update public.messages set body = 'late edit' where id = $1", [oldId]),
      ).rejects.toThrow(/edit_window/);
    } finally {
      await c.query('rollback').catch(() => {});
      c.release();
    }
  });

  it('a banned account cannot edit', async () => {
    const c = await pool.connect();
    try {
      await c.query('begin');
      await c.query('set local role service_role');
      await c.query('update public.profiles set banned_at = now() where id = $1', [COACH_A_ID]);
      await c.query('reset role');
      await c.query('set local role authenticated');
      await c.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: COACH_A_ID, role: 'authenticated', user_role: 'coach' }),
      ]);
      await expect(
        c.query("update public.messages set body = 'while banned' where id = $1", [MSG_TO_A1]),
      ).rejects.toThrow(/banned/);
    } finally {
      await c.query('rollback').catch(() => {});
      c.release();
    }
  });
});

describe('message replies (0037, Phase 18 Slice 2) — quote a message in your thread (§8)', () => {
  const COACH_B: Identity = { sub: COACH_B_ID, userRole: 'coach' };
  const COACH_A_ID = '11111111-1111-1111-1111-111111111111';
  const MSG_TO_A1 = 'ab000001-0000-0000-0000-000000000001'; // Coach A → A1 (A1 can see it)
  const MSG_FROM_A1 = 'ab000002-0000-0000-0000-000000000002'; // A1 → Coach A; seeded reply_to ab000001

  it('a participant replies quoting a message in their own thread', async () => {
    const r = await asUser(CLIENT_A1, (c) =>
      c.query(
        'insert into public.messages (recipient_id, body, reply_to_id) values ($1, $2, $3) returning reply_to_id',
        [COACH_A_ID, 'replying to you', MSG_TO_A1],
      ),
    );
    expect(r.rows[0].reply_to_id).toBe(MSG_TO_A1);
  });

  it('cannot quote a message you cannot see (cross-thread reply is rejected)', async () => {
    // Coach B → their own client B1 is a valid send, but quoting Coach A↔A1's DM (§8)
    // is rejected by the trigger (invalid_reply) — B can't see that message.
    await expect(
      asUser(COACH_B, (c) =>
        c.query('insert into public.messages (recipient_id, body, reply_to_id) values ($1, $2, $3)', [
          CLIENT_B1,
          'sneaky quote',
          MSG_TO_A1,
        ]),
      ),
    ).rejects.toThrow(/invalid_reply/);
  });

  it('an edit cannot change reply_to_id (the reply target is immutable)', async () => {
    // A1 owns MSG_FROM_A1 (seeded reply_to ab000001); rewiring the quote is rejected.
    await expect(
      asUser(CLIENT_A1, (c) =>
        c.query('update public.messages set reply_to_id = null where id = $1', [MSG_FROM_A1]),
      ),
    ).rejects.toThrow(/message_immutable_fields/);
  });
});

describe('ban appeals (0038, Phase 18 Slice 3) — a banned user appeals; admin resolves (§2/§8)', () => {
  const ADMIN: Identity = { sub: 'dddddddd-dddd-dddd-dddd-dddddddddddd', userRole: 'admin' };

  // ── insert: only a BANNED account may appeal; user_id + status are server-set ──
  it('a banned account files an appeal (user_id + status server-set); a non-banned account cannot', async () => {
    const c = await pool.connect();
    try {
      await c.query('begin');
      // Ban Client A1 as the service role (bypasses the profiles immutability trigger).
      await c.query('set local role service_role');
      await c.query('update public.profiles set banned_at = now() where id = $1', [CLIENT_A1.sub]);
      await c.query('reset role');
      await c.query('set local role authenticated');
      await c.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: CLIENT_A1.sub, role: 'authenticated', user_role: 'client' }),
      ]);
      const ins = await c.query(
        "insert into public.ban_appeals (note) values ('please review my case') returning user_id, status",
      );
      expect(ins.rows[0].user_id).toBe(CLIENT_A1.sub); // server-set, not client-supplied
      expect(ins.rows[0].status).toBe('open');
      // A second OPEN appeal is blocked by the partial unique index.
      await expect(c.query("insert into public.ban_appeals (note) values ('again')")).rejects.toThrow();
    } finally {
      await c.query('rollback').catch(() => {});
      c.release();
    }
    // Outside the rolled-back txn, CLIENT_A1 is NOT banned → the trigger rejects.
    await expect(
      asUser(CLIENT_A1, (c) => c.query("insert into public.ban_appeals (note) values ('no reason')")),
    ).rejects.toThrow();
  });

  // ── read RLS: the appellant + admin only; another tenant + anon get 0 rows ─────
  it('the appellant and an admin read an appeal; another tenant and anon do not', async () => {
    const c = await pool.connect();
    try {
      await c.query('begin');
      await c.query('set local role service_role');
      await c.query('update public.profiles set banned_at = now() where id = $1', [CLIENT_B1]);
      await c.query("insert into public.ban_appeals (user_id, note) values ($1, 'let me back in')", [CLIENT_B1]);
      await c.query('reset role');
      await c.query('set local role authenticated');
      const claims = (sub: string, ur: string) =>
        c.query("select set_config('request.jwt.claims', $1, true)", [
          JSON.stringify({ sub, role: 'authenticated', user_role: ur }),
        ]);
      await claims(CLIENT_B1, 'client');
      const owner = await c.query('select id from public.ban_appeals');
      await claims(CLIENT_A1.sub, 'client'); // a different tenant
      const otherTenant = await c.query('select id from public.ban_appeals');
      await claims(ADMIN.sub, 'admin');
      const admin = await c.query('select id from public.ban_appeals');
      await c.query('reset role');
      await c.query('set local role anon');
      await c.query("select set_config('request.jwt.claims', '{}', true)");
      const anon = await c.query('select id from public.ban_appeals');
      expect(owner.rows.length).toBeGreaterThanOrEqual(1);
      expect(otherTenant.rows).toHaveLength(0);
      expect(admin.rows.length).toBeGreaterThanOrEqual(1);
      expect(anon.rows).toHaveLength(0);
    } finally {
      await c.query('rollback').catch(() => {});
      c.release();
    }
  });

  it('a client cannot UPDATE or DELETE an appeal (append-only; not granted)', async () => {
    await expect(
      asUser(CLIENT_A1, (c) => c.query("update public.ban_appeals set status = 'approved'")),
    ).rejects.toThrow();
    await expect(asUser(CLIENT_A1, (c) => c.query('delete from public.ban_appeals'))).rejects.toThrow();
  });

  // ── resolve RPC: admin-only, the sole writer of appeal status + the unban ──────
  it('resolve_ban_appeal (approve) clears the ban and approves the appeal', async () => {
    const r = await asService(async (c) => {
      await c.query('update public.profiles set banned_at = now() where id = $1', [CLIENT_A1.sub]);
      const ins = await c.query(
        "insert into public.ban_appeals (user_id, note) values ($1, 'sorry, it won''t happen again') returning id",
        [CLIENT_A1.sub],
      );
      const appealId = ins.rows[0].id;
      await c.query('select public.resolve_ban_appeal($1, $2, $3)', [appealId, 'approve', ADMIN.sub]);
      const prof = await c.query('select banned_at from public.profiles where id = $1', [CLIENT_A1.sub]);
      const ap = await c.query('select status, reviewed_by from public.ban_appeals where id = $1', [appealId]);
      return { banned: prof.rows[0].banned_at, status: ap.rows[0].status, reviewer: ap.rows[0].reviewed_by };
    });
    expect(r.banned).toBeNull(); // unbanned
    expect(r.status).toBe('approved');
    expect(r.reviewer).toBe(ADMIN.sub);
  });

  it('resolve_ban_appeal (reject) keeps the ban and rejects the appeal', async () => {
    const r = await asService(async (c) => {
      await c.query('update public.profiles set banned_at = now() where id = $1', [CLIENT_A1.sub]);
      const ins = await c.query(
        "insert into public.ban_appeals (user_id, note) values ($1, 'whatever') returning id",
        [CLIENT_A1.sub],
      );
      const appealId = ins.rows[0].id;
      await c.query('select public.resolve_ban_appeal($1, $2, $3)', [appealId, 'reject', ADMIN.sub]);
      const prof = await c.query('select banned_at from public.profiles where id = $1', [CLIENT_A1.sub]);
      const ap = await c.query('select status from public.ban_appeals where id = $1', [appealId]);
      return { banned: prof.rows[0].banned_at, status: ap.rows[0].status };
    });
    expect(r.banned).not.toBeNull(); // still banned
    expect(r.status).toBe('rejected');
  });

  it('resolve_ban_appeal rejects a non-admin reviewer and is not callable by clients', async () => {
    const FAKE = '7e900099-0000-0000-0000-000000000099';
    // A non-admin reviewer id → the in-function admin check fails (before the lookup).
    await expect(
      asService((c) => c.query('select public.resolve_ban_appeal($1, $2, $3)', [FAKE, 'approve', CLIENT_A1.sub])),
    ).rejects.toThrow();
    // EXECUTE is revoked from authenticated → a client can't call it at all.
    await expect(
      asUser(CLIENT_A1, (c) => c.query('select public.resolve_ban_appeal($1, $2, $3)', [FAKE, 'approve', CLIENT_A1.sub])),
    ).rejects.toThrow();
  });
});

describe('chat acknowledgments (0039, Phase 18 Slice 3) — per-person disclaimer gate (§8)', () => {
  it('a user records an acknowledgment; user_id is server-set (a forged owner is overwritten)', async () => {
    const r = await asUser(CLIENT_A1, (c) =>
      c.query(
        'insert into public.chat_acknowledgments (user_id, peer_id) values ($1, $2) returning user_id',
        [COACH_B_ID, COACH_A.sub], // forge user_id = Coach B
      ),
    );
    expect(r.rows[0].user_id).toBe(CLIENT_A1.sub); // not the forged COACH_B_ID
  });

  it('acknowledgments are own-only: the peer and anon cannot read them', async () => {
    const c = await pool.connect();
    try {
      await c.query('begin');
      await c.query('set local role authenticated');
      await c.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: CLIENT_A1.sub, role: 'authenticated', user_role: 'client' }),
      ]);
      await c.query('insert into public.chat_acknowledgments (peer_id) values ($1)', [COACH_A.sub]);
      const own = await c.query('select peer_id from public.chat_acknowledgments');
      // The peer (Coach A) is not the owner → own-only policy hides it.
      await c.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: COACH_A.sub, role: 'authenticated', user_role: 'coach' }),
      ]);
      const peer = await c.query('select peer_id from public.chat_acknowledgments');
      await c.query('reset role');
      await c.query('set local role anon');
      await c.query("select set_config('request.jwt.claims', '{}', true)");
      const anon = await c.query('select peer_id from public.chat_acknowledgments');
      expect(own.rows.length).toBeGreaterThanOrEqual(1);
      expect(peer.rows).toHaveLength(0);
      expect(anon.rows).toHaveLength(0);
    } finally {
      await c.query('rollback').catch(() => {});
      c.release();
    }
  });

  it('a client cannot UPDATE or DELETE an acknowledgment (append-only; not granted)', async () => {
    await expect(
      asUser(CLIENT_A1, (c) => c.query('update public.chat_acknowledgments set accepted_at = now()')),
    ).rejects.toThrow();
    await expect(
      asUser(CLIENT_A1, (c) => c.query('delete from public.chat_acknowledgments')),
    ).rejects.toThrow();
  });
});

describe('device tokens (0040, Phase 17 Slice 2) — push registry, owner-only, server-forced owner (§2)', () => {
  const CLIENT_A2_ID: Identity = { sub: CLIENT_A2, userRole: 'client' };
  const TOKEN_A1 = 'ExponentPushToken[a1-device-aaaaaaaaaaaa]';
  const TOKEN_SHARED = 'ExponentPushToken[shared-device-bbbbbbbb]';

  // The harness ROLLS BACK every asUser/asService call, so a token registered in one
  // call never persists into the next. The cross-identity cases below therefore
  // register AND assert inside ONE transaction, switching role + JWT claims inline
  // (the pattern used by the mark_read / chat_acknowledgments cases above).
  type TestClient = Awaited<ReturnType<typeof pool.connect>>;
  async function actAs(c: TestClient, who: Identity | 'anon' | 'service'): Promise<void> {
    await c.query('reset role');
    if (who === 'service') {
      await c.query('set local role service_role');
      await c.query("select set_config('request.jwt.claims', '{}', true)");
    } else if (who === 'anon') {
      await c.query('set local role anon');
      await c.query("select set_config('request.jwt.claims', '{}', true)");
    } else {
      await c.query('set local role authenticated');
      await c.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: who.sub, role: 'authenticated', user_role: who.userRole }),
      ]);
    }
  }

  // ── registration is a server-forced upsert (user_id is always auth.uid()) ────
  it('register_device_token stamps the caller as owner — the client never supplies a user_id', async () => {
    const r = await asUser(CLIENT_A1, async (c) => {
      await c.query('select public.register_device_token($1, $2)', [TOKEN_A1, 'android']);
      return c.query('select user_id, platform from public.device_tokens where token = $1', [TOKEN_A1]);
    });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].user_id).toBe(CLIENT_A1.sub);
    expect(r.rows[0].platform).toBe('android');
  });

  it('register_device_token rejects an invalid platform / empty token / bad locale', async () => {
    await expect(
      asUser(CLIENT_A1, (c) => c.query('select public.register_device_token($1, $2)', [TOKEN_A1, 'desktop'])),
    ).rejects.toThrow();
    await expect(
      asUser(CLIENT_A1, (c) => c.query('select public.register_device_token($1, $2)', ['', 'android'])),
    ).rejects.toThrow();
    await expect(
      asUser(CLIENT_A1, (c) => c.query('select public.register_device_token($1, $2, $3)', [TOKEN_A1, 'android', 'fr'])),
    ).rejects.toThrow();
  });

  it('anon cannot register a token (execute revoked from anon)', async () => {
    await expect(
      asAnon((c) => c.query('select public.register_device_token($1, $2)', [TOKEN_A1, 'android'])),
    ).rejects.toThrow();
  });

  it('a client cannot directly INSERT or UPDATE a token (registration is the RPC only)', async () => {
    await expect(
      asUser(CLIENT_A1, (c) =>
        c.query("insert into public.device_tokens (token, user_id, platform) values ($1, $2, 'android')", [
          'ExponentPushToken[forged-cccc]',
          CLIENT_A1.sub,
        ]),
      ),
    ).rejects.toThrow();
    await expect(
      asUser(CLIENT_A1, (c) => c.query("update public.device_tokens set platform = 'web' where token = $1", [TOKEN_A1])),
    ).rejects.toThrow();
  });

  // ── feed RLS: tokens are private to their owner; not even the assigned coach ──
  it('an owner reads only their own tokens; another tenant, the coach, and anon see nothing', async () => {
    const c = await pool.connect();
    try {
      await c.query('begin');
      await actAs(c, CLIENT_A1);
      await c.query('select public.register_device_token($1, $2, $3)', [TOKEN_A1, 'android', 'en']);
      const owner = await c.query('select token from public.device_tokens');
      await actAs(c, CLIENT_A2_ID);
      const otherClient = await c.query('select token from public.device_tokens');
      await actAs(c, COACH_A);
      const coach = await c.query('select token from public.device_tokens');
      await actAs(c, 'anon');
      const anon = await c.query('select token from public.device_tokens');
      expect(owner.rows.some((r) => r.token === TOKEN_A1)).toBe(true);
      expect(otherClient.rows).toHaveLength(0);
      expect(coach.rows).toHaveLength(0); // raw tokens never leak, even to the coach
      expect(anon.rows).toHaveLength(0);
    } finally {
      await c.query('rollback').catch(() => {});
      c.release();
    }
  });

  // ── the same owner re-registering updates platform/locale (idempotent upsert) ──
  it('the same owner re-registering a token updates platform/locale', async () => {
    const c = await pool.connect();
    try {
      await c.query('begin');
      await actAs(c, CLIENT_A1);
      await c.query('select public.register_device_token($1, $2, $3)', [TOKEN_A1, 'android', 'en']);
      await c.query('select public.register_device_token($1, $2, $3)', [TOKEN_A1, 'ios', 'ar']);
      await actAs(c, 'service');
      const row = await c.query(
        'select user_id, platform, locale from public.device_tokens where token = $1',
        [TOKEN_A1],
      );
      expect(row.rows).toHaveLength(1);
      expect(row.rows[0].user_id).toBe(CLIENT_A1.sub);
      expect(row.rows[0].platform).toBe('ios');
      expect(row.rows[0].locale).toBe('ar');
    } finally {
      await c.query('rollback').catch(() => {});
      c.release();
    }
  });

  // ── H-3: a token owned by another user is NOT reassigned (push-token hijack block) ─
  it('re-registering a token owned by another user does NOT reassign it (H-3)', async () => {
    const c = await pool.connect();
    try {
      await c.query('begin');
      await actAs(c, CLIENT_A1);
      await c.query('select public.register_device_token($1, $2, $3)', [TOKEN_SHARED, 'android', 'en']);
      // CLIENT_A2 (an attacker who learned the token string) tries to claim it.
      await actAs(c, CLIENT_A2_ID);
      await c.query('select public.register_device_token($1, $2, $3)', [TOKEN_SHARED, 'ios', 'ar']);
      // Ownership is unchanged: still CLIENT_A1, still android/en (the hijack no-ops).
      await actAs(c, 'service');
      const row = await c.query(
        'select user_id, platform, locale from public.device_tokens where token = $1',
        [TOKEN_SHARED],
      );
      expect(row.rows).toHaveLength(1);
      expect(row.rows[0].user_id).toBe(CLIENT_A1.sub);
      expect(row.rows[0].platform).toBe('android');
      expect(row.rows[0].locale).toBe('en');
      // The original owner still sees their token; the attacker sees nothing.
      await actAs(c, CLIENT_A1);
      const a1 = await c.query('select token from public.device_tokens where token = $1', [TOKEN_SHARED]);
      await actAs(c, CLIENT_A2_ID);
      const a2 = await c.query('select token from public.device_tokens where token = $1', [TOKEN_SHARED]);
      expect(a1.rows).toHaveLength(1); // owner keeps it
      expect(a2.rows).toHaveLength(0); // attacker cannot see or claim it
    } finally {
      await c.query('rollback').catch(() => {});
      c.release();
    }
  });

  it('an owner can delete their own token; a non-owner delete affects nothing', async () => {
    const c = await pool.connect();
    try {
      await c.query('begin');
      await actAs(c, CLIENT_A1);
      await c.query('select public.register_device_token($1, $2, $3)', [TOKEN_A1, 'android', 'en']);
      // A2 is not the owner — the owner-scoped delete policy hits 0 rows.
      await actAs(c, CLIENT_A2_ID);
      const cross = await c.query('delete from public.device_tokens where token = $1', [TOKEN_A1]);
      // The owner can delete it.
      await actAs(c, CLIENT_A1);
      const own = await c.query('delete from public.device_tokens where token = $1', [TOKEN_A1]);
      expect(cross.rowCount).toBe(0);
      expect(own.rowCount).toBe(1);
    } finally {
      await c.query('rollback').catch(() => {});
      c.release();
    }
  });

  it('service_role reads every token (the fan-out path)', async () => {
    const c = await pool.connect();
    try {
      await c.query('begin');
      await actAs(c, CLIENT_A1);
      await c.query('select public.register_device_token($1, $2, $3)', [TOKEN_A1, 'android', 'en']);
      await actAs(c, 'service');
      const all = await c.query('select token from public.device_tokens');
      expect(all.rows.length).toBeGreaterThanOrEqual(1);
    } finally {
      await c.query('rollback').catch(() => {});
      c.release();
    }
  });
});

describe('app achievements (0073, E1) — minted trophies, owner-only raw read, public RPC (§2)', () => {
  const CLIENT_A2_ID: Identity = { sub: CLIENT_A2, userRole: 'client' };
  type TC = Awaited<ReturnType<typeof pool.connect>>;
  async function actAs(c: TC, who: Identity | 'anon' | 'service'): Promise<void> {
    await c.query('reset role');
    if (who === 'service') {
      await c.query('set local role service_role');
      await c.query("select set_config('request.jwt.claims', '{}', true)");
    } else if (who === 'anon') {
      await c.query('set local role anon');
      await c.query("select set_config('request.jwt.claims', '{}', true)");
    } else {
      await c.query('set local role authenticated');
      await c.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: who.sub, role: 'authenticated', user_role: who.userRole }),
      ]);
    }
  }

  it('minting is service-role only — clients cannot mint or write the table directly', async () => {
    await expect(
      asUser(CLIENT_A1, (c) => c.query("select public.mint_achievement($1, 'first_workout')", [CLIENT_A1.sub])),
    ).rejects.toThrow();
    await expect(
      asAnon((c) => c.query("select public.mint_achievement($1, 'first_workout')", [CLIENT_A1.sub])),
    ).rejects.toThrow();
    await expect(
      asUser(CLIENT_A1, (c) =>
        c.query("insert into public.app_achievements (user_id, achievement_key) values ($1, 'forged')", [CLIENT_A1.sub]),
      ),
    ).rejects.toThrow();
  });

  it('a user reads only their own raw trophies; another tenant and anon see none', async () => {
    const c = await pool.connect();
    try {
      await c.query('begin');
      await actAs(c, 'service');
      await c.query("select public.mint_achievement($1, 'workouts_10')", [CLIENT_A1.sub]);
      await actAs(c, CLIENT_A1);
      const owner = await c.query('select user_id, achievement_key from public.app_achievements');
      await actAs(c, CLIENT_A2_ID);
      const other = await c.query('select user_id from public.app_achievements');
      await actAs(c, 'anon');
      const anon = await c.query('select user_id from public.app_achievements');
      // Owner sees their own minted trophy.
      expect(owner.rows.some((r) => r.achievement_key === 'workouts_10' && r.user_id === CLIENT_A1.sub)).toBe(true);
      // Cross-tenant isolation: A2 may have their OWN auto-minted trophies (the 0073
      // completion trigger fires on seeded workouts), but NEVER A1's rows (RLS is
      // user_id = auth.uid()); anon sees nothing.
      expect(other.rows.some((r) => r.user_id === CLIENT_A1.sub)).toBe(false);
      expect(other.rows.every((r) => r.user_id === CLIENT_A2)).toBe(true);
      expect(anon.rows).toHaveLength(0);
    } finally {
      await c.query('rollback').catch(() => {});
      c.release();
    }
  });

  it('get_public_app_achievements: public shows non-body trophies; body-derived gated behind the share toggle', async () => {
    const c = await pool.connect();
    try {
      await c.query('begin');
      await actAs(c, 'service');
      await c.query("select public.mint_achievement($1, 'workouts_50')", [CLIENT_A1.sub]); // non-body
      await c.query("select public.mint_achievement($1, 'body_fat_drop_5')", [CLIENT_A1.sub]); // body-derived
      await c.query(
        'update public.athlete_profile set is_public = false, share_body_metrics_publicly = false where user_id = $1',
        [CLIENT_A1.sub],
      );
      await actAs(c, CLIENT_A2_ID);
      const whenPrivate = await c.query('select achievement_key from public.get_public_app_achievements($1)', [CLIENT_A1.sub]);
      await actAs(c, 'service');
      await c.query('update public.athlete_profile set is_public = true where user_id = $1', [CLIENT_A1.sub]);
      await actAs(c, CLIENT_A2_ID);
      const publicNoShare = await c.query('select achievement_key from public.get_public_app_achievements($1)', [CLIENT_A1.sub]);
      await actAs(c, 'service');
      await c.query('update public.athlete_profile set share_body_metrics_publicly = true where user_id = $1', [CLIENT_A1.sub]);
      await actAs(c, CLIENT_A2_ID);
      const publicShare = await c.query('select achievement_key from public.get_public_app_achievements($1)', [CLIENT_A1.sub]);

      const keys = (r: { rows: { achievement_key: string }[] }) => r.rows.map((x) => x.achievement_key);
      expect(whenPrivate.rows).toHaveLength(0); // private profile → nothing public
      expect(keys(publicNoShare)).toContain('workouts_50'); // non-body shown when public
      expect(keys(publicNoShare)).not.toContain('body_fat_drop_5'); // body-derived hidden without share toggle
      expect(keys(publicShare)).toContain('workouts_50');
      expect(keys(publicShare)).toContain('body_fat_drop_5'); // now shown
    } finally {
      await c.query('rollback').catch(() => {});
      c.release();
    }
  });

  it('anon cannot call the public achievements RPC (execute revoked from anon)', async () => {
    await expect(
      asAnon((c) => c.query('select * from public.get_public_app_achievements($1)', [CLIENT_A1.sub])),
    ).rejects.toThrow();
  });

  it('client_goal_progress is INTERNAL — authenticated and anon cannot call it', async () => {
    await expect(
      asUser(CLIENT_A1, (c) => c.query('select public.client_goal_progress($1)', [CLIENT_A1.sub])),
    ).rejects.toThrow();
    await expect(
      asAnon((c) => c.query('select public.client_goal_progress($1)', [CLIENT_A1.sub])),
    ).rejects.toThrow();
  });
});

describe('coach transformations (0077, E3) — coach-curated, consent-gated showcase (§2)', () => {
  it('a coach features only their OWN client; not another coach’s, and cannot forge ownership', async () => {
    const ok = await asUser(COACH_A, (c) =>
      c.query("insert into public.coach_transformations (coach_id, client_id, caption) values ($1, $2, '16 weeks')", [COACH_A.sub, CLIENT_A1.sub]),
    );
    expect(ok.rowCount).toBe(1);
    await expect(
      asUser(COACH_A, (c) => c.query('insert into public.coach_transformations (coach_id, client_id) values ($1, $2)', [COACH_A.sub, CLIENT_B1])),
    ).rejects.toThrow(); // not COACH_A's client
    await expect(
      asUser(COACH_A, (c) => c.query('insert into public.coach_transformations (coach_id, client_id) values ($1, $2)', [COACH_B_ID, CLIENT_A1.sub])),
    ).rejects.toThrow(); // can't forge another coach's row
  });

  it('the featured client reads rows about them; another tenant and anon see none', async () => {
    const c = await pool.connect();
    try {
      await c.query('begin');
      await c.query('set local role service_role');
      await c.query("select set_config('request.jwt.claims', '{}', true)");
      await c.query('insert into public.coach_transformations (coach_id, client_id) values ($1, $2)', [COACH_A.sub, CLIENT_A1.sub]);
      const asId = (id: string, role: string) => c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: id, role: 'authenticated', user_role: role })]);
      await c.query('reset role'); await c.query('set local role authenticated'); await asId(CLIENT_A1.sub, 'client');
      const a1 = await c.query('select id from public.coach_transformations');
      await c.query('reset role'); await c.query('set local role authenticated'); await asId(CLIENT_A2, 'client');
      const a2 = await c.query('select id from public.coach_transformations');
      await c.query('reset role'); await c.query('set local role anon'); await c.query("select set_config('request.jwt.claims', '{}', true)");
      const anon = await c.query('select id from public.coach_transformations');
      expect(a1.rows.length).toBeGreaterThanOrEqual(1);
      expect(a2.rows).toHaveLength(0);
      expect(anon.rows).toHaveLength(0);
    } finally {
      await c.query('rollback').catch(() => {});
      c.release();
    }
  });

  it('anon cannot call get_coach_transformations (execute revoked from anon)', async () => {
    await expect(asAnon((c) => c.query('select * from public.get_coach_transformations($1)', [COACH_A.sub]))).rejects.toThrow();
  });

  it('anon cannot call get_athlete_transformations either (0086 — execute revoked from anon)', async () => {
    await expect(asAnon((c) => c.query('select * from public.get_athlete_transformations($1)', [CLIENT_A1.sub]))).rejects.toThrow();
  });
});

describe('transformation submissions (0084) — client→coach, coach-approves (§2)', () => {
  it('a client submits for THEMSELVES to THEIR coach; not a different coach, not another client', async () => {
    const ok = await asUser(CLIENT_A1, (c) =>
      c.query("insert into public.transformation_submissions (client_id, coach_id, caption, status) values ($1, $2, '12 weeks', 'pending')", [CLIENT_A1.sub, COACH_A.sub]),
    );
    expect(ok.rowCount).toBe(1);
    await expect(
      asUser(CLIENT_A1, (c) => c.query("insert into public.transformation_submissions (client_id, coach_id, status) values ($1, $2, 'pending')", [CLIENT_A1.sub, COACH_B_ID])),
    ).rejects.toThrow(); // coach_id must equal my_coach_id()
    await expect(
      asUser(CLIENT_A1, (c) => c.query("insert into public.transformation_submissions (client_id, coach_id, status) values ($1, $2, 'pending')", [CLIENT_B1, COACH_A.sub])),
    ).rejects.toThrow(); // can't submit on behalf of another client
  });

  it('the coach reads submissions addressed to them; another tenant and anon see none', async () => {
    const c = await pool.connect();
    try {
      await c.query('begin');
      await c.query('set local role service_role');
      await c.query("select set_config('request.jwt.claims', '{}', true)");
      await c.query("insert into public.transformation_submissions (client_id, coach_id, status) values ($1, $2, 'pending')", [CLIENT_A1.sub, COACH_A.sub]);
      const asId = (id: string, role: string) => c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: id, role: 'authenticated', user_role: role })]);
      await c.query('reset role'); await c.query('set local role authenticated'); await asId(COACH_A.sub, 'coach');
      const coach = await c.query('select id from public.transformation_submissions');
      await c.query('reset role'); await c.query('set local role authenticated'); await asId(COACH_B_ID, 'coach');
      const otherCoach = await c.query('select id from public.transformation_submissions');
      await c.query('reset role'); await c.query('set local role authenticated'); await asId(CLIENT_B1, 'client');
      const otherClient = await c.query('select id from public.transformation_submissions');
      await c.query('reset role'); await c.query('set local role anon'); await c.query("select set_config('request.jwt.claims', '{}', true)");
      const anon = await c.query('select id from public.transformation_submissions');
      expect(coach.rows.length).toBeGreaterThanOrEqual(1);
      expect(otherCoach.rows).toHaveLength(0);
      expect(otherClient.rows).toHaveLength(0);
      expect(anon.rows).toHaveLength(0);
    } finally {
      await c.query('rollback').catch(() => {});
      c.release();
    }
  });

  it('resolve_transformation_submission is coach-fenced: a foreign coach cannot approve; the owning coach can', async () => {
    const c = await pool.connect();
    try {
      await c.query('begin');
      await c.query('set local role service_role');
      await c.query("select set_config('request.jwt.claims', '{}', true)");
      const ins = await c.query("insert into public.transformation_submissions (client_id, coach_id, status) values ($1, $2, 'pending') returning id", [CLIENT_A1.sub, COACH_A.sub]);
      const subId = ins.rows[0].id as string;
      const asId = (id: string, role: string) => c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: id, role: 'authenticated', user_role: role })]);
      // A coach who isn't the addressee can't resolve it. The raise aborts the txn, so
      // wrap it in a SAVEPOINT and roll back to it to keep the connection usable.
      await c.query('reset role'); await c.query('set local role authenticated'); await asId(COACH_B_ID, 'coach');
      await c.query('savepoint sp_foreign');
      await expect(c.query('select public.resolve_transformation_submission($1, $2)', [subId, 'approve'])).rejects.toThrow();
      await c.query('rollback to savepoint sp_foreign');
      // The owning coach approves → it becomes a featured coach_transformations row and flips to approved.
      await c.query('reset role'); await c.query('set local role authenticated'); await asId(COACH_A.sub, 'coach');
      await c.query('select public.resolve_transformation_submission($1, $2)', [subId, 'approve']);
      await c.query('reset role'); await c.query('set local role service_role'); await c.query("select set_config('request.jwt.claims', '{}', true)");
      const sub = await c.query('select status from public.transformation_submissions where id = $1', [subId]);
      const feat = await c.query('select id from public.coach_transformations where coach_id = $1 and client_id = $2', [COACH_A.sub, CLIENT_A1.sub]);
      expect(sub.rows[0].status).toBe('approved');
      expect(feat.rows.length).toBeGreaterThanOrEqual(1);
    } finally {
      await c.query('rollback').catch(() => {});
      c.release();
    }
  });
});

describe('voice notes (0043, Phase 18) — audio media readable by chat participants (§2/§7/§8)', () => {
  const ADMIN: Identity = { sub: 'dddddddd-dddd-dddd-dddd-dddddddddddd', userRole: 'admin' };
  const COACH_B: Identity = { sub: COACH_B_ID, userRole: 'coach' };
  const CLIENT_A2_ID: Identity = { sub: CLIENT_A2, userRole: 'client' };
  const CLIENT_B1_ID: Identity = { sub: CLIENT_B1, userRole: 'client' };
  const VOICE_MEDIA = 'ed000002-0000-0000-0000-000000000002'; // Coach A's voice note → A1

  // ── the new participant read path (the crux of coach→client voice notes) ────
  it('the recipient reads the sender-owned voice media via the message-participant path', async () => {
    // Client A1 is neither the owner (Coach A) nor the owner's coach nor admin — they
    // can read it ONLY because they are a party to a message that references it.
    const recipient = await asUser(CLIENT_A1, (c) =>
      c.query('select id from public.media where id = $1', [VOICE_MEDIA]),
    );
    expect(recipient.rows).toHaveLength(1);
  });

  it('the owner (sender) and an admin read it too', async () => {
    const owner = await asUser(COACH_A, (c) =>
      c.query('select id from public.media where id = $1', [VOICE_MEDIA]),
    );
    const admin = await asUser(ADMIN, (c) =>
      c.query('select id from public.media where id = $1', [VOICE_MEDIA]),
    );
    expect(owner.rows).toHaveLength(1);
    expect(admin.rows).toHaveLength(1);
  });

  it('non-participants — another tenant AND the same coach’s other client — cannot read it; nor can anon', async () => {
    const coachB = await asUser(COACH_B, (c) => c.query('select id from public.media where id = $1', [VOICE_MEDIA]));
    const clientB1 = await asUser(CLIENT_B1_ID, (c) => c.query('select id from public.media where id = $1', [VOICE_MEDIA]));
    // A2 shares Coach A but is NOT a party to the A↔A1 message → no access.
    const clientA2 = await asUser(CLIENT_A2_ID, (c) => c.query('select id from public.media where id = $1', [VOICE_MEDIA]));
    const anon = await asAnon((c) => c.query('select id from public.media where id = $1', [VOICE_MEDIA]));
    expect(coachB.rows).toHaveLength(0);
    expect(clientB1.rows).toHaveLength(0);
    expect(clientA2.rows).toHaveLength(0);
    expect(anon.rows).toHaveLength(0);
  });

  // ── body-less (voice-only) message constraint ───────────────────────────────
  it('a message may have an empty body ONLY when it carries media', async () => {
    // Empty body + no media → rejected by messages_body_check.
    await expect(
      asUser(COACH_A, (c) =>
        c.query('insert into public.messages (recipient_id, body) values ($1, $2)', [CLIENT_A1.sub, '']),
      ),
    ).rejects.toThrow();
    // Empty body + a media id the sender owns → allowed (a voice note).
    const ok = await asUser(COACH_A, (c) =>
      c.query('insert into public.messages (recipient_id, body, media_id) values ($1, $2, $3) returning id', [
        CLIENT_A1.sub,
        '',
        VOICE_MEDIA,
      ]),
    );
    expect(ok.rowCount).toBe(1);
  });
});

describe('public profiles (0044, Phase 19) — opt-in portfolio via field-allowlist RPCs (§2)', () => {
  const ADMIN: Identity = { sub: 'dddddddd-dddd-dddd-dddd-dddddddddddd', userRole: 'admin' };
  const COACH_B: Identity = { sub: COACH_B_ID, userRole: 'coach' };
  const CLIENT_B1_ID: Identity = { sub: CLIENT_B1, userRole: 'client' };
  const COACH_P: Identity = { sub: 'c0c0c0c0-0000-0000-0000-000000000001', userRole: 'coach' }; // private coach
  const COACH_A_AVATAR = 'a0a70001-0000-0000-0000-000000000001'; // public Coach A's avatar
  const A1_AVATAR = 'a0a70002-0000-0000-0000-000000000002'; // public Client A1's avatar
  const COACH_P_AVATAR = 'a0a70003-0000-0000-0000-000000000003'; // private Coach P's avatar

  // ── The raw tables get NO new read path — the public surface is RPC-only ─────
  it('a public profile does NOT widen the raw coach_profile/athlete_profile RLS', async () => {
    // Coach A is public, but an unrelated coach still cannot read the RAW row (the
    // sensitive columns) — only the allowlisted RPC is reachable. Defense in depth.
    const rawCoach = await asUser(COACH_B, (c) =>
      c.query('select user_id from public.coach_profile where user_id = $1', [COACH_A.sub]),
    );
    const rawAthlete = await asUser(COACH_B, (c) =>
      c.query('select user_id from public.athlete_profile where user_id = $1', [CLIENT_A1.sub]),
    );
    expect(rawCoach.rows).toHaveLength(0);
    expect(rawAthlete.rows).toHaveLength(0);
  });

  // ── get_public_coach_profile: public → allowlist; private → 0 (owner previews) ──
  it('any authenticated user reads a PUBLIC coach portfolio (allowlisted columns)', async () => {
    const r = await asUser(CLIENT_B1_ID, (c) =>
      c.query('select * from public.get_public_coach_profile($1)', [COACH_A.sub]),
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].full_name).toBe('Coach A');
    expect(r.rows[0].achievements).toContain('NASM-CPT');
    expect(r.rows[0].avatar_media_id).toBe(COACH_A_AVATAR);
    // The allowlist is the column set — sensitive/foreign columns simply aren't there.
    // (Enriched by 0070/0079: handle + verified outcomes + coaching_philosophy/featured.)
    expect(Object.keys(r.rows[0]).sort()).toEqual(
      [
        'accepting_clients', 'achievements', 'active_roster_count', 'avatar_media_id', 'bio',
        'certifications', 'coach_id', 'coaching_philosophy', 'featured_template_id', 'full_name',
        'handle', 'median_goal_progress', 'specialties', 'years_experience',
      ].sort(),
    );
  });

  it('a PRIVATE coach portfolio returns 0 rows to outsiders, but the owner may preview it', async () => {
    const outsider = await asUser(COACH_A, (c) =>
      c.query('select coach_id from public.get_public_coach_profile($1)', [COACH_P.sub]),
    );
    const owner = await asUser(COACH_P, (c) =>
      c.query('select coach_id from public.get_public_coach_profile($1)', [COACH_P.sub]),
    );
    expect(outsider.rows).toHaveLength(0);
    expect(owner.rows).toHaveLength(1); // own-preview branch
  });

  // ── get_public_athlete_profile: MINIMAL allowlist; NEVER sensitive health columns ──
  it('a PUBLIC athlete profile exposes only the minimal allowlist (no birth_date/height/sex/injuries)', async () => {
    const r = await asUser(COACH_B, (c) =>
      c.query('select * from public.get_public_athlete_profile($1)', [CLIENT_A1.sub]),
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].full_name).toBe('Client A1');
    expect(r.rows[0].primary_goal).toBe('build_muscle');
    expect(r.rows[0].public_achievements).toContain('Down 5kg in 12 weeks');
    const cols = Object.keys(r.rows[0]);
    // Enriched by 0075 (E2): coach link + opt-in body-metrics/FFMI/streak/PRs. Body-metrics
    // fields are gated by share_body_metrics (null otherwise); raw PII is still never exposed.
    expect(cols.sort()).toEqual(
      [
        'athlete_id', 'full_name', 'handle', 'avatar_media_id', 'primary_goal', 'public_achievements',
        'current_streak', 'workouts_last_30d', 'training_days', 'top_prs', 'coach_id', 'coach_name',
        'coach_avatar_media_id', 'share_body_metrics', 'has_transformation', 'baseline_at', 'latest_at',
        'body_fat_delta_bp', 'lean_mass_delta_grams', 'ffmi_latest', 'ffmi_tier', 'target_weight_grams',
        'latest_weight_grams', 'body_metrics_series',
      ].sort(),
    );
    // Raw sensitive PII can never be returned by this RPC.
    for (const banned of ['birth_date', 'height_cm', 'injuries_notes', 'sex']) {
      expect(cols).not.toContain(banned);
    }
    // A1 has NOT opted into public body metrics (and the viewer isn't A1) → gated fields null.
    expect(r.rows[0].share_body_metrics).toBe(false);
    expect(r.rows[0].latest_weight_grams).toBeNull();
    expect(r.rows[0].target_weight_grams).toBeNull();
    expect(r.rows[0].body_fat_delta_bp).toBeNull();
    expect(r.rows[0].body_metrics_series).toBeNull();
  });

  it('a PRIVATE athlete profile returns 0 rows to outsiders', async () => {
    const r = await asUser(COACH_A, (c) =>
      c.query('select athlete_id from public.get_public_athlete_profile($1)', [CLIENT_B1]),
    );
    expect(r.rows).toHaveLength(0); // B1's athlete profile is_public = false
  });

  // ── list_public_coaches: includes public coaches, EXCLUDES private ones ───────
  it('list_public_coaches lists the public coach and never a private one', async () => {
    const r = await asUser(CLIENT_A1, (c) =>
      c.query('select coach_id from public.list_public_coaches(null, 50, 0)'),
    );
    const ids = r.rows.map((row) => row.coach_id);
    expect(ids).toContain(COACH_A.sub);
    expect(ids).not.toContain(COACH_P.sub); // private coach excluded by is_public filter
  });

  it('list_public_coaches filters by specialty (case-insensitive)', async () => {
    const hit = await asUser(CLIENT_A1, (c) =>
      c.query("select coach_id from public.list_public_coaches('HYPERTROPHY', 50, 0)"),
    );
    const miss = await asUser(CLIENT_A1, (c) =>
      c.query("select coach_id from public.list_public_coaches('nonexistent-specialty', 50, 0)"),
    );
    expect(hit.rows.map((r) => r.coach_id)).toContain(COACH_A.sub);
    expect(miss.rows).toHaveLength(0);
  });

  // ── coach_public_highlights: AGGREGATE proof, never any client identifier ─────
  it('coach_public_highlights returns aggregate goal stats with NO client ids', async () => {
    const r = await asUser(CLIENT_B1_ID, (c) =>
      c.query('select * from public.coach_public_highlights($1)', [COACH_A.sub]),
    );
    expect(r.rows.length).toBeGreaterThanOrEqual(1);
    // The shape is aggregate-only — there is structurally no client identifier column.
    const cols = Object.keys(r.rows[0]);
    expect(cols.sort()).toEqual(['client_count', 'improved', 'median_progress', 'primary_goal', 'with_progress'].sort());
    for (const banned of ['client_id', 'user_id', 'full_name', 'id']) {
      expect(cols).not.toContain(banned);
    }
    // Coach A's build_muscle client (A1) has 2 verified readings trending well → improved.
    const muscle = r.rows.find((row) => row.primary_goal === 'build_muscle');
    expect(muscle.client_count).toBe(1);
    expect(muscle.with_progress).toBe(1);
    expect(muscle.improved).toBe(1);
  });

  it('coach_public_highlights returns 0 rows for a PRIVATE coach (to an outsider)', async () => {
    const r = await asUser(COACH_A, (c) =>
      c.query('select * from public.coach_public_highlights($1)', [COACH_P.sub]),
    );
    expect(r.rows).toHaveLength(0);
  });

  // ── all four RPCs are authenticated-only — anon cannot execute them ───────────
  it('anon cannot execute any public-profile RPC (no execute grant)', async () => {
    await expect(
      asAnon((c) => c.query('select * from public.get_public_coach_profile($1)', [COACH_A.sub])),
    ).rejects.toThrow();
    await expect(
      asAnon((c) => c.query('select * from public.get_public_athlete_profile($1)', [CLIENT_A1.sub])),
    ).rejects.toThrow();
    await expect(
      asAnon((c) => c.query('select * from public.list_public_coaches(null, 50, 0)')),
    ).rejects.toThrow();
    await expect(
      asAnon((c) => c.query('select * from public.coach_public_highlights($1)', [COACH_A.sub])),
    ).rejects.toThrow();
  });

  // ── avatar media branch: a PUBLIC owner's avatar is readable by any authed user;
  //    a PRIVATE owner's avatar is not. Covers both arms of is_public_profile() ──
  it('a PUBLIC profile’s avatar media is readable by an unrelated authenticated user', async () => {
    // Coach A (public coach) and Client A1 (public athlete) avatars — read by an
    // outsider (Client B1), proving both the coach_profile and athlete_profile arms.
    const coachAvatar = await asUser(CLIENT_B1_ID, (c) =>
      c.query('select id from public.media where id = $1', [COACH_A_AVATAR]),
    );
    const athleteAvatar = await asUser(COACH_B, (c) =>
      c.query('select id from public.media where id = $1', [A1_AVATAR]),
    );
    expect(coachAvatar.rows).toHaveLength(1);
    expect(athleteAvatar.rows).toHaveLength(1);
  });

  it('a PRIVATE profile’s avatar media is NOT readable by outsiders (but the owner + admin read it)', async () => {
    const outsider = await asUser(COACH_A, (c) =>
      c.query('select id from public.media where id = $1', [COACH_P_AVATAR]),
    );
    const anon = await asAnon((c) => c.query('select id from public.media where id = $1', [COACH_P_AVATAR]));
    const owner = await asUser(COACH_P, (c) =>
      c.query('select id from public.media where id = $1', [COACH_P_AVATAR]),
    );
    const admin = await asUser(ADMIN, (c) =>
      c.query('select id from public.media where id = $1', [COACH_P_AVATAR]),
    );
    expect(outsider.rows).toHaveLength(0);
    expect(anon.rows).toHaveLength(0);
    expect(owner.rows).toHaveLength(1);
    expect(admin.rows).toHaveLength(1);
  });

  // ── avatar_media_id immutability: you can only point at your OWN avatar media ──
  it('a user cannot set avatar_media_id to someone else’s media row', async () => {
    // Client A1 trying to claim Coach A's avatar as their own → ownership trigger rejects.
    await expect(
      asUser(CLIENT_A1, (c) =>
        c.query('update public.profiles set avatar_media_id = $1 where id = $2', [COACH_A_AVATAR, CLIENT_A1.sub]),
      ),
    ).rejects.toThrow();
  });
});

describe('public leaderboards (0045, Phase 20) — opt-in physique/outcomes boards via field-allowlist RPCs (§2)', () => {
  const COACH_B: Identity = { sub: COACH_B_ID, userRole: 'coach' };
  const COACH_P: Identity = { sub: 'c0c0c0c0-0000-0000-0000-000000000001', userRole: 'coach' }; // private coach
  const COACH_L = '1ea00000-0000-0000-0000-0000000000c1'; // public + opted-in league coach
  const L1 = '1ea00000-0000-0000-0000-000000000001'; // male, opted-in, public → men's board
  const L2 = '1ea00000-0000-0000-0000-000000000002'; // female, opted-in, public → women's board
  const L3 = '1ea00000-0000-0000-0000-000000000003'; // male, opted-in, public → men's board
  const L4 = '1ea00000-0000-0000-0000-000000000004'; // male, public, NOT opted in → excluded
  const L5 = '1ea00000-0000-0000-0000-000000000005'; // female, opted-in, PRIVATE → excluded
  const L6 = '1ea00000-0000-0000-0000-000000000006'; // male, opted-in, public, BANNED → excluded

  // ── The board adds NO new read path to the raw body_metrics / athlete_profile ──
  it('the public board does NOT widen the raw body_metrics / athlete_profile RLS', async () => {
    // An unrelated coach still cannot read another cohort's raw rows — only the RPC is reachable.
    const rawMetrics = await asUser(COACH_B, (c) =>
      c.query('select id from public.body_metrics where user_id = $1', [L1]),
    );
    const rawProfile = await asUser(COACH_B, (c) =>
      c.query('select user_id from public.athlete_profile where user_id = $1', [L1]),
    );
    expect(rawMetrics.rows).toHaveLength(0);
    expect(rawProfile.rows).toHaveLength(0);
  });

  // ── public_athlete_leaderboard: allowlist + per-sex + every exclusion reason ──
  it('the men’s board returns opted-in public athletes, FFMI-ranked, with the allowlist only', async () => {
    const r = await asUser(COACH_B, (c) =>
      c.query("select * from public.public_athlete_leaderboard('male')"),
    );
    const ids = r.rows.map((row) => row.athlete_id);
    expect(ids).toContain(L1);
    expect(ids).toContain(L3);
    // L3 (FFMI ≈ 21.7) ranks above L1 (≈ 21.5).
    expect(ids.indexOf(L3)).toBeLessThan(ids.indexOf(L1));
    // The SELECT column list IS the allowlist — raw inputs (weight/body-fat/height/sex) absent.
    const cols = Object.keys(r.rows[0]);
    expect(cols.sort()).toEqual(['athlete_id', 'avatar_media_id', 'ffmi', 'full_name', 'handle', 'primary_goal'].sort());
    for (const banned of ['weight_grams', 'body_fat_bp', 'skeletal_muscle_mass_grams', 'height_cm', 'sex']) {
      expect(cols).not.toContain(banned);
    }
  });

  it('the men’s board excludes a private athlete, a not-opted-in athlete, a banned athlete, and women', async () => {
    const r = await asUser(COACH_B, (c) =>
      c.query("select athlete_id from public.public_athlete_leaderboard('male')"),
    );
    const ids = r.rows.map((row) => row.athlete_id);
    expect(ids).not.toContain(L4); // leaderboard_opt_in = false (even though public)
    expect(ids).not.toContain(L5); // is_public = false
    expect(ids).not.toContain(L6); // banned_at set
    expect(ids).not.toContain(L2); // female → not on the men's board
  });

  it('the women’s board returns the opted-in public female athlete and no men', async () => {
    const r = await asUser(COACH_B, (c) =>
      c.query("select athlete_id from public.public_athlete_leaderboard('female')"),
    );
    const ids = r.rows.map((row) => row.athlete_id);
    expect(ids).toContain(L2);
    expect(ids).not.toContain(L1); // male → not on the women's board
    expect(ids).not.toContain(L3);
    expect(ids).not.toContain(L5); // private female still excluded
  });

  // ── public_coach_leaderboard: counts only, opt-in/floor gated ─────────────────
  it('the coach board returns opted-in public coaches as AGGREGATE counts (no client ids)', async () => {
    const r = await asUser(COACH_B, (c) =>
      c.query('select * from public.public_coach_leaderboard()'),
    );
    const row = r.rows.find((x) => x.coach_id === COACH_L);
    expect(row).toBeTruthy();
    expect(row.tracked_clients).toBe(3);
    expect(row.improved_clients).toBe(3);
    // Aggregate-only shape — structurally no client identifier column.
    const cols = Object.keys(r.rows[0]);
    expect(cols.sort()).toEqual(['avatar_media_id', 'coach_id', 'full_name', 'improved_clients', 'median_goal_progress', 'tracked_clients'].sort());
    for (const banned of ['client_id', 'user_id']) {
      expect(cols).not.toContain(banned);
    }
  });

  it('the coach board excludes a public-but-not-opted-in coach and a private coach', async () => {
    const r = await asUser(COACH_B, (c) =>
      c.query('select coach_id from public.public_coach_leaderboard()'),
    );
    const ids = r.rows.map((row) => row.coach_id);
    expect(ids).not.toContain(COACH_A.sub); // public (Phase 19) but leaderboard_opt_in defaults false
    expect(ids).not.toContain(COACH_P.sub); // private coach
  });

  // ── both RPCs are authenticated-only — anon cannot execute them ───────────────
  it('anon cannot execute either leaderboard RPC (no execute grant)', async () => {
    await expect(
      asAnon((c) => c.query("select * from public.public_athlete_leaderboard('male')")),
    ).rejects.toThrow();
    await expect(
      asAnon((c) => c.query('select * from public.public_coach_leaderboard()')),
    ).rejects.toThrow();
  });
});

describe('leaderboard period window + self-rank (0052, Slice G1)', () => {
  const COACH_B: Identity = { sub: COACH_B_ID, userRole: 'coach' };
  const L1: Identity = { sub: '1ea00000-0000-0000-0000-000000000001', userRole: 'client' }; // recent reading, FFMI ≈ 21.5
  const L3: Identity = { sub: '1ea00000-0000-0000-0000-000000000003', userRole: 'client' }; // recent reading, FFMI ≈ 21.7
  const L4: Identity = { sub: '1ea00000-0000-0000-0000-000000000004', userRole: 'client' }; // recent reading but NOT opted in
  const L7: Identity = { sub: '1ea00000-0000-0000-0000-000000000007', userRole: 'client' }; // ONLY a 200-day-old reading

  // ── period window: an athlete with only an old reading drops off month/quarter ──
  it('the all-time board still includes an athlete whose only verified reading is 200 days old', async () => {
    const r = await asUser(COACH_B, (c) =>
      c.query("select athlete_id from public.public_athlete_leaderboard('male', 'all')"),
    );
    expect(r.rows.map((x) => x.athlete_id)).toContain(L7.sub);
  });

  it('the month and quarter windows drop the 200-day reading but keep the recent ones', async () => {
    const month = await asUser(COACH_B, (c) =>
      c.query("select athlete_id from public.public_athlete_leaderboard('male', 'month')"),
    );
    const quarter = await asUser(COACH_B, (c) =>
      c.query("select athlete_id from public.public_athlete_leaderboard('male', 'quarter')"),
    );
    expect(month.rows.map((x) => x.athlete_id)).not.toContain(L7.sub);
    expect(quarter.rows.map((x) => x.athlete_id)).not.toContain(L7.sub); // 200d > 90d
    // L1/L3 have a 5-day-old reading → present in every window.
    expect(month.rows.map((x) => x.athlete_id)).toEqual(expect.arrayContaining([L1.sub, L3.sub]));
  });

  // ── self-rank: returns ONLY the caller's own standing (their own data) ──────────
  it('public_athlete_my_rank gives the caller their exact rank + board size', async () => {
    const top = await asUser(L3, (c) => c.query("select * from public.public_athlete_my_rank('male', 'all')"));
    const mid = await asUser(L1, (c) => c.query("select * from public.public_athlete_my_rank('male', 'all')"));
    const low = await asUser(L7, (c) => c.query("select * from public.public_athlete_my_rank('male', 'all')"));
    expect(Number(top.rows[0].rank)).toBe(1);
    expect(Number(top.rows[0].total)).toBe(3); // {L1, L3, L7} are the only opted-in public males
    expect(Number(mid.rows[0].rank)).toBe(2);
    expect(Number(low.rows[0].rank)).toBe(3);
  });

  it('public_athlete_my_rank returns no row when the caller has no in-window reading', async () => {
    const r = await asUser(L7, (c) => c.query("select * from public.public_athlete_my_rank('male', 'month')"));
    expect(r.rows).toHaveLength(0);
  });

  // 0057: a verified-but-NOT-opted-in athlete (L4) gets NO self-rank — same gate as
  // the board — so they see the "opt in to compete" nudge instead of a bogus rank.
  it('public_athlete_my_rank returns no row for a verified athlete who has not opted in (0057)', async () => {
    const r = await asUser(L4, (c) => c.query("select * from public.public_athlete_my_rank('male', 'all')"));
    expect(r.rows).toHaveLength(0);
    // ...while an opted-in athlete with the same data still ranks.
    const opted = await asUser(L1, (c) => c.query("select * from public.public_athlete_my_rank('male', 'all')"));
    expect(Number(opted.rows[0].rank)).toBe(2);
  });

  it('anon cannot execute public_athlete_my_rank (no execute grant)', async () => {
    await expect(
      asAnon((c) => c.query("select * from public.public_athlete_my_rank('male', 'all')")),
    ).rejects.toThrow();
  });
});

describe('coach_requests (0053, Slice G2) — request-a-coach funnel (§2)', () => {
  const COACH_A: Identity = { sub: '11111111-1111-1111-1111-111111111111', userRole: 'coach' };
  const COACH_B: Identity = { sub: COACH_B_ID, userRole: 'coach' };
  const REQUESTER: Identity = { sub: CLIENT_B1, userRole: 'client' }; // requested Coach A
  const ADMIN: Identity = { sub: 'dddddddd-dddd-dddd-dddd-dddddddddddd', userRole: 'admin' };
  const REQ = 'c0a70000-0000-0000-0000-000000000001';

  // ── Read scoping: addressed coach / requesting client / admin only ──────────
  it('the addressed coach can read the request (with the snapshotted client_name)', async () => {
    const r = await asUser(COACH_A, (c) =>
      c.query('select id, client_name from public.coach_requests where id = $1', [REQ]),
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].client_name).toBe('Client B1');
  });

  it('the requesting client can read their own request', async () => {
    const r = await asUser(REQUESTER, (c) => c.query('select id from public.coach_requests where id = $1', [REQ]));
    expect(r.rows).toHaveLength(1);
  });

  it('a DIFFERENT coach cannot read a request addressed to another coach (cross-tenant)', async () => {
    const r = await asUser(COACH_B, (c) => c.query('select id from public.coach_requests where id = $1', [REQ]));
    expect(r.rows).toHaveLength(0);
  });

  it('an unrelated client cannot read the request', async () => {
    const r = await asUser(CLIENT_A1, (c) => c.query('select id from public.coach_requests where id = $1', [REQ]));
    expect(r.rows).toHaveLength(0);
  });

  it('an admin can read any request', async () => {
    const r = await asUser(ADMIN, (c) => c.query('select id from public.coach_requests where id = $1', [REQ]));
    expect(r.rows).toHaveLength(1);
  });

  it('anon cannot read coach requests', async () => {
    const r = await asAnon((c) => c.query('select id from public.coach_requests where id = $1', [REQ]));
    expect(r.rows).toHaveLength(0);
  });

  // ── Write scoping: accept/decline are NOT client-writable; cancel is owner-only ─
  it('the addressed coach cannot flip status to accepted directly (service-role only)', async () => {
    const r = await asUser(COACH_A, (c) =>
      c.query("update public.coach_requests set status = 'accepted' where id = $1", [REQ]),
    );
    expect(r.rowCount).toBe(0); // no UPDATE policy matches a coach → 0 rows touched
  });

  it('the requesting client cannot self-accept their own request (with_check blocks it)', async () => {
    await expect(
      asUser(REQUESTER, (c) => c.query("update public.coach_requests set status = 'accepted' where id = $1", [REQ])),
    ).rejects.toThrow();
  });

  it('the requesting client MAY cancel their own pending request', async () => {
    const r = await asUser(REQUESTER, (c) =>
      c.query("update public.coach_requests set status = 'cancelled' where id = $1", [REQ]),
    );
    expect(r.rowCount).toBe(1);
  });

  // ── INSERT through the trigger (0082 bugfix; previously only reads were tested) ──
  // The trigger handle_coach_request_insert is SECURITY INVOKER; before 0082 it read the
  // target coach's profiles row directly, which the client's RLS hides → request_invalid
  // for every client requesting any coach. is_public_coach() (SECURITY DEFINER) fixes it.
  const LEAD_4: Identity = { sub: '1ea00000-0000-0000-0000-000000000004', userRole: 'client' }; // unassigned
  const LEAD_5: Identity = { sub: '1ea00000-0000-0000-0000-000000000005', userRole: 'client' }; // unassigned
  const LEAD_6: Identity = { sub: '1ea00000-0000-0000-0000-000000000006', userRole: 'client' }; // unassigned
  const COACH_P_ID = 'c0c0c0c0-0000-0000-0000-000000000001'; // private coach (is_public = false)

  it('an unassigned client CAN request a PUBLIC coach (trigger server-sets client_id)', async () => {
    const r = await asUser(LEAD_4, (c) =>
      c.query('insert into public.coach_requests (coach_id) values ($1) returning client_id, status', [COACH_A.sub]),
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].client_id).toBe(LEAD_4.sub); // server-set, not client-supplied
    expect(r.rows[0].status).toBe('pending');
  });

  it('requesting a PRIVATE coach raises request_invalid', async () => {
    await expect(
      asUser(LEAD_5, (c) => c.query('insert into public.coach_requests (coach_id) values ($1)', [COACH_P_ID])),
    ).rejects.toThrow();
  });

  it('requesting a PUBLIC ATHLETE (not a coach) raises request_invalid — is_public_coach is stricter than is_public_profile', async () => {
    // CLIENT_A1 has a public athlete_profile, so is_public_profile(A1) is TRUE; the request
    // must still fail because A1 is not a public COACH.
    await expect(
      asUser(LEAD_6, (c) => c.query('insert into public.coach_requests (coach_id) values ($1)', [CLIENT_A1.sub])),
    ).rejects.toThrow();
  });
});

describe('admin console RPCs (0054, Slice G3) — in-function admin fence', () => {
  const ADMIN: Identity = { sub: 'dddddddd-dddd-dddd-dddd-dddddddddddd', userRole: 'admin' };
  const COACH_A: Identity = { sub: '11111111-1111-1111-1111-111111111111', userRole: 'coach' };

  it('an admin gets a single counts row with non-negative integers', async () => {
    const r = await asUser(ADMIN, (c) => c.query('select * from public.admin_dashboard_counts()'));
    expect(r.rows).toHaveLength(1);
    expect(Number(r.rows[0].coaches)).toBeGreaterThanOrEqual(2); // Coach A + Coach B (+ more)
    expect(Number(r.rows[0].clients)).toBeGreaterThanOrEqual(1);
  });

  it('a non-admin gets ZERO rows from the counts RPC (the WHERE fence denies)', async () => {
    const coach = await asUser(COACH_A, (c) => c.query('select * from public.admin_dashboard_counts()'));
    const client = await asUser(CLIENT_A1, (c) => c.query('select * from public.admin_dashboard_counts()'));
    expect(coach.rows).toHaveLength(0);
    expect(client.rows).toHaveLength(0);
  });

  it('admin user search matches by name and returns ONLY the allowlisted columns', async () => {
    const r = await asUser(ADMIN, (c) => c.query("select * from public.admin_search_users('Coach', 50)"));
    const ids = r.rows.map((x) => x.id);
    expect(ids).toContain('11111111-1111-1111-1111-111111111111'); // Coach A
    const cols = Object.keys(r.rows[0]).sort();
    expect(cols).toEqual(['banned_at', 'created_at', 'full_name', 'id', 'role'].sort());
    for (const banned of ['email', 'coach_id']) expect(cols).not.toContain(banned);
  });

  it('a non-admin gets ZERO rows from user search', async () => {
    const r = await asUser(COACH_A, (c) => c.query("select * from public.admin_search_users('Coach', 50)"));
    expect(r.rows).toHaveLength(0);
  });

  it('anon cannot execute either admin RPC (no execute grant)', async () => {
    await expect(asAnon((c) => c.query('select * from public.admin_dashboard_counts()'))).rejects.toThrow();
    await expect(asAnon((c) => c.query("select * from public.admin_search_users('a', 10)"))).rejects.toThrow();
  });
});

describe('conversation previews + read-state (0058) — chat list aggregation (§2/§8)', () => {
  const COACH_B: Identity = { sub: COACH_B_ID, userRole: 'coach' };
  const CLIENT_B1_ID: Identity = { sub: CLIENT_B1, userRole: 'client' };

  it('list_conversation_previews gives one row per counterpart with the unread count', async () => {
    // Client A1 only converses with Coach A (seed: ab000001..ab000004). The seeded
    // read-state marker is a day old, so the 3 Coach A → A1 messages stay unread
    // (ab000002 is A1's own → never unread).
    const r = await asUser(CLIENT_A1, (c) => c.query('select * from public.list_conversation_previews()'));
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].peer_id).toBe(COACH_A.sub);
    expect(Number(r.rows[0].unread_count)).toBe(3);
  });

  // The harness rolls back each asUser() call (helpers.ts withIdentity), so a write and the
  // read that depends on it must share ONE transaction.
  it('mark_conversation_read clears the unread count for that conversation', async () => {
    await asUser(CLIENT_A1, async (c) => {
      const before = await c.query(
        'select unread_count from public.list_conversation_previews() where peer_id = $1',
        [COACH_A.sub],
      );
      expect(Number(before.rows[0].unread_count)).toBe(3);
      await c.query('select public.mark_conversation_read($1)', [COACH_A.sub]); // upserts last_read = now()
      const after = await c.query(
        'select unread_count from public.list_conversation_previews() where peer_id = $1',
        [COACH_A.sub],
      );
      expect(Number(after.rows[0].unread_count)).toBe(0);
    });
  });

  it('a user cannot read another user’s conversation_read_state (cross-tenant)', async () => {
    // The seed commits one read-state row (A1 ↔ Coach A) so others have a target to be denied.
    const own = await asUser(CLIENT_A1, (c) => c.query('select peer_id from public.conversation_read_state'));
    expect(own.rows.length).toBeGreaterThanOrEqual(1);

    const otherCoach = await asUser(COACH_B, (c) =>
      c.query('select peer_id from public.conversation_read_state where user_id = $1', [CLIENT_A1.sub]),
    );
    expect(otherCoach.rows).toHaveLength(0);
    const sibling = await asUser(CLIENT_B1_ID, (c) =>
      c.query('select peer_id from public.conversation_read_state where user_id = $1', [CLIENT_A1.sub]),
    );
    expect(sibling.rows).toHaveLength(0);
    // anon has no grant on this private table → denied at the grant level (stronger than RLS-0-rows).
    await expect(asAnon((c) => c.query('select peer_id from public.conversation_read_state'))).rejects.toThrow();
  });

  it('mark_conversation_read writes the row as the caller (user_id forced to auth.uid())', async () => {
    await asUser(CLIENT_B1_ID, async (c) => {
      await c.query('select public.mark_conversation_read($1)', [COACH_B.sub]);
      const r = await c.query('select user_id from public.conversation_read_state where peer_id = $1', [COACH_B.sub]);
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0].user_id).toBe(CLIENT_B1); // never anyone else's id
    });
  });

  it('anon cannot execute the conversation RPCs (0059 — execute revoked from anon)', async () => {
    await expect(asAnon((c) => c.query('select * from public.list_conversation_previews()'))).rejects.toThrow();
    await expect(
      asAnon((c) => c.query('select public.mark_conversation_read($1)', [COACH_A.sub])),
    ).rejects.toThrow();
  });
});

describe('security hardening (0061–0067)', () => {
  it('M-5 — accept_invitation refuses a client who already has a coach (atomic no-steal)', async () => {
    const INVITEE_ID = 'da010001-0000-0000-0000-000000000001';
    const EMAIL = 'm5.invitee@example.test';
    const TOKEN_A = 'da010002-0000-0000-0000-000000000002';
    const TOKEN_B = 'da010003-0000-0000-0000-000000000003';
    const c = await pool.connect();
    try {
      await c.query('begin');
      await c.query('insert into auth.users (id, email) values ($1, $2)', [INVITEE_ID, EMAIL]);
      await c.query('insert into public.invitations (coach_id, email, token) values ($1, $2, $3)', [
        COACH_A.sub,
        EMAIL,
        TOKEN_A,
      ]);
      await c.query('insert into public.invitations (coach_id, email, token) values ($1, $2, $3)', [
        COACH_B_ID,
        EMAIL,
        TOKEN_B,
      ]);
      await c.query('set local role service_role');
      // First accept links coach A.
      const r1 = await c.query('select public.accept_invitation($1, $2, $3) as coach', [
        TOKEN_A,
        INVITEE_ID,
        EMAIL,
      ]);
      expect(r1.rows[0].coach).toBe(COACH_A.sub);
      // A second accept (different coach, same client) must be rejected — no steal.
      await c.query('savepoint sp');
      await expect(
        c.query('select public.accept_invitation($1, $2, $3)', [TOKEN_B, INVITEE_ID, EMAIL]),
      ).rejects.toThrow();
      await c.query('rollback to savepoint sp');
      await c.query('reset role');
      const prof = await c.query('select coach_id from public.profiles where id = $1', [INVITEE_ID]);
      expect(prof.rows[0].coach_id).toBe(COACH_A.sub); // unchanged
    } finally {
      await c.query('rollback').catch(() => {});
      c.release();
    }
  });

  it('M-2 — first-contact DM needs a chat acknowledgment (server-enforced disclaimer)', async () => {
    // The disclaimer gate is the FIRST message within an established coach↔client pair
    // (messages_insert RLS already requires that relationship). Use Coach A + a fresh
    // client of theirs, with no prior thread and no acknowledgment.
    const NEWC = 'da020001-0000-0000-0000-000000000001';
    const coachClaims = JSON.stringify({ sub: COACH_A.sub, role: 'authenticated', user_role: 'coach' });
    const c = await pool.connect();
    try {
      await c.query('begin');
      await c.query('insert into auth.users (id, email) values ($1, $2)', [NEWC, 'm2.newclient@example.test']);
      // Assign the fresh client to Coach A (service role — immutables allows coach_id).
      await c.query('set local role service_role');
      await c.query('update public.profiles set coach_id = $1 where id = $2', [COACH_A.sub, NEWC]);
      await c.query('reset role');
      // First contact, no acknowledgment → blocked by the disclaimer gate.
      await c.query('savepoint sp');
      await c.query('set local role authenticated');
      await c.query("select set_config('request.jwt.claims', $1, true)", [coachClaims]);
      await expect(
        c.query('insert into public.messages (recipient_id, body) values ($1, $2)', [NEWC, 'hi']),
      ).rejects.toThrow(/disclaimer_required/);
      await c.query('rollback to savepoint sp');
      // Record the acknowledgment (Coach A → the client), then the same send succeeds.
      await c.query('insert into public.chat_acknowledgments (user_id, peer_id) values ($1, $2)', [COACH_A.sub, NEWC]);
      await c.query('set local role authenticated');
      await c.query("select set_config('request.jwt.claims', $1, true)", [coachClaims]);
      const ok = await c.query(
        'insert into public.messages (recipient_id, body) values ($1, $2) returning id',
        [NEWC, 'hi'],
      );
      expect(ok.rows).toHaveLength(1);
    } finally {
      await c.query('rollback').catch(() => {});
      c.release();
    }
  });

  it('H-1 — moderation FKs are ON DELETE SET NULL (audit trail survives user deletion)', async () => {
    const r = await asService((c) =>
      c.query(
        `select conname, confdeltype from pg_constraint
          where conname in ('message_reports_reported_user_id_fkey', 'ban_appeals_user_id_fkey')
          order by conname`,
      ),
    );
    expect(r.rows).toHaveLength(2);
    for (const row of r.rows) expect(row.confdeltype).toBe('n'); // 'n' = SET NULL
  });

  it('C-1 — a blocklisted email cannot register (case-insensitive handle_new_user guard)', async () => {
    const c = await pool.connect();
    try {
      await c.query('begin');
      await c.query("insert into public.email_blocklist (email_lc) values ('blocked@example.test')");
      await expect(
        c.query("insert into auth.users (id, email) values (gen_random_uuid(), 'Blocked@Example.test')"),
      ).rejects.toThrow();
    } finally {
      await c.query('rollback').catch(() => {});
      c.release();
    }
  });
});

describe('@handle (0069)', () => {
  it('rejects a duplicate handle (case-insensitive unique)', async () => {
    const U1 = 'da030001-0000-0000-0000-000000000001';
    const U2 = 'da030002-0000-0000-0000-000000000002';
    const c = await pool.connect();
    try {
      await c.query('begin');
      await c.query('insert into auth.users (id, email) values ($1, $2), ($3, $4)', [
        U1,
        'h1.dup@example.test',
        U2,
        'h2.dup@example.test',
      ]);
      await c.query('update public.profiles set handle = $1 where id = $2', ['takenname', U1]);
      // U2 tries the same handle in a different case → lower(handle) unique index rejects.
      await expect(
        c.query('update public.profiles set handle = $1 where id = $2', ['TakenName', U2]),
      ).rejects.toThrow();
    } finally {
      await c.query('rollback').catch(() => {});
      c.release();
    }
  });

  it('enforces the 14-day rename cooldown', async () => {
    const U = 'da030003-0000-0000-0000-000000000003';
    const c = await pool.connect();
    try {
      await c.query('begin');
      await c.query('insert into auth.users (id, email) values ($1, $2)', [U, 'h3.cd@example.test']);
      // First rename is free (signup left handle_changed_at null), then stamps now().
      await c.query('update public.profiles set handle = $1 where id = $2', ['firstname', U]);
      await expect(
        c.query('update public.profiles set handle = $1 where id = $2', ['secondname', U]),
      ).rejects.toThrow(/handle_cooldown/);
    } finally {
      await c.query('rollback').catch(() => {});
      c.release();
    }
  });

  it('rejects a reserved handle', async () => {
    const U = 'da030004-0000-0000-0000-000000000004';
    const c = await pool.connect();
    try {
      await c.query('begin');
      await c.query('insert into auth.users (id, email) values ($1, $2)', [U, 'h4.res@example.test']);
      await expect(
        c.query('update public.profiles set handle = $1 where id = $2', ['admin', U]),
      ).rejects.toThrow(/handle_reserved/);
    } finally {
      await c.query('rollback').catch(() => {});
      c.release();
    }
  });

  it('check_handle_available is not callable by anon (execute revoked)', async () => {
    await expect(
      asAnon((c) => c.query("select * from public.check_handle_available('whatever')")),
    ).rejects.toThrow();
  });
});

describe('calls & meetings (0083) — slots + booking asymmetry + lifecycle (§2)', () => {
  const COACH_B: Identity = { sub: COACH_B_ID, userRole: 'coach' };
  const CLIENT_B1_ID: Identity = { sub: CLIENT_B1, userRole: 'client' };
  const SLOT_A_OPEN = '00831001-0000-0000-0000-000000000001';
  const SLOT_A_HELD = '00831002-0000-0000-0000-000000000002';
  const SLOT_B_OPEN = '00831003-0000-0000-0000-000000000003';
  const DONE_CALL = '00831010-0000-0000-0000-000000000010';

  // ── cross-tenant reads → 0 rows (read tests first; mutating tests are last) ──
  it("client A1 sees only their coach's OPEN slots (held + other-coach hidden)", async () => {
    const r = await asUser(CLIENT_A1, (c) => c.query('select id from public.coach_call_slots'));
    const ids = r.rows.map((x) => x.id);
    expect(ids).toContain(SLOT_A_OPEN);
    expect(ids).not.toContain(SLOT_A_HELD); // held → hidden from the booking sheet
    expect(ids).not.toContain(SLOT_B_OPEN); // another coach's slot → cross-tenant
    expect(r.rows).toHaveLength(1);
  });

  it('client B1 cannot read coach A slots or client A1 calls', async () => {
    const slots = await asUser(CLIENT_B1_ID, (c) =>
      c.query('select id from public.coach_call_slots where coach_id = $1', [COACH_A.sub]),
    );
    const calls = await asUser(CLIENT_B1_ID, (c) =>
      c.query('select id from public.calls where id = $1', [DONE_CALL]),
    );
    expect(slots.rows).toHaveLength(0);
    expect(calls.rows).toHaveLength(0);
  });

  it('coach B cannot read coach A slots or calls', async () => {
    const slots = await asUser(COACH_B, (c) =>
      c.query('select id from public.coach_call_slots where coach_id = $1', [COACH_A.sub]),
    );
    const calls = await asUser(COACH_B, (c) => c.query('select id from public.calls'));
    expect(slots.rows).toHaveLength(0);
    expect(calls.rows).toHaveLength(0);
  });

  it('anon sees no slots or calls', async () => {
    const slots = await asAnon((c) => c.query('select id from public.coach_call_slots'));
    const calls = await asAnon((c) => c.query('select id from public.calls'));
    expect(slots.rows).toHaveLength(0);
    expect(calls.rows).toHaveLength(0);
  });

  // ── positive controls ──
  it('coach A sees their own two slots + the completed call', async () => {
    const slots = await asUser(COACH_A, (c) => c.query('select id from public.coach_call_slots'));
    const calls = await asUser(COACH_A, (c) => c.query('select id from public.calls'));
    expect(slots.rows).toHaveLength(2); // open + held
    expect(calls.rows.map((x) => x.id)).toContain(DONE_CALL);
  });

  it('client A1 sees their own call', async () => {
    const r = await asUser(CLIENT_A1, (c) => c.query('select id from public.calls'));
    expect(r.rows.map((x) => x.id)).toContain(DONE_CALL);
  });

  // ── the asymmetry: a client can NEVER create a coach_adhoc / ringing call ──
  it('client forging coach_adhoc is rejected (origin forced → no slot → invalid)', async () => {
    await expect(
      asUser(CLIENT_A1, (c) =>
        c.query(
          "insert into public.calls (origin, coach_id, client_id, status) values ('coach_adhoc', $1, $2, 'ringing')",
          [COACH_A.sub, CLIENT_A2],
        ),
      ),
    ).rejects.toThrow();
  });

  it("client cannot book another coach's slot", async () => {
    await expect(
      asUser(CLIENT_A1, (c) =>
        c.query("insert into public.calls (slot_id, purpose) values ($1, 'other')", [SLOT_B_OPEN]),
      ),
    ).rejects.toThrow();
  });

  it('client cannot book a held slot (double-booking guard)', async () => {
    await expect(
      asUser(CLIENT_A1, (c) =>
        c.query("insert into public.calls (slot_id, purpose) values ($1, 'other')", [SLOT_A_HELD]),
      ),
    ).rejects.toThrow();
  });

  // ── status transitions are server-side only ──
  it('coach cannot mutate a call via a direct RLS update (must use the RPC)', async () => {
    const r = await asUser(COACH_A, (c) =>
      c.query("update public.calls set status = 'cancelled' where id = $1", [DONE_CALL]),
    );
    expect(r.rowCount).toBe(0); // no coach UPDATE policy → 0 rows
  });

  it('coach can publish their OWN slot but not one for another coach', async () => {
    const own = await asUser(COACH_A, (c) =>
      c.query(
        "insert into public.coach_call_slots (coach_id, starts_at, duration_minutes) values ($1, now() + interval '30 days', 30) returning id",
        [COACH_A.sub],
      ),
    );
    expect(own.rows).toHaveLength(1);
    await expect(
      asUser(COACH_A, (c) =>
        c.query(
          "insert into public.coach_call_slots (coach_id, starts_at, duration_minutes) values ($1, now() + interval '31 days', 30)",
          [COACH_B_ID],
        ),
      ),
    ).rejects.toThrow();
  });

  // ── client create + cancel are the ONLY client writes (mutating → last) ──
  it('client can create a booking and cancel it, but cannot self-accept', async () => {
    // ONE asUser call: each asUser begins+rolls-back its own txn, so the booking must live
    // in the SAME connection as the cancel. The self-accept (WITH CHECK fail) is wrapped in a
    // savepoint so its error doesn't abort the txn before the cancel (mirrors 0084's pattern).
    await asUser(CLIENT_A1, async (c) => {
      const booked = await c.query(
        "insert into public.calls (slot_id, purpose) values ($1, 'progress_review') returning id, origin, status",
        [SLOT_A_OPEN],
      );
      expect(booked.rows[0].origin).toBe('client_request'); // server-derived, not the body
      expect(booked.rows[0].status).toBe('pending');
      const callId = booked.rows[0].id;

      await c.query('savepoint sp_accept');
      let threw = false;
      try {
        await c.query("update public.calls set status = 'accepted' where id = $1", [callId]);
      } catch {
        threw = true;
      }
      await c.query('rollback to savepoint sp_accept');
      expect(threw).toBe(true); // self-accept rejected (only pending/accepted → cancelled is allowed)

      const cancel = await c.query("update public.calls set status = 'cancelled' where id = $1", [callId]);
      expect(cancel.rowCount).toBe(1);
    });
  });
});
