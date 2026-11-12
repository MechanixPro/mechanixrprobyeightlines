# Cashfree cutover (Razorpay to Cashfree)

Everything is built behind one switch. Until you set `PAYMENT_GATEWAY=cashfree`, the site keeps using Razorpay exactly as before.

## What the switch does

| `PAYMENT_GATEWAY` | Behaviour |
|---|---|
| unset, empty or `razorpay` | Razorpay (today's behaviour) |
| `cashfree` | Checkout, Payment Links, desk, technician, garage and mechanic links all use Cashfree |
| anything else | Payments are treated as not available (fails closed, never guesses) |

With `cashfree` selected and the Cashfree keys missing, every charge fails with "Cashfree keys are not configured". It never falls back to Razorpay.

A payment already in flight survives a switch: `verify-payment` and the webhooks of each gateway keep working whenever that gateway's keys are still set. Do not delete the Razorpay secrets until old links have expired (3 days).

## Secrets (Edge Function environment)

Run these in your own terminal, in the project folder. Replace the placeholders. Never paste real values into chat or into the repo.

```
npx supabase secrets set CASHFREE_ENV=sandbox
npx supabase secrets set CASHFREE_APP_ID=[Cashfree App ID]
npx supabase secrets set CASHFREE_SECRET_KEY=[Cashfree Secret Key]
```

Do NOT set `PAYMENT_GATEWAY` yet for the first step below. Optional: `CASHFREE_API_VERSION=[version]` (default `2026-01-01`).

## Deploy (owner-run, after review)

```
npx supabase functions deploy cashfree-webhook --no-verify-jwt
npx supabase functions deploy create-order verify-payment book-start payment-link desk-payment-link mechanic-pay-link tech-job garage-app mechanic-app whatsapp-webhook
```

Then deploy the site (new CSP in `_headers` and the updated `pay.js` and `book-pay.js`).

## Cashfree dashboard

1. Developers, Webhooks (Payment Gateway), add this endpoint URL:
   `https://mejdxsbpyscujpvbwvmg.supabase.co/functions/v1/cashfree-webhook`
2. Enable these events: **Payment Success**, **Payment Failed**, **Payment User Dropped**, and the **Payment Link** event if the dashboard lists it separately.
3. Use the same webhook version for sandbox and production. The code reads `data.order.order_id` and does not trust the payload amounts: it asks Cashfree's API about the order.
4. Whitelist the Supabase server IPs only if your Cashfree account has IP whitelisting turned on (the API calls come from Supabase Edge Functions).

## Test in sandbox first

1. Secrets: `CASHFREE_ENV=sandbox` with your sandbox App ID and Secret Key. Register the webhook URL in the sandbox dashboard.
2. Turn the switch on: `npx supabase secrets set PAYMENT_GATEWAY=cashfree` (secrets apply to the next request; redeploy only if a function is cached).
3. On `/book/` or `/pay/`, use Cashfree's sandbox test UPI/card details. Check:
   - the Cashfree window opens, payment completes, the page shows "confirmed";
   - the booking gets its ID, one WhatsApp and the confirmation emails go out once;
   - a ledger row exists: customer payment, source gateway, collected by company portal, the Cashfree payment id as the transaction id;
   - close the tab right after paying: the webhook alone confirms the booking;
   - a desk payment link, a technician final-bill link and a mechanic company-share link each pay and record correctly;
   - the same payment never records twice (replay the webhook from the Cashfree dashboard).
4. Check Supabase function logs for `cashfree` errors (messages never contain keys).

## Go-live checklist

- [ ] Sandbox test above passed, including the closed-tab case and a payment link.
- [ ] Production App ID and Secret Key set; `CASHFREE_ENV=production`.
- [ ] Webhook URL registered in the PRODUCTION dashboard with the events above.
- [ ] `PAYMENT_GATEWAY=cashfree` set.
- [ ] Rs 1 real test: make a desk payment link for Rs 1 (or a Rs 1 order from a test booking), pay it with your own UPI, confirm the ledger row, the booking status and that the money shows in Cashfree. Refund it from the Cashfree dashboard and record the refund in the Admin ledger.
- [ ] Decide the public wording (privacy, terms, refund policy, emails and the pay pages still say "Razorpay"). These were deliberately not changed.
- [ ] Update the garage agreement payout wording ("one day after Razorpay settles") when you are ready.

## Roll back

```
npx supabase secrets set PAYMENT_GATEWAY=razorpay
```

New payments use Razorpay again at once. Cashfree links already sent stay payable until they expire and the Cashfree webhook still records them, as long as the Cashfree keys stay set.

## Notes for the owner

- Amounts are in rupees for Cashfree (`order_amount: 349`), paise for Razorpay. The server computes every amount; the browser never sends one.
- `leads.rzp_order_id` is reused to store the Cashfree order id too (no database change). An order id from the other gateway is never reused.
- Refunds remain a manual Admin ledger record; do the actual refund in the payment gateway dashboard.
- The gateway fee is recorded as 0 for Cashfree because the payments API does not return it; adjust in the ledger if you want the settled fee.
- Not verified live (nothing was called): see the assumptions list in the build report.
