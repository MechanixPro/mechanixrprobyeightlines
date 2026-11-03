# Crew technician workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In Crew, Care Buddies move an interested lead to "Technician assigned" or "Booking confirmed" in a few taps. Mubarak runs technicians as Technician lead, with a PIN search for the nearest technicians and garages. Each technician gets a no-login job link to report the amount collected and pay the company's share by Razorpay.

**Architecture:**
- **Database:** new Postgres RPCs (security definer, permission-checked like the existing `crm_*` functions) do every write.
- **Crew** (plain ES modules in `crm/`) calls them.
- **Pure rules** go in `crm/crm-rules.js`, so `node --test` covers them.
- **The technician page** is a static site page, `/job/`, that talks to a new edge function, `tech-job`. Only a SHA-256 hash of the token is stored.
- **Payments:** the company-share payment reuses `_shared/razorpay.ts` and the existing remittance path in `razorpay-webhook`.

**Tech Stack:** plain HTML/CSS/JS (no build), Supabase Postgres and Deno edge functions, Razorpay payment links, `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-03-crew-technician-workflow-design.md`

## Global Constraints
- **CSP:** no inline scripts on site or Crew pages. Use files plus `addEventListener`.
- **Secrets:** never put secrets in the repo. Supabase keys come from `assets/js/config.js` (public anon key only).
- **PII:** notes with Aadhaar, PAN, bank or card numbers are refused or left out (`hasPii`, `crm_has_pii`). Never show them on the job page.
- **Money:**
  - The technician's amount must be ₹0 to ₹1,00,000.
  - The company share uses `effectiveRate`: booking `commission_pct`, then `garage_pct` for garage jobs, then the technician's `payout_rate` if over 0, then `doorstep_pct`. Settings today are 30/30 with `payout_basis = before_gst`.
- **Token:** 32 random bytes as hex. Only the SHA-256 hex is stored. It expires 7 days after it's made, allows one report, and making a new one expires the old one for that booking.
- **Statuses:** booked = `paid`, `scheduled`, `completed`. Slots are `morning`, `afternoon`, `evening`, `asap`.
- **Copy:** plain English, sentence case, no prices in technician WhatsApp text.
- **Deploys:**
  - Deploy only after the owner says "apply and deploy". Commands are in `docs/PROJECT-MEMORY.md`.
  - Migrations are run with `npx supabase db query --remote --yes -f <file>`, after a dry run wrapped in `begin; … rollback;`.

## Review Focus
1. **A lead already Scheduled gets "Booking confirmed" again:** it must not error or re-send the customer messages twice. `crm_confirm_booking` is idempotent for the same technician, date and slot (Task 1 test).
2. **A technician opens an expired or replaced link:** they get a plain "This link has expired. Ask the desk for a new one." with no booking details (Task 6 test).
3. **The technician reports ₹0 or a share of ₹0:** no Razorpay link is made and the page says nothing is owed (Task 5 and Task 6 tests).
4. **A PIN outside the geo file** (for example 560114) still lists technicians who cover it exactly, then everyone else by area, and never crashes (Task 4 test).
5. **A Care Buddy without `assign_leads` sets a technician on their own lead:** this is allowed by the new RPCs. On someone else's lead it's refused (Task 1 test).

---

## Part 1: dispositions that move the lead

### Task 1: Database: new sub-dispositions and the two move RPCs

**Files:**
- Create: `supabase/migrations/20261220000000_desk_move_lead.sql`
- Test: `tests/desk-move-lead.test.mjs`

**Interfaces:**
- **Produces** `crm_assign_technician(p_id uuid, p_mechanic uuid, p_note text default null, p_next_action timestamptz default null) returns jsonb {ok, changed}`. It:
  - sets `mechanic_id`
  - sets `disposition = 'Interested'` and `sub_disposition = 'Technician assigned'`
  - sets `crm_next_action_at` when given
  - inserts a `crm_activities` row of kind `note`, with body "Technician assigned: <name>" plus the note
- **Produces** `crm_confirm_booking(p_id uuid, p_mechanic uuid, p_date date, p_slot text, p_note text default null) returns jsonb {ok, already}`. It:
  - sets the technician, `preferred_date`, `preferred_slot` and `status = 'scheduled'`
  - sets `disposition = 'Interested'` and `sub_disposition = 'Booking confirmed'`
  - inserts a `crm_activities` row of kind `status` with `status_to = 'scheduled'`
  - returns `already: true` and changes nothing if the lead is already scheduled with the same technician, date and slot
- **Both check:**
  - `crm_need_role()`, `crm_require('edit_leads')`
  - the lead is visible and owned by the caller, or the caller has `view_all_leads`
  - the lead is not `lost` or `completed`
  - the technician is `active` and its `onboarding_status` is `live` or `pilot`
- **`crm_confirm_booking` also checks:** the date is not in the past (IST) and the slot is in the slot list.

- [ ] **Step 1: Write the failing source test**

```js
test('move-lead migration adds the two sub-dispositions and both RPCs with their checks', () => {
  const m = read('supabase/migrations/20261220000000_desk_move_lead.sql');
  for (const s of ["('Interested','Technician assigned'", "('Interested','Booking confirmed'", 'function public.crm_assign_technician(p_id uuid, p_mechanic uuid', 'function public.crm_confirm_booking(p_id uuid, p_mechanic uuid, p_date date, p_slot text',
    "crm_require('edit_leads')", "onboarding_status in ('live','pilot')", "status in ('lost','completed')", "'already', true", "('morning','afternoon','evening','asap')", 'grant execute on function public.crm_confirm_booking']) assert.ok(m.includes(s), s);
});
```

- [ ] **Step 2: Run it.** Run: `node --test tests/desk-move-lead.test.mjs`. Expected: FAIL (ENOENT).
- [ ] **Step 3: Write the migration.** Insert the two rows into `crm_dispositions` with sort 14 and 15, using `on conflict … do update set active = true`. Then write both functions, revoke from public and grant to authenticated.
- [ ] **Step 4: Run the test.** Expected: PASS.
- [ ] **Step 5: Dry run on production in a rolled-back transaction, as a Care Buddy who owns a test lead and as one who doesn't.** Both RPCs should succeed on the owned lead. The other lead should raise "this lead belongs to a colleague". A second confirm should return `already=true`. End the dry run with `raise exception` so nothing is kept.
- [ ] **Step 6: Commit.** `git add supabase/migrations/20261220000000_desk_move_lead.sql tests/desk-move-lead.test.mjs && git commit -m "Desk: Technician assigned and Booking confirmed move the lead"`

### Task 2: Crew: "Move this lead" bar, the move forms and the confirmation email

**Files:**
- Modify: `crm/crm-rules.js` (add `moveCheck`)
- Modify: `crm/crm.js` (the sheet's move bar; a `moveDialog(kind)` modal with the technician picker, date and slot; calls the Task 1 RPCs; then offers "Send job to [name] on WhatsApp now")
- Modify: `supabase/functions/confirm-booking/index.ts` (also accept a signed-in active `crm_users` member when the lead is already `scheduled`: email only, no status change)
- Test: `tests/desk-move-lead.test.mjs`

**Interfaces:**
- **Consumes:** `crm_assign_technician` and `crm_confirm_booking` (Task 1), `rankTechs(board, lead)`, `techJobMessage(lead)`, `crm_tech_board(p_date)`.
- **Produces** `moveCheck(kind: 'assign'|'confirm', v: {mechanic_id, date, slot}, today: 'YYYY-MM-DD') -> { ok: true } | { ok: false, error: string }`. The errors are exactly:
  - "Choose the technician."
  - "Choose the date."
  - "Choose a time slot."
  - "The date is in the past."

- [ ] **Step 1: Write failing tests**

```js
import { moveCheck } from '../crm/crm-rules.js';
test('assigning needs a technician; confirming needs technician, date and slot, not in the past', () => {
  assert.deepEqual(moveCheck('assign', { mechanic_id: '' }, '2026-11-03'), { ok: false, error: 'Choose the technician.' });
  assert.equal(moveCheck('assign', { mechanic_id: 'm1' }, '2026-11-03').ok, true);
  assert.equal(moveCheck('confirm', { mechanic_id: 'm1', date: '', slot: 'morning' }, '2026-11-03').error, 'Choose the date.');
  assert.equal(moveCheck('confirm', { mechanic_id: 'm1', date: '2026-11-03', slot: '' }, '2026-11-03').error, 'Choose a time slot.');
  assert.equal(moveCheck('confirm', { mechanic_id: 'm1', date: '2026-11-02', slot: 'evening' }, '2026-11-03').error, 'The date is in the past.');
  assert.equal(moveCheck('confirm', { mechanic_id: 'm1', date: '2026-11-03', slot: 'asap' }, '2026-11-03').ok, true);
});
test('the sheet has the move bar, both RPCs, the WhatsApp offer and the email call', () => {
  const c = read('crm/crm.js'), f = read('supabase/functions/confirm-booking/index.ts');
  for (const s of ['Move this lead', 'data-act="move"', "rpc('crm_assign_technician'", "rpc('crm_confirm_booking'", 'Send job to', "invoke('confirm-booking'"]) assert.ok(c.includes(s), s);
  assert.match(f, /crm_users/); assert.match(f, /status !== 'scheduled'|status === 'scheduled'/);
});
```

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **Move bar buttons:** `Assign technician` (kind `assign`), `Confirm booking` (`confirm`), `Call back later` (opens the log form with disposition `Call backs`) and `Not interested` (opens the log form with disposition `Not interested`).
  - **When the bar shows:** only when `canAct` and the status is not `lost` or `completed`.
  - **Picking "Technician assigned" or "Booking confirmed" in the log form's sub-disposition** opens `moveDialog` instead of saving through `crm_log`.
  - **After a successful confirm:** call `sb.functions.invoke('confirm-booking', { body: { lead_id } })`. Don't block on its result; show a toast if it fails.
- [ ] **Step 4: Run the full suite.** Run: `npm test` and `node --check crm/*.js crm/pages/*.js`. Expected: all pass.
- [ ] **Step 5: Commit.**

## Part 2: technician lead and PIN search

### Task 3: Database: `manage_technicians` permission, Technician lead preset and PIN backfill

**Files:**
- Create: `supabase/migrations/20261221000000_desk_technician_lead.sql`
- Modify: `crm/crm.js`, `crm/pages/booking.js`, `crm/pages/team.js` (replace `can('assign_leads')` around technician features with `canTech()` = `can('assign_leads') || can('manage_technicians')`; add a designation option `['tech_lead', 'Technician lead']`)
- Test: `tests/desk-technician-lead.test.mjs`

**Interfaces:**
- **Produces:** the action `manage_technicians`, added to `crm_actions()`.
- **Produces:** a `crm_preset` branch for designation `tech_lead`:
  - pages `leads`, `mechanics`, `garages`
  - actions `view_all_leads`, `edit_leads`, `manage_mechanics`, `manage_technicians`
- **Changes these to accept `assign_leads` or `manage_technicians`:**
  - `crm_tech_board`, `crm_unstaffed_jobs`
  - the `mechanic_id` branch of `crm_update_booking`. Patch the live text with `pg_get_functiondef` and `replace`, and raise if unchanged.
- **One-time backfill:** `update mechanics set pincodes = array[(regexp_match(name, '(56[0-9]{4})'))[1]] where pincodes = '{}' and name ~ '56[0-9]{4}'`.

- [ ] **Step 1: Failing source test.** Assert that the migration contains `'manage_technicians'`, `'tech_lead'` and `regexp_match(name, '(56[0-9]{4})')`, that `crm_update_booking was not patched` guards the patch, and that `crm/crm.js` defines `canTech`.
- [ ] **Step 2: Run it.** Expected: FAIL.
- [ ] **Step 3: Implement** the migration and the UI swaps. When you redefine `crm_actions()`, copy the current list verbatim from `pg_get_functiondef('public.crm_actions()'::regprocedure)` and append the new action.
- [ ] **Step 4: Dry run (rolled back).** After the backfill, all 6 technicians should have one PIN. As a user with only `manage_technicians`, `crm_tech_board(null)` should succeed.
- [ ] **Step 5: Commit.**

### Task 4: Crew: "Find by PIN"

**Files:**
- Modify: `crm/crm-rules.js` (add `nearestByPin`)
- Modify: `scripts/build_crm.sh` (copy `assets/js/pingeo.js` to `dist-crm/assets/js/`)
- Modify: `crm/index.html` (`<script src="/assets/js/pingeo.js" defer></script>` before `crm.js`)
- Modify: `crm/crm.js` (a "Find by PIN" box on My day for `canTech()` users) and `crm/pages/mechanics.js` (the same box)
- Test: `tests/desk-pin-search.test.mjs`

**Interfaces:**
- **Consumes:** `crm_tech_board(null).techs` (`id`, `name`, `area`, `pincodes`, `jobs`) and `crm_garage_picker()` (it must return `pincode`; add it in this task's migration only if it's missing), plus `window.MXP_PIN_GEO` (PIN → `[lat, lng, …]`).
- **Produces** `nearestByPin(pin: string, techs: Tech[], garages: Garage[], geo: Record<string, number[]>) -> { pinKnown: boolean, techs: Array<{id, name, area, covers: boolean, km: number|null, jobs: number}>, garages: Array<{id, name, pincode, km: number|null}> }`.
  - **Technicians:** those who cover the PIN come first, then everyone else by km. km is the haversine distance from the searched PIN's centre to the centre of the technician's first PIN, rounded to 0.1. A missing centre sorts last, with `km = null`.
  - **Garages:** sorted by km, with the same rule.
  - **Validation:** an invalid PIN (not 6 digits) throws `Error('Enter a 6-digit PIN code.')`.

- [ ] **Step 1: Failing tests.** Use a 3-PIN geo fixture, `560102` [12.91, 77.64], `560068` [12.90, 77.63] and `560004` [12.945, 77.576]:
  - techs covering 560068 and 560004 come back as covers-first
  - for an unknown PIN `560114`, `pinKnown` is false and coverers still come first
  - `'5601'` throws the exact message
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.** The results modal lists technicians as "Name · area · covers 560068 · 2.3 km · 1 job today" and garages as "Name · 560034 · 4.1 km". It shows "No garages near this PIN yet." when the list is empty.
- [ ] **Step 4: Run `npm test`, build with `bash scripts/build_crm.sh`, and check that `dist-crm/assets/js/pingeo.js` exists.**
- [ ] **Step 5: Commit.**

## Part 3: technician job link and company share

### Task 5: Shared money and token rules

**Files:**
- Create: `supabase/functions/_shared/tech-job.ts`
- Test: `tests/tech-job.test.mjs` (import the `.ts` the same way `tests/agentive.test.mjs` imports `_shared/agentive.ts`)

**Interfaces:**
- **Produces** `sha256Hex(text: string): Promise<string>`, using Web Crypto. It must match Postgres `encode(extensions.digest(t, 'sha256'), 'hex')`.
- **Produces** `techPct({ lead, mechanic, settings }): number`, a port of `admin/commission.js#effectiveRate` that returns only `pct`.
- **Produces** `companyShare({ collected: number, pct: number, basis: 'before_gst'|'collected', invoice?: { total: number, taxable: number } | null }): { mechanicCut: number, company: number }`:
  - **Base:**
    - with basis `before_gst` and an invoice whose total is over 0, the base is `collected × taxable / total`
    - otherwise the base is `collected`
  - **Mechanic cut:** `round2(base × pct / 100)`
  - **Company share:** `round2(collected − mechanicCut)`, never below 0
- **Produces** `cleanReport(body) -> { ok: true, value: { t: string, amount: number, note: string|null } } | { ok: false, error: string }`:
  - `t` must be 64 hex characters
  - `amount` must be 0 to 100000, with 2 decimals at most
  - `note` is up to 300 characters, and is dropped if `hasPii`-like digits appear

- [ ] **Step 1: Failing tests.**
  - `companyShare({ collected: 1000, pct: 30, basis: 'collected' })` → `{ mechanicCut: 300, company: 700 }`
  - with basis `before_gst` and invoice `{ total: 1180, taxable: 1000 }`, collected 1180 → `{ mechanicCut: 300, company: 880 }`
  - collected 0 → company 0
  - `techPct` gives 25 when `lead.commission_pct = 25`, the garage pct when `job_place = 'garage'`, the technician's `payout_rate` when it's over 0, and otherwise `doorstep_pct`
  - `cleanReport` rejects `amount: -1`, `amount: 100001` and a short token
  - `sha256Hex('abc')` = `ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad`
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 6: Database table, link RPC and the `tech-job` edge function

**Files:**
- Create: `supabase/migrations/20261222000000_tech_job_links.sql`
- Create: `supabase/functions/tech-job/index.ts`
- Test: `tests/tech-job.test.mjs`

**Interfaces:**
- **Table `tech_job_links`:**
  - `id uuid pk`
  - `lead_id uuid not null references leads`
  - `mechanic_id uuid not null references mechanics`
  - `token_hash text unique not null`
  - `created_by uuid`
  - `created_at timestamptz default now()`
  - `expires_at timestamptz not null`
  - `opened_at timestamptz`
  - `reported_at timestamptz`
  - `amount_collected numeric(12,2)`
  - `company_share numeric(12,2)`
  - `pay_link_url text`
  - RLS on, with no policies (only the service role reads it).
- **`ledger_entries.source` check:** add `'technician'` to it (drop and re-add the constraint by name; look the name up in `pg_constraint`).
- **Produces** `crm_tech_link(p_lead uuid) returns text`, the full URL `https://mechanixpro.in/job/?t=<hex>`. It:
  - needs `assign_leads` or `manage_technicians`, or the lead's owner with `edit_leads`
  - needs `mechanic_id` to be set
  - expires the other open links for the lead by setting `expires_at = now()`
  - stores `encode(extensions.digest(tok, 'sha256'), 'hex')`, where `tok = encode(extensions.gen_random_bytes(32), 'hex')`
- **Edge function `tech-job`** (public, `--no-verify-jwt`):
  - **`POST {action:'get', t}` returns:** `{ ref, first_name, phone, bike, service, address, area, when, notes, reported: boolean, company_share?, pay_url? }`.
  - **`POST {action:'report', t, amount, note}`:**
    1. computes the share (Task 5)
    2. inserts the ledger row `customer_payment`, `collected_by: 'mechanic'`, `source: 'technician'`, `mechanic_id`, `lead_id`
    3. if the share is 1 or more, makes a Razorpay link with `notes: { purpose: 'remittance', mechanic_id, lead_id }` and the description `Company share for booking <ref>`
    4. updates the link row, and inserts a `crm_activities` note "Technician reported ₹X collected. Company share ₹Y."
    5. returns `{ ok, company_share, pay_url|null }`
  - **Every error** returns `{ error }` with one of the exact messages:
    - "This link is not valid."
    - "This link has expired. Ask the desk for a new one."
    - "This job is already reported." (with the stored share and URL)
  - **Rate limit:** 20 requests per 10 minutes per IP hash. Log each one in `audit_log` with the action `tech_job_hit`. The 21st gets "Too many tries. Wait a few minutes."

- [ ] **Step 1: Failing source tests.** Check:
  - the migration has `token_hash text unique`, `'technician'`, `function public.crm_tech_link(p_lead uuid)`, `extensions.gen_random_bytes(32)` and `expires_at = now()`
  - the function has the three exact error strings, `purpose: 'remittance'`, `source: 'technician'` and `tech_job_hit`
  - the function does not reference `prices` or `est_total` in the `get` reply
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Dry run the migration (rolled back).** Inside the transaction, as a supervisor, call `crm_tech_link` on a booking that has a technician. Check that the URL matches `^https://mechanixpro.in/job/\?t=[0-9a-f]{64}$` and that a row exists.
- [ ] **Step 5: Commit.**

### Task 7: The `/job/` page and the WhatsApp link in Crew

**Files:**
- Create: `job/index.html`, `assets/js/job.js`, `assets/css/job.css` (small, using existing tokens)
- Modify: `scripts/build_site.sh` (add `job` to the copied directories)
- Modify: `crm/crm.js` (the "Send job to" button and the post-move offer call `crm_tech_link` first, then open WhatsApp with `techJobMessage(l)` plus `\n\nAfter the job, update the amount collected here: <url>`)
- Modify: `crm/crm-rules.js` (`techJobMessage(l, url?)` adds that line when `url` is given)
- Test: `tests/tech-job.test.mjs`, `tests/desk-technician.test.mjs`

**Interfaces:**
- **Consumes:** the `tech-job` edge function (Task 6) and `window.MXP.supabaseUrl` and `supabaseAnonKey` from `config.js`.
- **The page:**
  - It reads `t` from the query string and calls `get`.
  - It shows the job.
  - It has a form: an "Amount collected from the customer (₹)" number input with `inputmode="decimal"` and a label, an optional note and a "Submit" button.
  - It shows the result: "Pay ₹Y company share" as a button link to `pay_url`, or "Nothing to pay to the company for this job."
  - Already-reported jobs open straight to the result.
  - It's `noindex`, with no analytics tags.

- [ ] **Step 1: Failing tests.**
  - `techJobMessage(lead, 'https://mechanixpro.in/job/?t=ab')` ends with "After the job, update the amount collected here: https://mechanixpro.in/job/?t=ab"
  - `job/index.html` has no inline `<script>` content and contains `noindex` and `/assets/js/job.js`
  - `build_site.sh` lists `job`
  - `crm/crm.js` calls `crm_tech_link`
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `npm test`, build both sites, check them with `node --check`, and open `/job/?t=bad` locally at phone width. Expect "This link is not valid."**
- [ ] **Step 5: Commit.**

### Task 8: Go-live check (after the owner says "apply and deploy")
- [ ] Apply migrations 20261220, 20261221 and 20261222 in order. Deploy `tech-job` and `confirm-booking`. Deploy Crew and the site.
- [ ] Make a link for a test booking. Report ₹100. Check that the ledger row has `source = technician` and that the Razorpay link exists. Don't pay it. Reverse the ledger test row in the admin with the reason "test".
- [ ] Push.
