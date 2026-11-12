#!/bin/bash
# Loads every migration into a LOCAL scratch Postgres (stubs for the Supabase pieces), runs 20270144000000_booking_lifecycle.sql twice, then lifecycle.sql. Never touches Supabase.
# Usage: sh supabase/local-test/lifecycle.sh   (needs Postgres 14+ tools: initdb, pg_ctl, psql; Homebrew postgresql@16 is found automatically)
# Separate from run.sh on purpose: it runs only the booking lifecycle test.
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
  out="$($P -d t -f "$f" 2>&1 | grep -i 'error' | grep -vi 'pg_cron\|pg_net\|authenticator\|o.created_at\|handover_orphan_photos' || true)"
  [ -n "$out" ] && { echo "MIGRATION PROBLEM in $(basename "$f"): $out"; exit 1; }
done
# the booking lifecycle migration was just loaded once as part of the list above: run it a second time, it must be silent
out="$($P -d t -f "$mig/20270144000000_booking_lifecycle.sql" 2>&1 | grep -i 'error\|warning' || true)"; [ -n "$out" ] && { echo "NOT IDEMPOTENT (booking_lifecycle): $out"; exit 1; }
echo "migrations loaded; booking_lifecycle ran twice cleanly"
$P -d t -t -A -v ON_ERROR_STOP=1 -f "$here/lifecycle.sql" | grep -v "^\s*$"
