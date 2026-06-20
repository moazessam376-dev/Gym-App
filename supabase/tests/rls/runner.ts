// runner.ts — single entrypoint for `npm run test:rls`.
//
// 1. Creates a throwaway database on the target Postgres.
// 2. Applies the auth shim + every migration in lexical order (proving a clean
//    from-scratch apply) and seeds deterministic fixtures.
// 3. Spawns vitest against that database to run the cross-tenant assertions.
// 4. Drops the throwaway database and exits with vitest's status.
//
// Works identically against a local throwaway cluster (this repo's scripts) and
// a CI `postgres:16` service container — no Docker / Supabase stack required.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import 'dotenv/config';

const root = process.cwd();
const migrationsDir = join(root, 'supabase', 'migrations');
const seedPath = join(root, 'supabase', 'tests', 'rls', 'seed.sql');

// Applied in lexical order. 0000 is the LOCAL/CI-only auth shim.
const migrationFiles = [
  '0000_auth_shim.sql',
  '0001_profiles.sql',
  '0002_progress_entries.sql',
  '0003_profile_bootstrap.sql',
  '0004_access_token_hook.sql',
  '0005_invitations.sql',
  '0006_assignment_functions.sql',
  '0007_function_hardening.sql',
  '0008_phase2_polish.sql',
  '0009_plans.sql',
];

const baseUrl =
  process.env.TEST_DATABASE_URL ?? 'postgres://postgres@127.0.0.1:5544/postgres';

function urlForDb(database: string): string {
  const u = new URL(baseUrl);
  u.pathname = `/${database}`;
  return u.toString();
}

async function main(): Promise<void> {
  const testDb = `rls_test_${Date.now()}`;

  const admin = new Client({ connectionString: baseUrl });
  await admin.connect();
  await admin.query(`create database ${testDb}`);
  await admin.end();

  let exitCode = 1;
  try {
    const db = new Client({ connectionString: urlForDb(testDb) });
    await db.connect();
    for (const file of migrationFiles) {
      await db.query(readFileSync(join(migrationsDir, file), 'utf8'));
    }
    await db.query(readFileSync(seedPath, 'utf8'));
    await db.end();

    const result = spawnSync('npx', ['vitest', 'run'], {
      stdio: 'inherit',
      env: { ...process.env, RLS_DATABASE_URL: urlForDb(testDb) },
    });
    exitCode = result.status ?? 1;
  } finally {
    const cleanup = new Client({ connectionString: baseUrl });
    await cleanup.connect();
    await cleanup.query(
      `select pg_terminate_backend(pid)
         from pg_stat_activity
        where datname = $1 and pid <> pg_backend_pid()`,
      [testDb],
    );
    await cleanup.query(`drop database if exists ${testDb}`);
    await cleanup.end();
  }

  process.exit(exitCode);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
