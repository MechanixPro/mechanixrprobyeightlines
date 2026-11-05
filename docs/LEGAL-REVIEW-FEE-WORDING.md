# Legal review: confirmation fee wording (for the owner's lawyer)

**Change.** The Rs 349 "checkup and quote fee" and the Rs 99 "new customer slot fee" are retired. One **confirmation fee** replaces them: *a small confirmation fee, Rs 49 to Rs 99 depending on your vehicle's engine size, shown before you pay and adjusted in your final bill.*

Tiers (from one source: `DEFAULTS` in `assets/js/book-pay.js`, mirrored in `supabase/functions/_shared/confirm-fee.ts`): Rs 49 up to 149cc, Rs 69 for 150 to 250cc, Rs 99 for 251cc and above and for cars.

**No new refund rules were invented.** The existing timing and outcome now apply to the confirmation fee: more than 2 hours before the slot, refunded in full; less than 2 hours before, or after the mechanic has left, not refunded; emergency (SOS) visits unchanged. The separate "New customers" line is removed because there is no longer a separate new-customer fee.

Status: **draft wording, needs lawyer approval before deploy.**

## A. Legal pages (these need approval)

### /terms/ section 2 "Booking"
- **Old text:** You can request a booking on our website or WhatsApp. A booking is confirmed when we confirm your slot and you pay the checkup and quote fee (currently Rs 349). The fee is adjusted in your final bill if you go ahead with the service. New customers, meaning a mobile number with no earlier completed job, pay a reduced slot fee of Rs 99 instead, on the same terms.
- **New text:** You can request a booking on our website or WhatsApp. A booking is confirmed when you pay the confirmation fee and we confirm your slot. The confirmation fee is a small amount, Rs 49 to Rs 99 depending on your vehicle's engine size (Rs 49 up to 149cc, Rs 69 for 150 to 250cc, Rs 99 for 251cc and above and for cars), shown before you pay. It is adjusted in your final bill if you go ahead with the service.

### /terms/ section 4 "Payment"
- **Old text:** The checkup and quote fee and final payments are made through Razorpay (UPI, cards, wallets, net banking) or as agreed with us. Invoices show GST separately.
- **New text:** The confirmation fee and final payments are made through Razorpay (UPI, cards, wallets, net banking) or as agreed with us. Invoices show GST separately.

### /refund-policy/ "Cancelling a booking" (line 1)
- **Old text:** More than 2 hours before your slot: free. Your Rs 349 checkup and quote fee is refunded in full.
- **New text:** More than 2 hours before your slot: free. Your confirmation fee is refunded in full.

### /refund-policy/ "Cancelling a booking" (line 2)
- **Old text:** Less than 2 hours before, or after the mechanic has left: the Rs 349 checkup and quote fee covers the visit and is not refunded.
- **New text:** Less than 2 hours before, or after the mechanic has left: the confirmation fee covers the visit and is not refunded.

### /refund-policy/ "Cancelling a booking" (line 3, removed)
- **Old text:** New customers: the Rs 99 slot fee follows the same rules, so it is refunded in full if you cancel more than 2 hours before your slot.
- **New text:** (line removed; the confirmation fee in lines 1 and 2 covers every customer)

Unchanged: "Emergency (SOS) visits: cancellable free until a mechanic is assigned.", "If we cancel", "Service issues", "How refunds are paid".

## B. Customer-facing FAQ, how-it-works and summary text (same rule, plain tone)

| Page | Old text | New text |
|---|---|---|
| /help/ step 3 | Say yes on WhatsApp and we lock your slot. The Rs 349 checkup and quote fee confirms your booking and is adjusted in your final bill if you go ahead with the service. New customers pay only Rs 99. | Say yes on WhatsApp and we lock your slot. You pay a small confirmation fee, Rs 49 to Rs 99 depending on your vehicle's engine size, shown before you pay and adjusted in your final bill, and it confirms your booking. |
| /help/ FAQ "How do I confirm my booking?" (and its FAQPage JSON-LD) | ...a secure Razorpay link to pay the Rs 349 checkup and quote fee (Rs 99 for new customers). It confirms your booking and is adjusted in your final bill if you go ahead with the service. | ...a secure Razorpay link to pay a small confirmation fee, Rs 49 to Rs 99 depending on your vehicle's engine size, shown before you pay and adjusted in your final bill. It confirms your booking. |
| /help/ FAQ "Can I cancel?" | Yes. Cancel free up to 2 hours before your slot and the Rs 349 checkup and quote fee is refunded. | Yes. Cancel free up to 2 hours before your slot and your confirmation fee is refunded in full. |
| / (home) FAQ "What does it cost?" (and FAQPage JSON-LD) | ...New customers pay only Rs 99 to lock a slot after approving the quote, returning customers pay Rs 349. It is adjusted in your final bill. | ...To confirm your slot you pay a small confirmation fee, Rs 49 to Rs 99 depending on your vehicle's engine size, shown before you pay and adjusted in your final bill. |
| / (home) FAQ "Can I cancel?" (and JSON-LD) | Yes. Cancel more than 2 hours before your slot and the slot fee is refunded in full. | Yes. Cancel more than 2 hours before your slot and your confirmation fee is refunded in full. |
| 34 area pages /bike-service-*/ FAQ "How much is a bike service in ...?" (and JSON-LD) | A Rs 349 checkup and quote fee (Rs 99 for new customers) holds your slot and is adjusted in your bill. | To hold your slot you pay a small confirmation fee, Rs 49 to Rs 99 depending on your vehicle's engine size, shown before you pay and adjusted in your final bill. |
| 34 area pages, how-it-works step 3 | ...we lock your slot (Rs 349 checkup and quote fee, Rs 99 for new customers, adjusted in your bill if you go ahead), and the mechanic arrives. | ...we lock your slot (a small confirmation fee, Rs 49 to Rs 99 depending on your vehicle's engine size, shown before you pay and adjusted in your final bill), and the mechanic arrives. |
| 171 model pages /bike-service/*/ how-it-works step 3 | ...The Rs 349 checkup and quote fee (Rs 99 for new customers) is adjusted in your bill if you go ahead. | ...You pay a small confirmation fee, Rs 49 to Rs 99 depending on your vehicle's engine size, shown before you pay and adjusted in your final bill. |
| 172 model pages FAQ "Do I pay before the work starts?" (and JSON-LD); also the car/other page FAQ list | You approve the quote first. A Rs 349 checkup and quote fee (Rs 99 for new customers) holds your slot and is adjusted in your final bill if you go ahead. | You approve the quote first. To hold your slot you pay a small confirmation fee, Rs 49 to Rs 99 depending on your vehicle's engine size, shown before you pay and adjusted in your final bill. |
| 5 /offers/*/ pages, step 3 | ...The Rs 349 checkup and quote fee is adjusted in your bill if you go ahead. | ...The confirmation fee (Rs 49 to Rs 99, by engine size) is adjusted in your bill if you go ahead. |
| /rate-card/ footnote | ...The checkup and quote fee is adjusted in your final bill if you go ahead. | ...The confirmation fee (Rs 49 to Rs 99, by engine size) is adjusted in your final bill if you go ahead. |
| /pay/ footnote | ...the small confirmation fee for your vehicle, shown before you pay. ... Other bookings pay what is due on the booking, such as the Rs 349 checkup and quote fee. | ...the small confirmation fee for your vehicle (Rs 49 to Rs 99 by engine size), shown before you pay. ... such as the confirmation fee. |
| /llms.txt | Booking: a Rs 349 checkup and quote fee (Rs 99 for new customers) holds the slot and is adjusted in the final bill. | Booking: a small confirmation fee, Rs 49 to Rs 99 depending on your vehicle's engine size, shown before you pay and adjusted in your final bill (Rs 49 up to 149cc, Rs 69 for 150 to 250cc, Rs 99 for 251cc and above and for cars) holds the slot. |
| Old booking builder (assets/js/app.js, shown on the quote step) | After you approve the quote, a slot fee locks your visit: Rs 99 for new customers, Rs 349 for returning customers. It is adjusted in your final bill. ... / New customers pay only Rs 99 (returning customers Rs 349) to confirm the booking, adjusted in your final bill if you go ahead. | After you approve the quote, you pay a small confirmation fee, Rs 49 to Rs 99 depending on your vehicle's engine size, shown before you pay and adjusted in your final bill, to lock your visit. / To confirm the booking you pay a small confirmation fee, ... Final quote comes on WhatsApp. |

## C. Still old, not changed here (not public site pages; decide with the paid-confirmation builder)
- `supabase/functions/_shared/ai.ts` (WhatsApp assistant prompt) and `_shared/email-templates.ts` (booking emails) still say "checkup and quote fee". Tests `copy-rules` still assert that.
- `docs/RAZORPAY.md`, `docs/WHATSAPP-BOT.md`, `README.md` mention Rs 349 as history.
- Services-table rows `advance` (Rs 349) and `newfee` (Rs 99) stay in data for old leads; no public page shows them.

## D. Exceptions kept by the test `tests/fee-retired.test.mjs`
None. No public page or `llms.txt` contains "checkup and quote fee", "new customers pay/fee", "slot fee" or the figure 349.
