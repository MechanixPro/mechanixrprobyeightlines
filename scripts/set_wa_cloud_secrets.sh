#!/bin/bash
# OWNER RUNS THIS (not Claude). Stores the WhatsApp Cloud API secrets for the website number +91 83106 21498 as Supabase Edge Function secrets.
# Every value is typed with hidden input (nothing is shown on screen, in history or in the repo) and is never printed.
# Needs the Supabase CLI logged in on your Mac (supabase login). Run: bash scripts/set_wa_cloud_secrets.sh
# Leave a prompt empty to keep the value that is already set. The verify token is any private phrase you choose; you type the same phrase into Meta's webhook form.
set -e
if command -v supabase >/dev/null; then SB="supabase"; elif command -v npx >/dev/null; then SB="npx supabase"; else echo "Install Node (npx) or the Supabase CLI first."; exit 1; fi
REF="mejdxsbpyscujpvbwvmg"
printf "Set the WhatsApp Cloud secrets on project %s? Type yes: " "$REF"; read -r ok; [ "$ok" = "yes" ] || { echo "Cancelled."; exit 1; }
tmp="$(mktemp)"; chmod 600 "$tmp"; trap 'rm -f "$tmp"; unset WA_TOKEN WA_PHONE_NUMBER_ID WA_APP_SECRET WA_VERIFY_TOKEN WA_GRAPH_VERSION' EXIT
ask() {   # ask NAME "label" : hidden prompt, appends NAME=value to the temp file when something was typed
  local v; printf "%s (hidden, empty = keep current): " "$2"; IFS= read -r -s v; echo
  if [ -n "$v" ]; then printf '%s=%s\n' "$1" "$v" >> "$tmp"; echo "  $1 will be set."; else echo "  $1 unchanged."; fi
}
ask WA_TOKEN "Permanent system user token (whatsapp_business_messaging + whatsapp_business_management)"
ask WA_PHONE_NUMBER_ID "Phone number ID of +91 83106 21498"
ask WA_APP_SECRET "Meta app secret (App settings > Basic)"
ask WA_VERIFY_TOKEN "Webhook verify token (any private phrase of your own, the same one you paste into Meta)"
ask WA_GRAPH_VERSION "Graph API version, optional, for example v21.0"
if [ ! -s "$tmp" ]; then echo "Nothing to set."; exit 0; fi
if $SB secrets set --env-file "$tmp" --project-ref "$REF" --yes >/dev/null; then echo "Done. The secrets are set. Next: docs/GO-LIVE-WA-CLOUD.md, step 5."; else echo "Could not set them. Check supabase login and try again."; exit 1; fi
