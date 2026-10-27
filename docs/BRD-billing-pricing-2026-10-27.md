# BRD: invoices, customers, payments and pricing list (admin panel)

Source: two handwritten pages from the owner, photographed 2026-10-27. Handwriting was read at high zoom; lines I could not read with confidence are marked **(?)** and listed under Open questions. Nothing here is built yet.

## 1. Purpose
Make the admin panel complete for daily billing: every invoice carries the details a customer expects, can be edited fully, can be deleted in bulk, and the money collected is visible on the booking and the customer. Add a Pricing list that the owner can extend, with prices shown before GST, and show the same rate card on the website.

## 2. What the notes say, and what exists today

| # | Note | Status today |
|---|---|---|
| N1 | Dashboard: all good. Bookings: all good. | Nothing to change. |
| N2 | Money menu, **Pricing list, "Add more option"** | A **Prices** tab exists (Money menu). It edits existing rows. No way to add new options from the screen **(?)**. |
| N3 | Pricing list shows prices **excluding GST** | Prices are stored and shown GST-inclusive everywhere (site, quote, desk). |
| N4 | **Website: Bangalore bike rate card** should show these prices **(?)** | `/services/` shows packages and prices (GST inclusive). No full rate card. |
| N5 | Admin panel: **edit option for admin** on the pricing rows (Basic, Standard, Full = Pro/Paid **(?)**, 30 days **(?)** warranty) | Warranty days and prices are editable in different places. |
| N6 | **Invoice edit: all edits, all items** | Exists: items, amounts, GST rate and basis (booking, Invoice card). Cannot change the customer block or the vehicle. |
| N7 | **When saving an invoice, these must be filled (and appear on the PDF):** serial number **(?)**, mobile, customer **(?)** | No required-field check. Invoice number is generated; name and phone come from the booking and can be blank-ish ("Customer"). |
| N8 | **Customer flow → top of invoice = customer name, customer phone, vehicle number, email (optional)** | Invoice shows name and phone; vehicle number (`bikes.reg_no`) is not on the invoice; email already optional. |
| N9 | **Clicking an invoice in the list should open it for editing** | The Invoices register lists rows; opening goes to the booking, not an editor. |
| N10 | **Select and delete option for invoices** | Delete exists per booking (hidden, restorable, with reason). No multi-select in the register. |
| N11 | **Payment: a shareable link for online payment collection** (company payment) **(?)** | Per-booking Razorpay link exists (`payment-link`). No reusable shareable link not tied to a booking. |
| N12 | **In the booking, show what the customer has paid** | Booking has payment figures in the payout card; not obvious at the top of the booking. |
| N13 | **In the customer view: vehicle number and the customer's total spend** | Customer sheet shows bikes (model names), bookings count and "Paid so far". Vehicle number not shown with the bikes. |

## 3. Requirements (what "done" means)

**R1. Invoice header and mandatory details** (N7, N8)
- Invoice top block: customer name, customer phone, vehicle registration number, email (optional), invoice number, date.
- Saving or issuing an invoice is blocked until name, phone (10 digits) and vehicle number are filled; the missing field is named in plain words. Email stays optional.
- All of these print on the PDF and appear in the emailed invoice.
- Acceptance: with the vehicle number empty, Save shows "Add the vehicle number" and nothing is saved; with all three filled the invoice saves and the PDF shows them.

**R2. Full invoice editing** (N6, N9)
- From the Invoices register, clicking a row opens the invoice editor directly (customer block, vehicle, items, amounts, GST rate and basis).
- Edits keep revision history (revision number already exists); the old figures stay in the register.
- Acceptance: change a quantity, an amount and the vehicle number from the register, save, and the register total, PDF and email reflect it.

**R3. Select and delete invoices** (N10)
- Register has a Select mode with checkboxes, Select all shown, and Delete selected with one confirmation and a reason.
- Deleted invoices are hidden, not erased (accounting rule already in place), and can be restored.
- Acceptance: select three, delete with a reason, they leave the register and totals; Restore brings them back.

**R4. Payments visible** (N12, N13)
- Booking top shows Total, Paid, Balance and the last payment (amount, date, how).
- Customer sheet shows each vehicle with its registration number, plus Total spend (all paid amounts) and number of bookings.
- Acceptance: a booking with a ₹500 payment on a ₹1,200 invoice shows Paid ₹500, Balance ₹700; the customer sheet total includes it.

**R5. Shareable payment link for company collection** (N11 **(?)**)
- A reusable payment link (not tied to one booking) that the owner can copy and share, for money the company collects directly. Each payment made through it is recorded against a booking or a customer the admin picks, and shows in Collections.
- Acceptance: create link for an amount, pay in test mode, the payment appears under Collections and on the chosen booking.
- Depends on Razorpay payment pages or links; confirm the exact need before building (Open question 3).

**R6. Pricing list** (N2, N3, N4, N5)
- Money, Prices: add a new option (name, price, kind package/add-on, engine class if needed, warranty days) and edit or hide any row. Admin only.
- Show **Before GST**, **GST** and **Total** columns. Storage stays GST-inclusive so every other screen keeps working; the screen converts at 18%.
- Website rate card page for Bengaluru bikes built from the same rows, showing the price before GST and with GST, generated by the existing price sync.
- Acceptance: add an option "Chain set", it appears in the admin, in the booking choices, and on the website rate card after the next build.

## 4. Out of scope
Dashboard and Bookings (confirmed good). Desk, AiSensy, ads, and the Axlio partner pages.

## 5. Plan

Order is by risk and value. Each phase ends with tests green, a browser check, and a deploy.

| Phase | Work | Main files | Notes |
|---|---|---|---|
| 1 | **Invoice header and required fields (R1).** Add vehicle number to the invoice model, validate on save and issue, print on PDF and email. | `admin/invoice.js`, `supabase/functions/_shared/invoice.ts`, `admin/admin.js`, email template, tests | Invoice logic is duplicated in two files; change both and keep the existing parity test. Register snapshot gets a `vehicle_reg` column (new migration). |
| 2 | **Edit from register, multi-select delete (R2, R3).** | `admin/admin.js`, `admin/invoice-register.js`, `void_invoices` RPC (reuse) | Reuse existing hide/restore RPCs; add a batch call. |
| 3 | **Payments visible (R4).** Booking summary strip; customer sheet vehicle numbers and total spend. | `admin/admin.js`, `admin/customer-bookings.js`, `customerRows` | Read-only, low risk. |
| 4 | **Pricing list (R6).** Add-option form, before-GST view, warranty days per row, website rate card. | `admin/admin.js` Prices tab, `services` table (migration for `warranty_days`, `visible`), `scripts/sync_prices.py`, `scripts/build_pages.py` | Keep prices consistent across app.js defaults, build_pages.py, SQL seed and FAQ (project rule). Poster price list stays the source for current rows. |
| 5 | **Shareable payment link (R5).** | new edge function or extension of `payment-link`, ledger entry, Collections view | Build only after the question below is answered. |

Risks: invoice numbers and revisions are accounting records, so edits must never delete history; the engine-class price tiers must keep working when options are added; GST display must not change stored prices.

## 6. Open questions (answers change the build)
1. **Mandatory fields.** I read "serial number, mobile, customer". Do you mean: customer name, mobile number and vehicle registration number required, email optional? Is "serial number" the invoice number (already automatic) or something else?
2. **Pricing rows.** The notes show "Basic / Full" and "30 days". Should the admin edit the three packages plus add-ons only, or also add new package types?
3. **Shareable link.** Is this one fixed link for all company payments (like a payment page), or a link you create per amount and send to a customer? Where should payments be matched to bookings?
4. **Website rate card.** Show prices before GST, with GST, or both? One page for bikes only?
5. **Price shown on the site.** Notes say "excluding GST" for the list. Should customer-facing prices stay GST-inclusive as now (current rule, ₹499 etc.)?
