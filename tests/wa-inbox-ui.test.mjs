import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { msLeft, windowChip, ticks, dayLabel, groupThread, mediaInfo, waitText, secsText, templateDefaults, failText, phoneLabel, QUICK_REPLIES, TABS, LANGS } from '../crm/wa-rules.js';
import { threadHtml, composerHtml, convRowHtml, listHtml, itemHtml, tabsHtml, errorBox, LOADING } from '../crm/wa-thread.js';
import { inboxShell } from '../crm/wa-inbox.js';
import { cardsHtml, agentsHtml, filtersHtml, tableHtml, defaultFilters, rangeArgs, shell } from '../admin/wa-desk.js';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const NOW = Date.parse('2026-11-07T10:00:00Z');
Date.now = () => NOW;   // the thread and composer read the clock for the 24 hour window; freeze it so this test does not age (fixed on purpose)
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();

const convo = (o = {}) => ({ phone: '9800000001', name: 'Test Customer', status: 'open', assigned_to: null, assigned_name: null, last_inbound_at: iso(3600e3), me: 'USER_ME', ai_auto: null, ai_global: true, opted_out: false, ...o });
const thread = (o = {}) => ({ conversation: convo(o.c), lead: { id: 'L1', ref: 'R1', booking_id: 'MXP-1001', name: 'Test Customer', status: 'paid', paid: true, ...(o.lead || {}) },
  items: o.items || [
    { kind: 'msg', id: 1, direction: 'in', sender: 'customer', body: 'Bike will not start', at: iso(26 * 3600e3), channel: 'cloud' },
    { kind: 'msg', id: 2, direction: 'out', sender: 'staff', by: 'Sales Agent', body: 'We are on it', status: 'read', at: iso(25 * 3600e3), channel: 'cloud' },
    { kind: 'msg', id: 3, direction: 'in', sender: 'customer', body: '[Photo]', media: { type: 'image', id: 'MEDIA_IMG', mime: 'image/jpeg' }, at: iso(2 * 3600e3), channel: 'cloud' },
    { kind: 'msg', id: 4, direction: 'in', sender: 'customer', body: '[Voice note]', media: { type: 'audio', id: 'MEDIA_AUD', mime: 'audio/ogg', voice: true }, at: iso(3600e3), channel: 'cloud' },
    { kind: 'msg', id: 5, direction: 'out', sender: 'staff', body: 'sent one', status: 'sent', at: iso(3000e3), channel: 'cloud' },
    { kind: 'msg', id: 6, direction: 'out', sender: 'staff', body: 'delivered one', status: 'delivered', at: iso(2900e3), channel: 'cloud' },
    { kind: 'msg', id: 7, direction: 'out', sender: 'staff', body: 'failed one', status: 'failed', status_detail: 'Re-engagement message', at: iso(2800e3), channel: 'cloud' },
    { kind: 'msg', id: 8, direction: 'out', sender: 'staff', body: 'maybe one', status: 'unknown', at: iso(2700e3), channel: 'cloud' },
    { kind: 'msg', id: 9, direction: 'out', sender: 'staff', body: 'old desk message', status: null, at: iso(2600e3), channel: 'aisensy' },
  ], notes: o.notes || [{ kind: 'note', id: 1, body: 'Customer is a repeat booker', by: 'Owner', at: iso(1800e3) }] });

test('rules: 24 hour countdown text and tone', () => {
  assert.equal(msLeft(iso(23 * 3600e3), NOW), 3600e3); assert.equal(msLeft(iso(25 * 3600e3), NOW), 0); assert.equal(msLeft(null, NOW), 0);
  assert.deepEqual([windowChip(iso(3600e3), NOW).tone, windowChip(iso(3600e3), NOW).open], ['good', true]);
  assert.equal(windowChip(iso(3600e3), NOW).text, '23h 0m left to reply freely');
  assert.equal(windowChip(iso(20 * 3600e3), NOW).tone, 'warn'); assert.equal(windowChip(iso(23.5 * 3600e3), NOW).tone, 'bad'); assert.match(windowChip(iso(23.5 * 3600e3), NOW).text, /^30m left/);
  assert.deepEqual(windowChip(iso(30 * 3600e3), NOW), { open: false, text: 'Window closed: use a template', tone: 'bad' });
});
test('rules: ticks, date separators, waiting text, template defaults, phone label, failure text', () => {
  assert.equal(ticks('in', 'sent'), null); assert.equal(ticks('out', 'sent').glyph, '✓'); assert.equal(ticks('out', 'delivered').glyph, '✓✓'); assert.equal(ticks('out', 'read').cls, 'read');
  assert.equal(ticks('out', 'failed').glyph, '!'); assert.equal(ticks('out', 'unknown').glyph, '?'); assert.equal(ticks('out', null).glyph, '');
  assert.equal(dayLabel(iso(1000), NOW), 'Today'); assert.equal(dayLabel(iso(24 * 3600e3), NOW), 'Yesterday'); assert.match(dayLabel(iso(5 * 86400e3), NOW), /Nov 2026|Nov/);
  const g = groupThread(thread().items, thread().notes, NOW); assert.equal(g.filter((x) => x.kind === 'day').length >= 2, true); assert.equal(g[0].kind, 'day');
  assert.ok(g.some((x) => x.kind === 'note')); const times = g.filter((x) => x.at).map((x) => +new Date(x.at)); assert.deepEqual(times, [...times].sort((a, b) => a - b));
  assert.equal(waitText(5), '5 min'); assert.equal(waitText(125), '2h 5m'); assert.equal(waitText(3000), '2d'); assert.equal(waitText(null), '');
  assert.equal(secsText(null), 'no data'); assert.equal(secsText(45), '45s'); assert.equal(secsText(360), '6 min'); assert.equal(secsText(7200), '2.0 h');
  assert.deepEqual(templateDefaults({ vars: ['Customer first name', 'Booking ID', 'Amount'] }, { name: 'Test Customer', booking_id: 'MXP-1' }), ['Test', 'MXP-1', '']);
  assert.equal(phoneLabel('9800000001'), '+91 98000 00001'); assert.match(failText(new Error('boom')), /^That did not work: boom$/); assert.match(failText(null), /^That did not work:/);
  assert.equal(mediaInfo({ type: 'audio', id: 'A', voice: true }).label, 'Voice note'); assert.equal(mediaInfo({ type: 'document', id: 'D', filename: 'rc.pdf' }).label, 'Document: rc.pdf');
  assert.equal(mediaInfo({ type: 'location', latitude: 12.9, longitude: 77.6 }).url, 'https://maps.google.com/?q=12.9,77.6'); assert.equal(mediaInfo({ type: 'template' }), null); assert.equal(mediaInfo(null), null);
  assert.equal(TABS.length, 5); assert.deepEqual(LANGS.map((l) => l[0]), ['en', 'hi', 'kn']); assert.ok(QUICK_REPLIES.length >= 5);
});
test('thread markup: head, claim and close, chip, date separators, ticks, media Load buttons, notes in their own style, paid badge, lead link', () => {
  const h = threadHtml(thread(), { templates: [] });
  assert.match(h, /data-wa="claim"/); assert.match(h, /data-wa="close"/); assert.match(h, /data-wa="lead"/); assert.match(h, /MXP-1001/); assert.match(h, /chip good[^>]*>PAID/);
  assert.match(h, /class="wa-day"/); assert.match(h, /data-wa-chip/); assert.match(h, /left to reply freely/);
  assert.match(h, /class="wa-note"/); assert.match(h, /Internal note/); assert.match(h, /repeat booker/);
  for (const k of ['sent', 'delivered', 'read', 'failed', 'unknown']) assert.match(h, new RegExp(`class="tick ${k}"`), k);
  assert.match(h, /Re-engagement message/); assert.match(h, /desk number/);
  assert.match(h, /data-wa="load" data-media="MEDIA_IMG" data-kind="image"/); assert.match(h, /data-wa="load" data-media="MEDIA_AUD" data-kind="audio"/); assert.match(h, /Voice note/);
  assert.doesNotMatch(h, /<audio|<img/);   // nothing is fetched until Load is pressed
  assert.match(h, /data-wa-field="text"/); assert.match(h, /data-wa="quick"/); assert.match(h, /type="file"/); assert.match(h, /audio\/ogg/); assert.doesNotMatch(h, /audio\/webm/);
  assert.match(h, /data-wa-back/);
});
test('thread markup: yours shows no claim; closed shows reopen; AI state; a colleague holds it', () => {
  assert.doesNotMatch(threadHtml(thread({ c: { assigned_to: 'USER_ME', assigned_name: 'Me' } })), /data-wa="claim"/);
  assert.match(threadHtml(thread({ c: { assigned_to: 'USER_X', assigned_name: 'Colleague' } })), /Take over/); assert.match(threadHtml(thread({ c: { assigned_to: 'USER_X', assigned_name: 'Colleague' } })), /AI does not reply while a person holds/);
  const closed = threadHtml(thread({ c: { status: 'closed', closed_reason: 'Resolved' } })); assert.match(closed, /data-wa="reopen"/); assert.doesNotMatch(closed, /data-wa="close"/); assert.match(closed, /reopens it/);
  assert.match(threadHtml(thread({ c: { ai_auto: false } })), /AI off/); assert.match(threadHtml(thread({ c: { ai_global: false } })), /off \(global\)/);
  assert.doesNotMatch(threadHtml(thread({ lead: { paid: false } })), />PAID</);
});
test('composer: open window shows free text and voice note; closed window shows the template picker with languages and variables; opted out blocks', () => {
  const open = composerHtml(thread(), null); assert.match(open, /data-wa="send"/); assert.doesNotMatch(open, /send-template/);
  const tpls = { templates: [{ name: 'mxp_followup', label: 'Follow-up', vars: ['Customer first name', 'Booking ID'] }, { name: 'mxp_paid', label: 'Paid', vars: ['Amount'] }] };
  const closed = composerHtml(thread({ c: { last_inbound_at: iso(30 * 3600e3) } }), tpls);
  assert.match(closed, /Window closed: use a template/); assert.match(closed, /data-wa="send-template"/); assert.doesNotMatch(closed, /data-wa="send"/); assert.doesNotMatch(closed, /data-wa-field="text"/);
  for (const [v, l] of [['en', 'English'], ['hi', 'Hindi'], ['kn', 'Kannada']]) assert.match(closed, new RegExp(`<option value="${v}">${l}</option>`));
  assert.match(closed, /value="Test"/); assert.match(closed, /value="MXP-1001"/); assert.match(closed, /Follow-up/);
  assert.match(composerHtml(thread({ c: { last_inbound_at: iso(30 * 3600e3) } }), null), /Loading/);   // templates still loading: visible state
  assert.match(composerHtml(thread({ c: { opted_out: true } }), tpls), /asked not to get messages/);
});
test('list markup: unread badge, paid chip, unassigned, waiting on us, template only; empty and error and loading states', () => {
  const r = { phone: '9800000001', name: 'Test Customer', paid: true, booking_id: 'MXP-1001', last_preview: 'Bike will not start', last_message_at: iso(600e3), unread: 3, assigned_name: null, status: 'open', waiting: true, window_open: false };
  const h = convRowHtml(r, true); assert.match(h, /class="wa-row on unread"/); assert.match(h, /class="badge">3</); assert.match(h, />PAID</); assert.match(h, /Unassigned/); assert.match(h, /Waiting on us/); assert.match(h, /Template only/);
  assert.match(convRowHtml({ ...r, status: 'closed', unread: 0 }), /Closed/); assert.match(listHtml([], null), /No conversations here/); assert.equal((listHtml([r, r], null).match(/wa-row/g) || []).length >= 2, true);
  assert.match(errorBox(new Error('boom')), /role="alert"[\s\S]*That did not work: boom[\s\S]*Try again/); assert.match(LOADING, /role="status"/);
  const tabs = tabsHtml({ unread: 4, mine: 0, unassigned: 2, waiting: 1, closed: 9 }, 'mine'); for (const [k] of TABS) assert.match(tabs, new RegExp(`data-wa-tab="${k}"`)); assert.match(tabs, /aria-current="page"/);
  assert.match(inboxShell(), /id="waQ"/); assert.match(inboxShell(), /type="search"/);
  assert.match(itemHtml({ kind: 'msg', direction: 'in', body: '<script>x</script>', at: iso(1) }), /&lt;script&gt;/);
});
test('Admin supervision markup: counts, median, per agent, filters, table with both sides, open any thread', () => {
  const o = { open: 7, unassigned: 2, unanswered_over: 3, over_minutes: 30, inbound: 40, outbound: 35, median_first_response_secs: 360, agents: [{ user_id: 'U1', name: 'Sales Agent', replies: 12, first_responses: 5, median_secs: 240, open_assigned: 2 }] };
  const c = cardsHtml(o); assert.match(c, /Unanswered over 30 min/); assert.match(c, /6 min/); assert.match(c, /Open chats/); assert.match(c, /Customer messages/); assert.match(c, /Our messages/);
  assert.match(agentsHtml(o.agents), /Sales Agent/); assert.match(agentsHtml([]), /No staff replies/);
  const f = filtersHtml({ agent: 'U1', over: '30', from: '2026-11-01', to: '2026-11-07' }, o.agents); assert.match(f, /<option value="U1" selected>/); assert.match(f, /Over 15 min/); assert.match(f, /Over 60 min/); assert.match(f, /type="date" data-f="from"/);
  const t = tableHtml([{ phone: '9800000001', name: 'Test Customer', paid: true, booking_id: 'MXP-1', status: 'open', assigned_name: null, last_preview: 'hi', last_message_at: iso(1000), in_count: 4, out_count: 3, waiting_minutes: 45 }]);
  assert.match(t, /data-phone="9800000001"/); assert.match(t, /4 \/ 3/); assert.match(t, /Unassigned/); assert.match(t, />PAID</); assert.match(t, /45 min/); assert.match(tableHtml([]), /No conversations match/);
  const d = defaultFilters(new Date('2026-11-07T10:00:00Z')); assert.deepEqual([d.from, d.to], ['2026-11-01', '2026-11-07']); const r = rangeArgs(d); assert.equal(r.p_from, '2026-10-31T18:30:00.000Z'); assert.match(shell(), /WhatsApp supervision/);
});
test('Crew and Admin copies are identical; the screens are wired with the right permissions', () => {
  for (const f of ['wa-rules.js', 'wa-thread.js', 'wa.css']) assert.equal(read('admin/' + f), read('crm/' + f), f);
  const crm = read('crm/crm.js'); assert.match(crm, /\{ id: 'inbox', title: 'Inbox', page: 'inbox', mod: inbox \}/);
  assert.match(read('crm/index.html'), /\/crm\/wa\.css/); assert.match(read('admin/index.html'), /\/admin\/wa\.css/); assert.match(read('admin/index.html'), /data-tab="whatsapp"/);
  const adm = read('admin/admin.js'); assert.match(adm, /createWaDesk\(/); assert.match(adm, /waDesk\.mount\(\$\('#waRoot'\)\)/); assert.match(adm, /else waDesk\.unmount\(\)/);
  assert.match(read('admin/wa-desk.js'), /admin_wa_overview/); assert.match(read('admin/wa-desk.js'), /admin_wa_list/);
  assert.doesNotMatch(read('crm/wa-inbox.js') + read('crm/wa-thread.js'), /admin_wa_/);
});
test('polling every 15 seconds only while the tab is visible; failures are never silent; no money fields requested', () => {
  for (const f of ['crm/wa-inbox.js', 'crm/wa-thread.js', 'admin/wa-desk.js']) { assert.match(read(f), /15000/, f); assert.match(read(f), /visibilityState === 'visible'/, f); }
  assert.match(read('crm/wa-thread.js'), /toast\(failText\(e\), true\)/); assert.doesNotMatch(read('crm/wa-thread.js') + read('crm/wa-inbox.js') + read('admin/wa-desk.js'), /catch \([a-z]*\) \{\s*\}/);
  assert.doesNotMatch(read('crm/wa-thread.js') + read('crm/wa-inbox.js') + read('admin/wa-desk.js'), /est_total|paid_amount|payment_link/);
});
test('media: images load as player or picture only after the Load button; the pages may play them (CSP) and everything else stays closed', () => {
  assert.match(read('crm/wa-thread.js'), /call\('wa-media'/);
  for (const f of ['scripts/build_crm.sh', 'scripts/build_admin.sh']) { const csp = read(f).split('\n').find((l) => /Content-Security-Policy/.test(l)); assert.match(csp, /media-src 'self' blob:/); assert.match(csp, /img-src 'self' data: blob:/); assert.match(csp, /object-src 'none'/); assert.match(csp, /default-src 'self'/); }
});
test('the shared styles use design tokens only', () => {
  const css = read('crm/wa.css'); assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/); assert.match(css, /var\(--accent\)/); assert.match(css, /prefers-reduced-motion/);
});
