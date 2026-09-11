#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# 🐘 Scratch PostgreSQL for the WARPATH four-player simulator.
#
#   tools/warpath-sim/pg.sh up      — initdb, start, create db, apply schema
#   tools/warpath-sim/pg.sh reset   — drop + recreate the warpath db only
#   tools/warpath-sim/pg.sh test    — run the Milestone 1 assertion suite
#   tools/warpath-sim/pg.sh psql    — interactive shell
#   tools/warpath-sim/pg.sh down    — stop the cluster
#
# initdb refuses to run as root, so everything server-side goes through `su`
# to an unprivileged account. The cluster lives outside the repo.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}
PGDATA=${PGDATA:-/var/tmp/wpsim/data}
PGPORT=${PGPORT:-55432}
PGSOCK=${PGSOCK:-/var/tmp/wpsim}
PGUSER_OS=${PGUSER_OS:-postgres}
DB=${DB:-warpath}
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"

asuser() { su "$PGUSER_OS" -s /bin/bash -c "$1"; }
psql_() { asuser "$PGBIN/psql -h $PGSOCK -p $PGPORT -d ${2:-$DB} -v ON_ERROR_STOP=1 $1"; }

case "${1:-up}" in
  up)
    if [ ! -s "$PGDATA/PG_VERSION" ]; then
      mkdir -p "$PGSOCK"; chown "$PGUSER_OS:$PGUSER_OS" "$PGSOCK"
      asuser "$PGBIN/initdb -D $PGDATA -U postgres --auth=trust -E UTF8 >/dev/null"
      # No TCP listener needed; the harness connects over the unix socket.
      asuser "echo \"unix_socket_directories = '$PGSOCK'\" >> $PGDATA/postgresql.conf"
      asuser "echo \"listen_addresses = ''\" >> $PGDATA/postgresql.conf"
      asuser "echo \"fsync = off\" >> $PGDATA/postgresql.conf"
      asuser "echo \"max_connections = 40\" >> $PGDATA/postgresql.conf"
    fi
    asuser "$PGBIN/pg_ctl -D $PGDATA -o '-p $PGPORT' -w -l $PGDATA/server.log start" || true
    asuser "$PGBIN/psql -h $PGSOCK -p $PGPORT -d postgres -tAc \"select 1 from pg_database where datname='$DB'\"" \
      | grep -q 1 || asuser "$PGBIN/createdb -h $PGSOCK -p $PGPORT $DB"
    psql_ "-f $HERE/stubs.sql"
    psql_ "-f $REPO/supabase/migrations/20260811000000_warpath_milestone_1.sql" >/dev/null
    echo "warpath db ready on $PGSOCK:$PGPORT/$DB"
    ;;
  reset)
    asuser "$PGBIN/dropdb -h $PGSOCK -p $PGPORT --if-exists $DB"
    asuser "$PGBIN/createdb -h $PGSOCK -p $PGPORT $DB"
    psql_ "-f $HERE/stubs.sql"
    psql_ "-f $REPO/supabase/migrations/20260811000000_warpath_milestone_1.sql" >/dev/null
    echo "warpath db reset"
    ;;
  test)
    # The suite inserts fixed auth.users emails and never deletes them, so it
    # only runs once per database. Always hand it a fresh one.
    "$0" reset >/dev/null
    psql_ "-f $REPO/supabase/tests/warpath_milestone_1_test.sql"
    ;;
  psql)  asuser "$PGBIN/psql -h $PGSOCK -p $PGPORT -d $DB" ;;
  down)  asuser "$PGBIN/pg_ctl -D $PGDATA -m fast stop" ;;
  *) echo "usage: pg.sh {up|reset|test|psql|down}"; exit 2 ;;
esac
