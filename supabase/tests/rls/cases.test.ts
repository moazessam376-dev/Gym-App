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
  const CUSTOM_EX_A = 'e1000000-0000-0000-0000-00000000000a';
  const CUSTOM_FOOD_B = 'f1000000-0000-0000-0000-00000000000b';
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
    // 20/10s cap; the 21st in the same transaction trips it (now() is constant
    // within the txn, so all rows fall inside the window).
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

  it('a different tenant (other coach / other client) sees nothing', async () => {
    const coachB = await asUser(COACH_B, (c) => c.query('select id from public.media'));
    const clientB1 = await asUser(CLIENT_B1_ID, (c) => c.query('select id from public.media'));
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
