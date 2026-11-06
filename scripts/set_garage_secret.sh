#!/bin/sh
# OWNER RUNS THIS ONCE (not Claude). Creates a random GARAGE_SESSION_SECRET and stores it as a Supabase Edge Function secret. The value is never printed or saved to a file.
# Needs the Supabase CLI logged in on your Mac (supabase login). Run: sh scripts/set_garage_secret.sh
# Changing the secret later signs every garage out (they just enter the PIN again).
set -e
command -v supabase >/dev/null || { echo "Install the Supabase CLI first (brew install supabase/tap/supabase)."; exit 1; }
printf "Set a new GARAGE_SESSION_SECRET on project mejdxsbpyscujpvbwvmg? Type yes: "; read -r ok; [ "$ok" = "yes" ] || { echo "Cancelled."; exit 1; }
secret="$(openssl rand -hex 32)"
supabase secrets set "GARAGE_SESSION_SECRET=$secret" --project-ref mejdxsbpyscujpvbwvmg >/dev/null && echo "GARAGE_SESSION_SECRET is set." || echo "Could not set it. Check supabase login."
unset secret
