#!/usr/bin/env bash
# Run schema.sql and rls.sql against a REAL Postgres and assert what they leave
# behind. `npm run test:sql`.
#
# Why this exists. The two worst problems in this repo's history were both
# invisible from the app: re-running schema.sql silently undid the rls.sql
# lockdown (every table back open to the anon key, dashboard still full of
# policies), and later the `rounds` table had RLS enabled with no policy, so
# settlement was refused and simply never happened. Neither is reachable from
# the unit suite -- they are properties of SQL, and only a real engine has an
# opinion about them.
#
# Spins up a throwaway cluster, so it touches nothing you care about.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | tail -1)}"
[ -x "$PGBIN/initdb" ] || { echo "no postgres server found (set PGBIN)"; exit 1; }

WORK="$(mktemp -d)"
# Postgres refuses to run as root. When we are root, hand the cluster to the
# postgres system user; otherwise run as whoever invoked this.
AS=""
if [ "$(id -u)" = "0" ]; then
  id postgres >/dev/null 2>&1 || { echo "running as root and no postgres user exists"; exit 1; }
  AS="su -s /bin/bash postgres -c"
  chmod 711 "$WORK"; chown postgres "$WORK"
fi
run() { if [ -n "$AS" ]; then $AS "$*"; else bash -c "$*"; fi; }

SOCK="$WORK/sock"; DATA="$WORK/data"
run "mkdir -p '$SOCK' '$DATA'"
cleanup() {
  run "$PGBIN/pg_ctl -D '$DATA' -m immediate stop" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

echo "· starting postgres"
run "$PGBIN/initdb -D '$DATA' -U postgres --auth=trust" >/dev/null
run "$PGBIN/pg_ctl -D '$DATA' -o \"-k '$SOCK' -h ''\" -l '$WORK/pg.log' -w start" >/dev/null

# NOTICEs go to stderr and drown the output; warnings and errors still show.
export PGOPTIONS="-c client_min_messages=warning"
PSQL=(psql -h "$SOCK" -U postgres -d app -v ON_ERROR_STOP=1 -q --no-psqlrc)
psql -h "$SOCK" -U postgres -q --no-psqlrc -c "create database app" >/dev/null

step() { echo "· $1"; }

step "supabase shim"
"${PSQL[@]}" -f "$ROOT/test/sql/shim.sql"

step "schema.sql (first run)"
"${PSQL[@]}" -f "$ROOT/schema.sql" >/dev/null
"${PSQL[@]}" -v phase=open -f "$ROOT/test/sql/assertions.sql"

step "rls.sql"
"${PSQL[@]}" -f "$ROOT/rls.sql" >/dev/null
"${PSQL[@]}" -v phase=locked -f "$ROOT/test/sql/assertions.sql"

# THE trap. This is the run that used to reopen every table.
step "schema.sql AGAIN, on top of the lockdown"
"${PSQL[@]}" -f "$ROOT/schema.sql" >/dev/null
"${PSQL[@]}" -v phase=locked -f "$ROOT/test/sql/assertions.sql"

step "rls.sql again (it claims to be idempotent)"
"${PSQL[@]}" -f "$ROOT/rls.sql" >/dev/null
"${PSQL[@]}" -v phase=locked -f "$ROOT/test/sql/assertions.sql"

step "settlement claim semantics"
"${PSQL[@]}" -f "$ROOT/test/sql/rounds.sql"

step "accept_trade window guard"
"${PSQL[@]}" -f "$ROOT/test/sql/trades.sql"

echo "all sql checks passed"
