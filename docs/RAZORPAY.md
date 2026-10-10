# Razorpay payments

Two ways to take the ₹349 checkup and quote fee and final bills. Both mark the booking Paid in the admin.

1. **Payment links** (already live in code): in the admin, open a booking, set the amount, press "Create & send payment link". Razorpay's `payment_link.paid` webhook marks it Paid.
2. **Standard Checkout** (added 2026-10-10): the customer opens `https://mechanixpro.in/pay/`, enters the booking reference and the mobile number, and pays in Razorpay's payment window.

## How Standard Checkout works here

| Step | Where | What |
|---|---|---|
| 1 | function `create-order` | Checks the reference and number, works out what is due (the amount the admin set, else the ₹349 fee, minimum ₹1), creates a Razorpay order, returns the order id and the **public** key id |
| 2 | `/pay/` page (`assets/js/pay.js`) | Opens Razorpay's window with that order. Handles cancel and failed payments |
| 3 | function `verify-payment` | Checks the signature (HMAC-SHA256 of `order_id|payment_id` with the key secret), asks Razorpay for the payment itself (must be captured and belong to that order), then marks the booking Paid once. The same payment cannot be counted twice |

The key **secret** lives only in Supabase function secrets. It is never in the repo, the page or any response.

## Keys

```sh
npx supabase secrets set RAZORPAY_KEY_ID=<key id> RAZORPAY_KEY_SECRET=<key secret>
```

- `rzp_test_...` keys are **test mode**: no real money moves, and payment links created from the admin are test links too.
- For real payments, create **live** keys in the Razorpay Dashboard (after KYC) and run the same command with them. Then check Settings, Payment Capture is **automatic**, so payments are captured and show as paid.
- Webhook for payment links (unchanged): Dashboard, Webhooks, URL `https://mejdxsbpyscujpvbwvmg.supabase.co/functions/v1/razorpay-webhook`, event `payment_link.paid`, secret `RAZORPAY_WEBHOOK_SECRET`.
- Rotate the keys in the Razorpay Dashboard if they were ever pasted in a chat or email.

## Testing in test mode

1. Open `/pay/?ref=MP-XXXXXX`, enter the booking's mobile number, press Pay now.
2. Card `4100 2800 0000 1007`, any future expiry, CVV `123`, or UPI `success@razorpay`. Razorpay's test UPI id `test@razorpay` may also be offered. Choose Success on the bank page.
3. The page says "Payment received" and the booking shows Paid in the admin.

The page is kept out of search and is not linked from the site. Share the link only with a customer who needs to pay, such as `https://mechanixpro.in/pay/?ref=MP-AB12CD` in your WhatsApp message.
