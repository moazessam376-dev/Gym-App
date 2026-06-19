#!/usr/bin/env bash
# Manually apply the auth shim + migrations (+ optional seed) to a database, for
# debugging/inspection. The RLS harness (`npm run test:rls`) does this itself
# against a throwaway DB; this script is for poking at schema by hand.
#
#   TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5544/scratch ./scripts/db-apply.sh [--seed]
set -euo pipefail

URL="${TEST_DATABASE_URL:-postgres://postgres@127.0.0.1:5544/postgres}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

for f in "$HERE"/supabase/migrations/*.sql; do
  echo "applying $(basename "$f") ..."
  psql "$URL" -v ON_ERROR_STOP=1 -q -f "$f"
done

if [ "${1:-}" = "--seed" ]; then
  echo "seeding ..."
  psql "$URL" -v ON_ERROR_STOP=1 -q -f "$HERE/supabase/tests/rls/seed.sql"
fi

echo "done."
