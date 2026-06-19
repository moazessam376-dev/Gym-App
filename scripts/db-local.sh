#!/usr/bin/env bash
# Start a disposable local Postgres cluster for the RLS harness.
#
# Uses the Debian pg cluster tooling so Postgres runs as the `postgres` OS user
# (Postgres refuses to run as root). The cluster is separate from `main` and
# trusts localhost TCP so the harness can connect as `postgres` without a
# password. This is a throwaway TEST cluster — never use it for real data.
set -euo pipefail

CLUSTER="${RLS_PG_CLUSTER:-rlstest}"
PGVER="${RLS_PG_VERSION:-16}"
PGPORT="${RLS_PG_PORT:-5544}"

if ! pg_lsclusters -h "$PGVER" "$CLUSTER" >/dev/null 2>&1 \
   || [ -z "$(pg_lsclusters -h "$PGVER" "$CLUSTER" 2>/dev/null)" ]; then
  echo "Creating disposable Postgres cluster '$CLUSTER' (v$PGVER) on port $PGPORT ..."
  pg_createcluster "$PGVER" "$CLUSTER" --port="$PGPORT" >/dev/null
  HBA="/etc/postgresql/$PGVER/$CLUSTER/pg_hba.conf"
  # Prepend trust rules so they win over the default scram-sha-256 host rules
  # (pg_hba is first-match-wins).
  TMP="$(mktemp)"
  {
    printf 'host\tall\tall\t127.0.0.1/32\ttrust\n'
    printf 'host\tall\tall\t::1/128\ttrust\n'
    cat "$HBA"
  } > "$TMP"
  mv "$TMP" "$HBA"
fi

STATUS="$(pg_lsclusters -h "$PGVER" "$CLUSTER" 2>/dev/null | awk '{print $4}')"
if [ "$STATUS" != "online" ]; then
  pg_ctlcluster "$PGVER" "$CLUSTER" start
fi

echo "Postgres '$CLUSTER' online on 127.0.0.1:$PGPORT"
echo
echo "  export TEST_DATABASE_URL=postgres://postgres@127.0.0.1:$PGPORT/postgres"
echo
echo "Then run: npm run test:rls"
