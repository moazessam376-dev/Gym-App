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

describe('plans & plan_items (0009) — coach authors, assigned client reads (§2)', () => {
  const PLAN_A1_PUB = '99990001-0000-0000-0000-000000000001';
  const PLAN_A1_DRAFT = '99990002-0000-0000-0000-000000000002';
  const PLAN_B1_PUB = '99990003-0000-0000-0000-000000000003';

  it('coach A sees only their own plans (both A1 plans), not coach B’s', async () => {
    const a = await asUser(COACH_A, (c) => c.query('select id from public.plans'));
    const b = await asUser({ sub: COACH_B_ID, userRole: 'coach' }, (c) =>
      c.query('select id from public.plans'),
    );
    expect(a.rows).toHaveLength(2); // A1 published + A1 draft
    expect(b.rows).toHaveLength(1); // B1 published
  });

  it('client A1 reads their PUBLISHED plan only — not the draft, not B1’s', async () => {
    const all = await asUser(CLIENT_A1, (c) => c.query('select id, status from public.plans'));
    expect(all.rows).toHaveLength(1);
    expect(all.rows[0].id).toBe(PLAN_A1_PUB);
    expect(all.rows[0].status).toBe('published');

    const draft = await asUser(CLIENT_A1, (c) =>
      c.query('select id from public.plans where id = $1', [PLAN_A1_DRAFT]),
    );
    const otherClient = await asUser(CLIENT_A1, (c) =>
      c.query('select id from public.plans where id = $1', [PLAN_B1_PUB]),
    );
    expect(draft.rows).toHaveLength(0);
    expect(otherClient.rows).toHaveLength(0);
  });

  it('a client cannot create a plan', async () => {
    await expect(
      asUser(CLIENT_A1, (c) =>
        c.query(
          "insert into public.plans (coach_id, client_id, type, title) values ($1, $2, 'training', 'x')",
          ['11111111-1111-1111-1111-111111111111', CLIENT_A1.sub],
        ),
      ),
    ).rejects.toThrow();
  });

  it('coach A can author a plan for their own client, but not for coach B’s client', async () => {
    const ok = await asUser(COACH_A, (c) =>
      c.query(
        "insert into public.plans (coach_id, client_id, type, title) values ($1, $2, 'training', 'New A1 plan')",
        [COACH_A.sub, CLIENT_A1.sub],
      ),
    );
    expect(ok.rowCount).toBe(1);

    await expect(
      asUser(COACH_A, (c) =>
        c.query(
          "insert into public.plans (coach_id, client_id, type, title) values ($1, $2, 'training', 'steal')",
          [COACH_A.sub, CLIENT_B1],
        ),
      ),
    ).rejects.toThrow();
  });

  it('plan_items: client A1 reads items of their published plan, not of the draft', async () => {
    const pub = await asUser(CLIENT_A1, (c) =>
      c.query('select id from public.plan_items where plan_id = $1', [PLAN_A1_PUB]),
    );
    const draft = await asUser(CLIENT_A1, (c) =>
      c.query('select id from public.plan_items where plan_id = $1', [PLAN_A1_DRAFT]),
    );
    expect(pub.rows).toHaveLength(2);
    expect(draft.rows).toHaveLength(0);
  });

  it('plan_items: coach writes items only on plans they own', async () => {
    const ok = await asUser(COACH_A, (c) =>
      c.query("insert into public.plan_items (plan_id, name) values ($1, 'Row')", [PLAN_A1_PUB]),
    );
    expect(ok.rowCount).toBe(1);

    await expect(
      asUser(COACH_A, (c) =>
        c.query("insert into public.plan_items (plan_id, name) values ($1, 'Row')", [PLAN_B1_PUB]),
      ),
    ).rejects.toThrow();
  });

  it('plan_items: a client cannot write items', async () => {
    await expect(
      asUser(CLIENT_A1, (c) =>
        c.query("insert into public.plan_items (plan_id, name) values ($1, 'Row')", [PLAN_A1_PUB]),
      ),
    ).rejects.toThrow();
  });

  it('anon sees no plans or plan_items', async () => {
    const plans = await asAnon((c) => c.query('select id from public.plans'));
    const items = await asAnon((c) => c.query('select id from public.plan_items'));
    expect(plans.rows).toHaveLength(0);
    expect(items.rows).toHaveLength(0);
  });
});
