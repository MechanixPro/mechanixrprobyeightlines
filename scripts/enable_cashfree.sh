#!/bin/bash
# OWNER RUNS THIS (not Claude). Switches online payments to Cashfree ONLY when Cashfree is fully set up for real money, and can switch back.
#   bash scripts/enable_cashfree.sh            check, then switch to Cashfree
#   bash scripts/enable_cashfree.sh rollback   switch back to Razorpay at once
# It reads only the names and hashes of the secrets (never their values). It refuses to switch when:
#   - CASHFREE_APP_ID or CASHFREE_SECRET_KEY is missing, or
#   - CASHFREE_ENV is not exactly "production" (sandbox keys cannot take real money, and Live keys do not work on sandbox).
set -e
REF="mejdxsbpyscujpvbwvmg"
if command -v supabase >/dev/null; then SB="supabase"; elif command -v npx >/dev/null; then SB="npx supabase"; else echo "Install Node (npx) or the Supabase CLI first."; exit 1; fi
sha() { printf '%s' "$1" | shasum -a 256 | cut -d' ' -f1; }

if [ "$1" = "rollback" ]; then
  $SB secrets set PAYMENT_GATEWAY=razorpay --project-ref "$REF" --yes >/dev/null 2>&1 && echo "Done. Payments are back on Razorpay." || { echo "Could not set it. Check you are logged in (supabase login)."; exit 1; }
  exit 0
fi

# CF_TEST_LIST=<file> lets the checks be tested without Supabase; normal use reads the real list.
if [ -n "$CF_TEST_LIST" ]; then out="$(cat "$CF_TEST_LIST")"; else out="$($SB secrets list --project-ref "$REF" 2>/dev/null)"; fi
digest() { printf '%s\n' "$out" | awk -v n="$1" '$1 == n { print $3 }'; }
app="$(digest CASHFREE_APP_ID)"; key="$(digest CASHFREE_SECRET_KEY)"; env="$(digest CASHFREE_ENV)"; gw="$(digest PAYMENT_GATEWAY)"
ok=1
[ -n "$app" ] && echo "OK    CASHFREE_APP_ID is set" || { echo "STOP  CASHFREE_APP_ID is missing"; ok=0; }
[ -n "$key" ] && echo "OK    CASHFREE_SECRET_KEY is set" || { echo "STOP  CASHFREE_SECRET_KEY is missing (npx supabase secrets set CASHFREE_SECRET_KEY=<your Live secret key>)"; ok=0; }
if [ "$env" = "$(sha production)" ]; then echo "OK    CASHFREE_ENV is production"
elif [ "$env" = "$(sha sandbox)" ]; then echo "STOP  CASHFREE_ENV is sandbox. Live keys need: npx supabase secrets set CASHFREE_ENV=production"; ok=0
else echo "STOP  CASHFREE_ENV is missing or not production/sandbox"; ok=0; fi
if [ "$gw" = "$(sha cashfree)" ]; then echo "NOTE  PAYMENT_GATEWAY is already cashfree"; fi
[ "$ok" = "1" ] || { echo; echo "Nothing was changed. Fix the STOP lines and run this again."; exit 1; }

echo
echo "Live payments will go through Cashfree for every customer, the website, desk links, technician and garage links."
printf "Switch now? Type yes: "; read -r yes; [ "$yes" = "yes" ] || { echo "Cancelled. Nothing changed."; exit 1; }
$SB secrets set PAYMENT_GATEWAY=cashfree --project-ref "$REF" --yes >/dev/null 2>&1 && echo "Done. Payments now use Cashfree (production)." || { echo "Could not set it. Check you are logged in (supabase login)."; exit 1; }
echo "If anything looks wrong:  bash scripts/enable_cashfree.sh rollback"
echo "Now make your own small test booking and tell Claude."
