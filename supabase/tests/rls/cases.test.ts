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

  it('client A1 sees their own profile and their own two progress rows', async () => {
    const prof = await asUser(CLIENT_A1, (c) => c.query('select id from public.profiles'));
    const prog = await asUser(CLIENT_A1, (c) => c.query('select id from public.progress_entries'));
    expect(prof.rows).toHaveLength(1);
    expect(prof.rows[0].id).toBe(CLIENT_A1.sub);
    expect(prog.rows).toHaveLength(2);
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

  it('a new user can self-insert only a plain client profile', async () => {
    // Elevated self-insert is rejected …
    await expect(
      asUser(NEW_USER, (c) =>
        c.query("insert into public.profiles (id, role) values ($1, 'admin')", [NEW_USER.sub]),
      ),
    ).rejects.toThrow();
    // … self-assigning a coach is rejected …
    await expect(
      asUser(NEW_USER, (c) =>
        c.query("insert into public.profiles (id, role, coach_id) values ($1, 'client', $2)", [
          NEW_USER.sub,
          COACH_B_ID,
        ]),
      ),
    ).rejects.toThrow();
    // … but a plain client profile for yourself is allowed.
    const ok = await asUser(NEW_USER, (c) =>
      c.query("insert into public.profiles (id, role, full_name) values ($1, 'client', 'New User')", [
        NEW_USER.sub,
      ]),
    );
    expect(ok.rowCount).toBe(1);
  });

  it('client cannot insert a profile for another user id', async () => {
    await expect(
      asUser(NEW_USER, (c) =>
        c.query("insert into public.profiles (id, role) values ($1, 'client')", [COACH_B_ID]),
      ),
    ).rejects.toThrow();
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
