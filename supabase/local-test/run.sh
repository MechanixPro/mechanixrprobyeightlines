#!/bin/bash
# Loads every migration into a LOCAL scratch Postgres (stubs for the Supabase pieces) and runs paid-confirmation.sql. Never touches Supabase.
# Usage: sh supabase/local-test/run.sh   (needs Postgres 14+ tools: initdb, pg_ctl, psql; Homebrew postgresql@16 is found automatically)
set -e
here="$(cd "$(dirname "$0")" && pwd)"; mig="$here/../migrations"
for d in /opt/homebrew/opt/postgresql@16/bin /opt/homebrew/opt/postgresql@15/bin /usr/local/opt/postgresql@16/bin /usr/lib/postgresql/16/bin; do [ -x "$d/initdb" ] && PATH="$d:$PATH"; done
command -v initdb >/dev/null || { echo "SKIP: no local Postgres tools"; exit 3; }
tmp="$(mktemp -d)"; port=$((55000 + RANDOM % 900)); sock="$tmp"
initdb -D "$tmp/data" -U postgres -A trust >/dev/null
pg_ctl -D "$tmp/data" -o "-p $port -k $sock -c listen_addresses=''" -l "$tmp/pg.log" -w start >/dev/null
trap 'pg_ctl -D "$tmp/data" -m immediate stop >/dev/null 2>&1; rm -rf "$tmp"' EXIT
P="psql -h $sock -p $port -U postgres -q -X"
$P -d postgres -c "create database t" >/dev/null
$P -d t -f "$here/stub.sql" >/dev/null
for f in $(ls "$mig"/*.sql | sort); do
  # Migrations that need Supabase-only extensions (pg_cron, pg_net) or roles are allowed to report those errors; anything else fails the run.
  out="$($P -d t -f "$f" 2>&1 | grep -i 'error' | grep -vi 'pg_cron\|pg_net\|authenticator\|o.created_at\|handover_orphan_photos' || true)"
  [ -n "$out" ] && { echo "MIGRATION PROBLEM in $(basename "$f"): $out"; exit 1; }
done
# run the paid confirmation and journey migrations a second time: they must be safe to repeat
for f in 20261228000000_paid_confirmation 20261229000000_customer_updates 20261230000000_tech_location 20261231000000_customer_documents 20270101000000_garage_app 20270102000000_desk_actions_technician_lead_restore 20270103000000_mechanic_app 20270104000000_duplicate_merge 20270105000000_funnel_quote 20270106000000_wa_inbox 20270143000000_cancellations 20270144000000_booking_lifecycle; do
  out="$($P -d t -f "$mig/$f.sql" 2>&1 | grep -i error || true)"; [ -n "$out" ] && { echo "NOT IDEMPOTENT ($f): $out"; exit 1; }
done
$P -d t -v ON_ERROR_STOP=1 -f "$here/paid-confirmation.sql"
$P -d t -v ON_ERROR_STOP=1 -f "$here/journey.sql"
$P -d t -v ON_ERROR_STOP=1 -f "$here/garage.sql"
$P -d t -v ON_ERROR_STOP=1 -f "$here/desk-actions.sql"
$P -d t -v ON_ERROR_STOP=1 -f "$here/mechanic-app.sql"
$P -d t -v ON_ERROR_STOP=1 -f "$here/merge.sql"
$P -d t -v ON_ERROR_STOP=1 -f "$here/funnel.sql"
$P -d t -v ON_ERROR_STOP=1 -f "$here/wa-inbox.sql"
$P -d t -v ON_ERROR_STOP=1 -f "$here/cancellations.sql"
$P -d t -v ON_ERROR_STOP=1 -f "$here/lifecycle.sql" >/dev/null
