import { defineConfig } from 'vitest/config';

// The RLS harness talks to Postgres over TCP via `pg`; it imports no React /
// Expo code, so it runs as plain Node. `runner.ts` provisions the database and
// sets RLS_DATABASE_URL before invoking vitest.
export default defineConfig({
  test: {
    include: ['supabase/tests/**/*.test.ts'],
    fileParallelism: false,
    pool: 'forks',
  },
});
