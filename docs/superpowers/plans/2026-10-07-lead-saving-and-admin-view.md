# Lead Saving and Admin View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Save the new booking details (kilometres, problems, note, where, contact preference, bike type, referrer, campaign) with every lead, and show them, plus a source report, in the admin panel.

**Architecture:** A pure validation module (`lead-fields.ts`) is shared by the `submit-lead` edge function and tested in Node. A new SQL migration adds the columns. The browser captures `?ref=` and campaign tags once per visit in `logic.js` and sends them with the lead. The admin panel reads the new columns through a small pure helper module.

**Tech Stack:** Plain JS (browser), TypeScript for Supabase Edge Functions (Deno), Postgres migrations, Node 26 built-in test runner (`node --test`, runs `.ts` directly).

**Spec:** `docs/superpowers/specs/2026-10-07-growth-features-design.md` (sections 3 and 4, build step 1)

## Global Constraints

- The site stays plain HTML/CSS/JS with no build step on the host.
- The CSP in `_headers` forbids inline scripts; use files and `addEventListener`.
- No secrets in the repo. Public config only in `assets/js/config.js`.
- Booking must still reach WhatsApp if saving the lead fails.
- Prices stay consistent across `app.js` defaults, `build_pages.py`, the SQL seed, the FAQ and the JSON-LD (this plan changes no prices).
- Tests run with `npm test` (`node --test tests/*.test.js tests/*.test.mjs`).

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/functions/_shared/lead-fields.ts` (create) | `cleanLeadFields(body)`: validates and normalises the new lead fields. No Deno APIs, so Node can test it. |
| `supabase/migrations/20261007000000_lead_details.sql` (create) | Adds the new columns, checks and indexes to `public.leads`. |
| `supabase/functions/submit-lead/index.ts` (modify) | Calls `cleanLeadFields` and stores the result. |
| `assets/js/logic.js` (modify) | Adds `captureAttribution`; `buildMessage` and `leadPayload` carry `ref_code` and `campaign`. |
| `assets/js/app.js` (modify) | Calls `captureAttribution` at start and keeps it in the build state. |
| `admin/lead-view.js` (create) | Pure helpers `leadDetailRows(lead)` and `sourceReport(leads)`. |
| `admin/admin.js` (modify) | Shows the new rows on a lead and a "Sources" report on the dashboard. |
| `tests/lead-fields.test.mjs`, `tests/migration.test.mjs`, `tests/attribution.test.js`, `tests/lead-view.test.mjs` (create) | One test file per unit above. |
| `package.json` (modify) | `test` script runs both `.js` and `.mjs` tests. |

---

### Task 1: Lead field validation

**Files:**
- Create: `supabase/functions/_shared/lead-fields.ts`
- Test: `tests/lead-fields.test.mjs`
- Modify: `package.json` (test script)

**Interfaces:**
- Produces: `cleanLeadFields(b: Record<string, unknown>): { km_band: string|null; issues: string[]; note: string|null; place: 'home'|'road'|'unsure'; contact_pref: 'whatsapp'|'call'; bike_type: 'm'|'s'|'e'|null; ref_code: string|null; campaign: string|null }`

- [ ] **Step 1: Write the failing test**

```js
// tests/lead-fields.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanLeadFields } from '../supabase/functions/_shared/lead-fields.ts';

test('empty body gives safe defaults', () => {
  assert.deepEqual(cleanLeadFields({}), { km_band: null, issues: [], note: null, place: 'home', contact_pref: 'whatsapp', bike_type: null, ref_code: null, campaign: null });
});
test('known values pass through', () => {
  const r = cleanLeadFields({ km_band: 'mid', issues: ['brake', 'chain'], note: 'rattle', place: 'road', contact_pref: 'call', bike_type: 's', ref_code: 'asha', campaign: 'Monsoon-Check' });
  assert.deepEqual(r, { km_band: 'mid', issues: ['brake', 'chain'], note: 'rattle', place: 'road', contact_pref: 'call', bike_type: 's', ref_code: 'ASHA', campaign: 'monsoon-check' });
});
test('unknown enum values are rejected to defaults', () => {
  const r = cleanLeadFields({ km_band: 'huge', place: 'moon', contact_pref: 'fax', bike_type: 'x' });
  assert.equal(r.km_band, null); assert.equal(r.place, 'home'); assert.equal(r.contact_pref, 'whatsapp'); assert.equal(r.bike_type, null);
});
test('issues are filtered to known ids, de-duplicated and capped', () => {
  assert.deepEqual(cleanLeadFields({ issues: ['brake', 'brake', 'nope', 7] }).issues, ['brake']);
  assert.equal(cleanLeadFields({ issues: 'brake' }).issues.length, 0);
});
test('note strips control characters and angle brackets and is capped at 300', () => {
  assert.equal(cleanLeadFields({ note: '<b>hi</b>\u0007 there' }).note, 'bhi/b there');
  assert.equal(cleanLeadFields({ note: 'x'.repeat(500) }).note.length, 300);
  assert.equal(cleanLeadFields({ note: '   ' }).note, null);
});
test('ref_code and campaign keep only safe characters and are capped', () => {
  assert.equal(cleanLeadFields({ ref_code: 'as ha!#1' }).ref_code, 'ASHA1');
  assert.equal(cleanLeadFields({ ref_code: 'a'.repeat(40) }).ref_code.length, 20);
  assert.equal(cleanLeadFields({ campaign: 'Ad Set #1' }).campaign, 'adset1');
  assert.equal(cleanLeadFields({ campaign: 'c'.repeat(100) }).campaign.length, 60);
});
```

- [ ] **Step 2: Update the test script and run to verify it fails**

In `package.json` set `"test": "node --test tests/*.test.js tests/*.test.mjs"`.

Run: `npm test`
Expected: FAIL with `Cannot find module .../lead-fields.ts` (the `.js` tests still pass).

- [ ] **Step 3: Write minimal implementation**

```ts
// supabase/functions/_shared/lead-fields.ts
// Validates the extra booking details sent by the website. No Deno APIs here so Node can test it.
const KM = ['new', 'lt3', 'mid', 'gt6', 'unsure'];
const ISSUES = ['start', 'pickup', 'brake', 'chain', 'clutch', 'gear', 'battery', 'tyre', 'leak', 'heat', 'elec', 'susp', 'rain', 'range', 'sw'];
const PLACES = ['home', 'road', 'unsure'];
const CONTACT = ['whatsapp', 'call'];
const TYPES = ['m', 's', 'e'];
const strip = (v: unknown, max: number) => String(v ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, max);
const pick = (list: string[], v: unknown) => (list.includes(String(v)) ? String(v) : null);

export function cleanLeadFields(b: Record<string, unknown>) {
  const issues = Array.isArray(b.issues) ? [...new Set(b.issues.map(String))].filter((i) => ISSUES.includes(i)).slice(0, 15) : [];
  return {
    km_band: pick(KM, b.km_band),
    issues,
    note: strip(b.note, 300) || null,
    place: pick(PLACES, b.place) ?? 'home',
    contact_pref: pick(CONTACT, b.contact_pref) ?? 'whatsapp',
    bike_type: pick(TYPES, b.bike_type),
    ref_code: strip(b.ref_code, 40).toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 20) || null,
    campaign: strip(b.campaign, 100).toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 60) || null,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: all pass, including 6 new tests.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/lead-fields.ts tests/lead-fields.test.mjs package.json
git commit -m "feat: validate extra lead fields"
```

---

### Task 2: Database migration

**Files:**
- Create: `supabase/migrations/20261007000000_lead_details.sql`
- Test: `tests/migration.test.mjs`

**Interfaces:**
- Consumes: `cleanLeadFields` from Task 1 (its output keys are the column names).
- Produces: columns `km_band, issues, note, place, contact_pref, bike_type, ref_code, campaign` on `public.leads`.

- [ ] **Step 1: Write the failing test**

```js
// tests/migration.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cleanLeadFields } from '../supabase/functions/_shared/lead-fields.ts';

const sql = readFileSync(new URL('../supabase/migrations/20261007000000_lead_details.sql', import.meta.url), 'utf8');

test('migration adds a column for every field the validator returns', () => {
  for (const key of Object.keys(cleanLeadFields({}))) {
    assert.match(sql, new RegExp('add column if not exists ' + key + '\\b'), 'missing column ' + key);
  }
});
test('migration is idempotent (only "if not exists" forms)', () => {
  assert.doesNotMatch(sql, /add column (?!if not exists)/);
  assert.doesNotMatch(sql, /create index (?!if not exists)/);
});
test('migration does not weaken row level security', () => {
  assert.doesNotMatch(sql, /disable row level security/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL with `ENOENT ... 20261007000000_lead_details.sql`.

- [ ] **Step 3: Write minimal implementation**

```sql
-- supabase/migrations/20261007000000_lead_details.sql
-- Extra booking details captured by the website builder, plus referral and campaign tracking.
alter table public.leads
  add column if not exists km_band text check (km_band in ('new','lt3','mid','gt6','unsure')),
  add column if not exists issues jsonb not null default '[]'::jsonb,
  add column if not exists note text check (char_length(note) <= 300),
  add column if not exists place text not null default 'home' check (place in ('home','road','unsure')),
  add column if not exists contact_pref text not null default 'whatsapp' check (contact_pref in ('whatsapp','call')),
  add column if not exists bike_type text check (bike_type in ('m','s','e')),
  add column if not exists ref_code text check (char_length(ref_code) <= 20),
  add column if not exists campaign text check (char_length(campaign) <= 60);

create index if not exists leads_ref_code_idx on public.leads (ref_code) where ref_code is not null;
create index if not exists leads_campaign_idx on public.leads (campaign) where campaign is not null;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261007000000_lead_details.sql tests/migration.test.mjs
git commit -m "feat: add lead detail columns"
```

---

### Task 3: Use the validator in submit-lead

**Files:**
- Modify: `supabase/functions/submit-lead/index.ts` (import near line 4; insert near the `leads` insert around line 62)
- Test: `tests/submit-lead-wiring.test.mjs`

**Interfaces:**
- Consumes: `cleanLeadFields` (Task 1), columns (Task 2).

- [ ] **Step 1: Write the failing test**

```js
// tests/submit-lead-wiring.test.mjs
// The edge function runs on Deno, so Node checks that it is wired to the validator and stores every field.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cleanLeadFields } from '../supabase/functions/_shared/lead-fields.ts';

const src = readFileSync(new URL('../supabase/functions/submit-lead/index.ts', import.meta.url), 'utf8');

test('submit-lead imports and calls cleanLeadFields', () => {
  assert.match(src, /import \{ cleanLeadFields \} from '\.\.\/_shared\/lead-fields\.ts'/);
  assert.match(src, /cleanLeadFields\(b\)/);
});
test('submit-lead stores every validated field on the lead row', () => {
  const insertBlock = src.slice(src.indexOf("from('leads').insert("));
  for (const key of Object.keys(cleanLeadFields({}))) assert.match(insertBlock, new RegExp('\\.\\.\\.extra|\\b' + key + '\\b'), 'not stored: ' + key);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL on the import assertion.

- [ ] **Step 3: Write minimal implementation**

In `supabase/functions/submit-lead/index.ts`:

1. Add after the existing `whatsapp.ts` import:
```ts
import { cleanLeadFields } from '../_shared/lead-fields.ts';
```
2. Right after the line `const date = clean(b.preferred_date, 10);` add:
```ts
  const extra = cleanLeadFields(b);
```
3. In the `db.from('leads').insert({ ... })` object, add `...extra,` as a new first property after `customer_id: cust.id, bike_id: bike?.id ?? null,` so the line reads:
```ts
    customer_id: cust.id, bike_id: bike?.id ?? null, ...extra, name, phone,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: all pass. If Deno is installed, also run `deno check supabase/functions/submit-lead/index.ts` and expect no errors.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/submit-lead/index.ts tests/submit-lead-wiring.test.mjs
git commit -m "feat: save extra booking details in submit-lead"
```

---

### Task 4: Referral and campaign capture in the browser

**Files:**
- Modify: `assets/js/logic.js` (add `captureAttribution`; edit `buildMessage` and `leadPayload`)
- Modify: `assets/js/app.js` (init)
- Test: `tests/attribution.test.js`

**Interfaces:**
- Produces: `captureAttribution(search: string, store: { getItem(k): string|null, setItem(k, v): void }): { ref_code: string|null, campaign: string|null }`. Reads `?ref=` and `?campaign=` or `?utm_campaign=`; a later visit with new values replaces earlier ones; values persist under the key `mxp_attr`.
- Produces: `buildMessage` adds a line `Referred by: <ref_code>` only when `st.ref_code` is set. `leadPayload` returns `ref_code` and `campaign` from `st`.

- [ ] **Step 1: Write the failing test**

```js
// tests/attribution.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../assets/js/logic.js');
const mem = () => { const m = {}; return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = v; } }; };
const st = (o) => Object.assign({ brand: 'Honda', model: 'Activa 6G', cc: 'std', nick: '', km: '', issues: [], note: '', service: 'general', addons: [], place: 'home', area: 'HSR Layout', slot: 'morning', name: 'Asha', phone: '9876543210', type: 's' }, o);
const ITEMS = [{ id: 'general', kind: 'service', name: 'General service', price: 1299 }];

test('reads ref and campaign from the query string', () => {
  assert.deepEqual(L.captureAttribution('?ref=asha&utm_campaign=Monsoon', mem()), { ref_code: 'ASHA', campaign: 'monsoon' });
});
test('accepts campaign as well as utm_campaign', () => {
  assert.equal(L.captureAttribution('?campaign=diwali', mem()).campaign, 'diwali');
});
test('remembers values for later pages in the visit', () => {
  const s = mem(); L.captureAttribution('?ref=asha', s);
  assert.equal(L.captureAttribution('', s).ref_code, 'ASHA');
});
test('a newer value replaces an older one', () => {
  const s = mem(); L.captureAttribution('?ref=asha', s);
  assert.equal(L.captureAttribution('?ref=ravi', s).ref_code, 'RAVI');
});
test('returns nulls when nothing is set and survives a broken store', () => {
  assert.deepEqual(L.captureAttribution('', mem()), { ref_code: null, campaign: null });
  const bad = { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); } };
  assert.deepEqual(L.captureAttribution('?ref=a', bad), { ref_code: 'A', campaign: null });
});
test('message names the referrer only when there is one', () => {
  assert.match(L.buildMessage(st({ ref_code: 'ASHA' }), ITEMS, {}, 'Tomorrow'), /Referred by: ASHA/);
  assert.doesNotMatch(L.buildMessage(st(), ITEMS, {}, 'Tomorrow'), /Referred by/);
});
test('lead payload carries ref_code and campaign', () => {
  const p = L.leadPayload(st({ ref_code: 'ASHA', campaign: 'monsoon' }), '2026-10-08');
  assert.equal(p.ref_code, 'ASHA'); assert.equal(p.campaign, 'monsoon');
  assert.equal(L.leadPayload(st(), '2026-10-08').ref_code, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL with `L.captureAttribution is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `assets/js/logic.js` add before the `return { callLink: ...` line:

```js
  function captureAttribution(search, store) {
    var p = new URLSearchParams(search || ''), saved = {};
    try { saved = JSON.parse(store.getItem('mxp_attr') || '{}') || {}; } catch (e) { saved = {}; }
    var ref = (p.get('ref') || '').toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 20);
    var camp = (p.get('campaign') || p.get('utm_campaign') || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 60);
    var out = { ref_code: ref || saved.ref_code || null, campaign: camp || saved.campaign || null };
    try { store.setItem('mxp_attr', JSON.stringify(out)); } catch (e) {}
    return out;
  }
```

In `buildMessage`, add after the `Contact me by` line:
```js
    if (st.ref_code) lines.push('Referred by: ' + st.ref_code);
```
In `leadPayload`'s returned object, add `ref_code: st.ref_code || null, campaign: st.campaign || null,`.
Add `captureAttribution: captureAttribution,` to the returned API object.

In `assets/js/app.js` `init()`, after `utm(); analytics();` add:
```js
    var attr = L.captureAttribution(location.search, (function () { try { return sessionStorage; } catch (e) { return { getItem: function () { return null; }, setItem: function () {} }; } })());
    st.ref_code = attr.ref_code; st.campaign = attr.campaign;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test && npm run check`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add assets/js/logic.js assets/js/app.js tests/attribution.test.js
git commit -m "feat: capture referral and campaign tags"
```

---

### Task 5: Admin lead details and source report

**Files:**
- Create: `admin/lead-view.js`
- Modify: `admin/admin.js` (import at top; lead sheet rows near line 113; dashboard `dash()` near line 100)
- Test: `tests/lead-view.test.mjs`

**Interfaces:**
- Produces: `leadDetailRows(lead): Array<[label: string, value: string]>` listing only the fields present, in this order: Bike type, Last service, Problems, Note, Where, Contact by, Referred by, Campaign.
- Produces: `sourceReport(leads): { source: Array<[string, number]>, campaign: Array<[string, number]>, referrer: Array<[string, number]> }`, each sorted by count descending, then name; missing values are skipped for campaign and referrer, and `direct` is used for a missing `utm.utm_source`.

- [ ] **Step 1: Write the failing test**

```js
// tests/lead-view.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { leadDetailRows, sourceReport } from '../admin/lead-view.js';

test('shows only the details that were given, in a fixed order', () => {
  const rows = leadDetailRows({ bike_type: 's', km_band: 'mid', issues: ['brake', 'chain'], note: 'rattle', place: 'road', contact_pref: 'call', ref_code: 'ASHA', campaign: 'monsoon' });
  assert.deepEqual(rows, [
    ['Bike type', 'Scooter'], ['Last service', '3,000–6,000 km'], ['Problems', 'Brakes weak or noisy, Chain noise or loose chain'],
    ['Note', 'rattle'], ['Where', 'Stuck on the road'], ['Contact by', 'Phone call'], ['Referred by', 'ASHA'], ['Campaign', 'monsoon']
  ]);
});
test('an old lead with none of the new fields gives no rows except the default place', () => {
  assert.deepEqual(leadDetailRows({}), []);
  assert.deepEqual(leadDetailRows({ place: 'home', contact_pref: 'whatsapp', issues: [] }), [['Where', 'Home or office'], ['Contact by', 'WhatsApp chat']]);
});
test('unknown problem ids are shown as they are, not dropped', () => {
  assert.equal(leadDetailRows({ issues: ['mystery'] })[0][1], 'mystery');
});
test('sourceReport counts leads by source, campaign and referrer', () => {
  const r = sourceReport([
    { utm: { utm_source: 'google' }, campaign: 'monsoon', ref_code: 'ASHA' },
    { utm: { utm_source: 'google' }, campaign: 'monsoon', ref_code: null },
    { utm: {}, campaign: null, ref_code: 'ASHA' },
    { utm: { utm_source: 'instagram' } }
  ]);
  assert.deepEqual(r.source, [['google', 2], ['direct', 1], ['instagram', 1]]);
  assert.deepEqual(r.campaign, [['monsoon', 2]]);
  assert.deepEqual(r.referrer, [['ASHA', 2]]);
});
test('sourceReport on no leads gives empty lists', () => {
  assert.deepEqual(sourceReport([]), { source: [], campaign: [], referrer: [] });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL with `Cannot find module .../admin/lead-view.js`.

- [ ] **Step 3: Write minimal implementation**

```js
// admin/lead-view.js — pure helpers for the admin panel (no DOM, no Supabase), so they can be tested in Node.
const KM = { new: 'New bike (first service)', lt3: 'Under 3,000 km', mid: '3,000–6,000 km', gt6: 'Over 6,000 km', unsure: 'Not sure' };
const TYPE = { m: 'Motorcycle', s: 'Scooter', e: 'Electric scooter' };
const PLACE = { home: 'Home or office', road: 'Stuck on the road', unsure: 'Not sure' };
const CONTACT = { whatsapp: 'WhatsApp chat', call: 'Phone call' };
const ISSUE = { start: 'Hard to start', pickup: 'Low pickup or mileage', brake: 'Brakes weak or noisy', chain: 'Chain noise or loose chain', clutch: 'Clutch hard or slipping', gear: 'Gear shifting problem', battery: 'Battery or self-start', tyre: 'Puncture or worn tyre', leak: 'Oil leak', heat: 'Engine heating', elec: 'Lights, horn or wiring', susp: 'Suspension noise', rain: 'Pre-monsoon check', range: 'Range dropped or charging problem', sw: 'Display or app problem' };

export function leadDetailRows(l) {
  const rows = [];
  if (l.bike_type) rows.push(['Bike type', TYPE[l.bike_type] ?? l.bike_type]);
  if (l.km_band) rows.push(['Last service', KM[l.km_band] ?? l.km_band]);
  if (Array.isArray(l.issues) && l.issues.length) rows.push(['Problems', l.issues.map((i) => ISSUE[i] ?? i).join(', ')]);
  if (l.note) rows.push(['Note', l.note]);
  if (l.place) rows.push(['Where', PLACE[l.place] ?? l.place]);
  if (l.contact_pref) rows.push(['Contact by', CONTACT[l.contact_pref] ?? l.contact_pref]);
  if (l.ref_code) rows.push(['Referred by', l.ref_code]);
  if (l.campaign) rows.push(['Campaign', l.campaign]);
  return rows;
}

export function sourceReport(leads) {
  const count = (values) => {
    const m = new Map();
    for (const v of values) if (v) m.set(v, (m.get(v) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
  };
  return {
    source: count(leads.map((l) => l.utm?.utm_source || 'direct')),
    campaign: count(leads.map((l) => l.campaign)),
    referrer: count(leads.map((l) => l.ref_code)),
  };
}
```

In `admin/admin.js`:
1. Add under the first import line: `import { leadDetailRows, sourceReport } from './lead-view.js';`
2. In `openLead`, inside the `<dl class="kv">` block (the line that starts `<div class="card"><dl class="kv"><dt>Customer</dt>`), add before `<dt>Source</dt>`:
```js
${leadDetailRows(l).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}
```
3. In `dash()`, add a card after the existing `split2` row:
```js
  ${(() => { const r = sourceReport(week); const rows = (a) => a.length ? a.map(([k, v]) => `<div class="b"><span>${esc(k)}</span><b>${v}</b></div>`).join('') : '<p class="small muted">None yet</p>'; return `<div class="card" style="margin-top:16px"><h3>Sources (7 days)</h3><div class="split2"><div><h4>Source</h4>${rows(r.source)}</div><div><h4>Campaign</h4>${rows(r.campaign)}</div><div><h4>Referrer</h4>${rows(r.referrer)}</div></div></div>`; })()}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test && npm run check`
Expected: all pass. Then `sh scripts/build_admin.sh` and open `dist-admin/` to confirm `admin/lead-view.js` is copied (it is, because the whole `admin/` folder is copied).

- [ ] **Step 5: Commit**

```bash
git add admin/lead-view.js admin/admin.js tests/lead-view.test.mjs
git commit -m "feat: show lead details and a source report in admin"
```

---

### Task 6: Whole-flow check and notes

**Files:**
- Modify: `README.md` (Stage 2 section: add the new migration as step 1b)

- [ ] **Step 1: Add the migration to the README**

In the Stage 2 "A. Supabase" list, after the line about pasting `20261006000000_init.sql`, add:
```
   Then paste `supabase/migrations/20261007000000_lead_details.sql` and run it too. It adds the booking details, referral and campaign columns.
```

- [ ] **Step 2: Run everything**

Run: `npm test && npm run check && python3 scripts/build_pages.py`
Expected: all tests pass, no syntax errors, pages regenerate.

- [ ] **Step 3: Browser check**

Serve the site (`python3 -m http.server 3000`) and run the existing booking flow script with `?ref=asha&utm_campaign=monsoon` appended to `/book/`. Expected: the WhatsApp message contains `Referred by: ASHA` and no page errors.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: add lead details migration to go-live steps"
```

---

## Self-review

- **Spec coverage:** Section 3 (columns, validation, fallback to WhatsApp, admin fields and report) is covered by Tasks 1, 2, 3 and 5; the fallback already exists in `app.js` and is unchanged. Section 4 (`?ref=`, campaign tag, "Referred by" in the message, saved on the lead) is Task 4. Sections 1, 2, 5 and the rest of section 6 belong to later build steps and are intentionally out of this plan.
- **Placeholders:** none; every code step shows the code.
- **Type consistency:** `cleanLeadFields` keys (`km_band, issues, note, place, contact_pref, bike_type, ref_code, campaign`) match the migration columns (checked by `migration.test.mjs`), the `leadPayload` keys in `logic.js`, and the fields read by `leadDetailRows`.
