// helpers.ts — identity-scoped query helpers for the RLS harness.
//
// Each helper runs its callback inside a transaction that first assumes a
// Postgres role + JWT claims (exactly how PostgREST sets up a Supabase request),
// then ROLLS BACK so nothing leaks between test cases. `SET LOCAL` is
// transaction-scoped, so the connection reverts to the base role on release.

import { Pool, type PoolClient } from 'pg';

const connectionString = process.env.RLS_DATABASE_URL;
if (!connectionString) {
  throw new Error(
    'RLS_DATABASE_URL is not set. Run the harness via `npm run test:rls` (it provisions the DB).',
  );
}

export const pool = new Pool({ connectionString });

export type AppRole = 'admin' | 'coach' | 'client';

export interface Identity {
  /** auth.users id → auth.uid() */
  sub: string;
  /** custom JWT claim → public.current_app_role() */
  userRole: AppRole;
}

async function withIdentity<T>(
  setup: (c: PoolClient) => Promise<void>,
  fn: (c: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await setup(client);
    return await fn(client);
  } finally {
    await client.query('rollback').catch(() => {});
    client.release();
  }
}

/** Unauthenticated (public anon key). */
export function asAnon<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  return withIdentity(async (c) => {
    await c.query('set local role anon');
    await c.query("select set_config('request.jwt.claims', '{}', true)");
  }, fn);
}

/** A signed-in user with an app role, mirroring a verified Supabase JWT. */
export function asUser<T>(id: Identity, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const claims = JSON.stringify({ sub: id.sub, role: 'authenticated', user_role: id.userRole });
  return withIdentity(async (c) => {
    await c.query('set local role authenticated');
    await c.query("select set_config('request.jwt.claims', $1, true)", [claims]);
  }, fn);
}

/** The trusted server role (BYPASSRLS). The only path allowed to mutate role/ownership. */
export function asService<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  return withIdentity(async (c) => {
    await c.query('set local role service_role');
    await c.query("select set_config('request.jwt.claims', '{}', true)");
  }, fn);
}

/** Convenience: row count for a query run under an identity. */
export async function countRows(c: PoolClient, sql: string, params: unknown[] = []): Promise<number> {
  const res = await c.query(sql, params);
  return res.rowCount ?? 0;
}
