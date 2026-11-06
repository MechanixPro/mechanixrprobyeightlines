// What happens when a confirmation fee is paid, and the sweep that retries and nudges. Used by verify-payment, razorpay-webhook, booking-notify and desk-automation.
// Every message is its own job (notify.ts deliver): claimed once, failure-isolated, logged in the booking history, retryable. None of them can block the payment or each other.
import { adminDb, env, getSetting } from './util.ts';
import { sendEmail, FROM_BOOKING } from './resend.ts';
import { sendCampaign } from './aisensy-send.ts';
import { DESK_TEMPLATES } from './desk-templates.ts';
import { teamEmails } from './desk-notify.ts';
import { paidConfirmation, feeReceipt, quoteMail, etaChanged, mechanicOnTheWay } from './email-templates.ts';
import { COMPANY } from './company.ts';
import { gstSplit } from './confirm-fee.ts';
import { formatWhen } from './when.ts';
import { idParam } from './booking-id.ts';
import { deliver, deliverAll, dueKinds, olderThan, teamPaidMessage, teamNudgeMessage, teamIssueMessage, type Kind, type Result, type Store } from './notify.ts';
import { teamGarageMessage } from './garage.ts';

type Db = ReturnType<typeof adminDb>;
const FROM_DESK = 'Mechanix Pro Desk <no-reply@mechanixpro.in>';
export const siteInfo = () => ({ siteUrl: env('SITE_URL', 'https://mechanixpro.in'), phoneDisplay: env('PHONE_DISPLAY', '+91 79652 95649'), phoneTel: env('PHONE_TEL', '+917965295649'), whatsappUrl: env('WHATSAPP_URL', 'https://wa.me/918042303061'), email: 'hello@mechanixpro.in' });
export const deskUrl = () => env('DESK_URL', 'https://crew.mechanixpro.in/crm/');

export const dbStore = (db: Db): Store => ({
  async claim(leadId, kind, force = false) { const { data, error } = await db.rpc('notification_claim', { p_lead: leadId, p_kind: kind, p_force: force }); if (error) throw error; return data === true; },
  async finish(leadId, kind, status, error) { await db.rpc('notification_finish', { p_lead: leadId, p_kind: kind, p_status: status, p_error: error ?? null }); },
});

type Ctx = { lead: any; email: string | null; vehicleName: string; service: string; mechanicFirst: string | null; token: string | null; code: string | null; address: string; whenText: string; trackUrl: string };
async function contextOf(db: Db, lead: any): Promise<Ctx> {
  const [cust, bike, svc, mech, sec] = await Promise.all([
    lead.customer_id ? db.from('customers').select('email').eq('id', lead.customer_id).maybeSingle() : Promise.resolve({ data: null }),
    lead.bike_id ? db.from('bikes').select('brand,model').eq('id', lead.bike_id).maybeSingle() : Promise.resolve({ data: null }),
    lead.service_id ? db.from('services').select('name').eq('id', lead.service_id).maybeSingle() : Promise.resolve({ data: null }),
    lead.mechanic_id ? db.from('mechanics').select('name').eq('id', lead.mechanic_id).maybeSingle() : Promise.resolve({ data: null }),
    db.from('booking_secrets').select('track_token,door_code').eq('lead_id', lead.id).maybeSingle(),
  ]);
  const b = bike.data as { brand?: string; model?: string } | null;
  const token = (sec.data as any)?.track_token ?? null;
  return {
    lead, email: (cust.data as any)?.email ?? lead.email ?? null,
    vehicleName: b ? [b.brand && b.brand !== 'Other' ? b.brand : '', b.model].filter(Boolean).join(' ') || (lead.vehicle === 'car' ? 'Car' : 'Bike') : (lead.vehicle === 'car' ? 'Car' : 'Bike'),
    service: (svc.data as any)?.name ?? (lead.vehicle === 'car' ? 'Car service or problem check' : 'Bike service'),
    mechanicFirst: (mech.data as any)?.name ? String((mech.data as any).name).trim().split(/\s+/)[0] : null,
    token, code: (sec.data as any)?.door_code ?? null,
    address: [lead.address, lead.area, lead.pincode].filter(Boolean).join(', ') || 'Bengaluru',
    whenText: lead.preferred_date && lead.preferred_slot ? formatWhen(String(lead.preferred_date), String(lead.preferred_slot), lead.preferred_time ?? null) : 'We will confirm the time',
    trackUrl: token ? `${siteInfo().siteUrl}/track/?t=${token}` : `${siteInfo().siteUrl}/track/`,
  };
}

async function mailTo(db: Db, leadId: string, to: string | null, template: string, mail: { subject: string; html: string; text: string }): Promise<Result> {
  if (!to) return { ok: false, skipped: true, error: 'no email address' };
  const r = await sendEmail({ to, subject: mail.subject, html: mail.html, text: mail.text, from: FROM_BOOKING, tags: { template } });
  await db.from('email_log').insert({ lead_id: leadId, to_email: to, template, status: r.ok ? 'sent' : r.skipped ? 'skipped' : 'failed', provider_id: r.id ?? null, error: r.error ?? null }).then(() => {}, () => {});
  return { ok: r.ok, skipped: r.skipped, error: r.error };
}

const sendConfirmEmail = (db: Db, c: Ctx) => async (): Promise<Result> => {
  const g = gstSplit(Number(c.lead.confirm_fee));
  return mailTo(db, c.lead.id, c.email, 'paid_confirmation', paidConfirmation({ ...siteInfo(), name: c.lead.name, ref: c.lead.booking_id ?? null, vehicle: c.lead.vehicle === 'car' ? 'car' : 'bike', vehicleName: c.vehicleName, service: c.service,
    address: c.address, whenText: c.whenText, amount: Number(c.lead.confirm_fee), gstBase: g.base, gst: g.gst, trackUrl: c.trackUrl, code: c.code }));
};
const sendReceiptEmail = (db: Db, c: Ctx) => async (): Promise<Result> => {
  const g = gstSplit(Number(c.lead.confirm_fee));
  // The receipt number is the booking ID from the invoice numbering (invoice_no_alloc); the final invoice keeps that number and shows this fee as already paid.
  const { data: no, error } = await db.rpc('invoice_no_alloc', { p_lead: c.lead.id });
  if (error || !no) return { ok: false, error: 'could not allocate the receipt number' };
  const date = new Date(Date.now() + 330 * 60_000).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  return mailTo(db, c.lead.id, c.email, 'fee_receipt', feeReceipt({ ...siteInfo(), name: c.lead.name, ref: c.lead.booking_id ?? String(no), number: String(no), dateLabel: date, amount: Number(c.lead.confirm_fee), gstBase: g.base, gst: g.gst, vehicleName: c.vehicleName, service: c.service, company: COMPANY }));
};
// WhatsApp: the existing "Booking confirmed" template through AiSensy, same 5 variables (name, booking, when, mechanic, area). No mechanic yet, so the mechanic slot says "from our team".
const sendConfirmWhatsApp = (db: Db, c: Ctx) => async (): Promise<Result> => {
  if (!c.lead.consent_whatsapp || c.lead.opted_out) return { ok: false, skipped: true, error: 'customer did not agree to WhatsApp updates' };
  if (!env('AISENSY_API_KEY')) return { ok: false, skipped: true, error: 'AiSensy is not connected' };
  const t = DESK_TEMPLATES.find((x) => x.name === 'mxp_booking_confirmed')!;
  const ready = await getSetting<Record<string, boolean>>(db, 'desk_campaigns', {});
  if (!ready[t.campaign]) return { ok: false, skipped: true, error: 'the Booking confirmed template is not approved yet' };
  const r = await sendCampaign({ apiKey: env('AISENSY_API_KEY'), campaignName: t.campaign, phone: c.lead.phone, name: c.lead.name, params: [String(c.lead.name).split(' ')[0], idParam(c.lead), c.whenText, c.mechanicFirst ?? 'from our team', c.lead.area || 'your address'], source: 'mechanix-paid-confirmation' });
  if (r.ok) await db.from('messages').insert({ lead_id: c.lead.id, phone: c.lead.phone, direction: 'out', sender: 'system', body: 'Booking confirmation sent automatically' }).then(() => {}, () => {});
  return r;
};

async function teamRecipients(db: Db): Promise<string[]> {
  const extra = await getSetting<string[]>(db, 'lead_alert_emails', []);
  return [...new Set([...(Array.isArray(extra) ? extra : []), ...(await teamEmails(db))].map((e) => String(e).trim().toLowerCase()).filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)))];
}
async function mailTeam(db: Db, m: { subject: string; text: string; html: string }, template: string): Promise<Result> {
  const to = await teamRecipients(db);
  if (!to.length) return { ok: false, skipped: true, error: 'no team email addresses are set' };
  let sent = 0, last = '';
  for (const addr of to) { const r = await sendEmail({ to: addr, subject: m.subject, html: m.html, text: m.text, from: FROM_DESK, tags: { template } }); if (r.ok) sent++; else last = r.error ?? 'failed'; }
  return sent > 0 ? { ok: true } : { ok: false, error: last || 'no email was sent' };
}
const sendTeamPaid = (db: Db, c: Ctx) => (): Promise<Result> => mailTeam(db, teamPaidMessage({ bookingId: c.lead.booking_id, vehicle: c.lead.vehicle ?? 'bike', area: c.lead.area, pincode: c.lead.pincode, whenText: c.whenText, amount: Number(c.lead.confirm_fee), deskUrl: deskUrl() }), 'team_paid');

/** The four things that happen when the fee is paid. Safe to call any number of times, from any path. Never throws. */
export async function afterConfirmationPaid(db: Db, leadId: string, force = false): Promise<Record<string, string>> {
  try {
    const { data: lead } = await db.from('leads').select('*').eq('id', leadId).is('deleted_at', null).maybeSingle();
    if (!lead || lead.confirm_fee == null || !lead.confirm_paid_at) return { skipped: 'not a paid confirmation' };
    try { await db.rpc('booking_open_secrets', { p_lead: leadId }); } catch (e) { console.error('booking secrets', e); }
    const c = await contextOf(db, lead);
    return await deliverAll(dbStore(db), leadId, { confirm_email: sendConfirmEmail(db, c), receipt_email: sendReceiptEmail(db, c), confirm_whatsapp: sendConfirmWhatsApp(db, c), team_paid: sendTeamPaid(db, c) }, force);
  } catch (e) { console.error('afterConfirmationPaid', e); return { error: 'failed' }; }
}
/** Crew's Resend: one kind for one booking, forced. */
export async function resendKind(db: Db, leadId: string, kind: Kind): Promise<string> {
  const { data: lead } = await db.from('leads').select('*').eq('id', leadId).is('deleted_at', null).maybeSingle();
  if (!lead || lead.confirm_fee == null || !lead.confirm_paid_at) return 'not a paid confirmation';
  const c = await contextOf(db, lead), jobs: Partial<Record<Kind, () => Promise<Result>>> = { confirm_email: sendConfirmEmail(db, c), receipt_email: sendReceiptEmail(db, c), confirm_whatsapp: sendConfirmWhatsApp(db, c), team_paid: sendTeamPaid(db, c) };
  const job = jobs[kind]; if (!job) return 'this message cannot be resent';
  return await deliver(dbStore(db), leadId, kind, job, true);
}

/* ---------- quote and delivery messages (sent by quote-send) ---------- */
export async function sendQuoteMessages(db: Db, leadId: string, version: number, revised: boolean, force = false, only: 'quote_email' | 'quote_whatsapp' | null = null): Promise<Record<string, string>> {
  const { data: lead } = await db.from('leads').select('*').eq('id', leadId).maybeSingle();
  const { data: q } = await db.from('job_quotes').select('*').eq('lead_id', leadId).eq('version', version).maybeSingle();
  if (!lead || !q) return { error: 'not found' };
  const c = await contextOf(db, lead);
  const email = async (): Promise<Result> => mailTo(db, leadId, c.email, 'quote', quoteMail({ ...siteInfo(), name: lead.name, ref: lead.booking_id ?? null, version, lines: q.lines, subtotal: Number(q.subtotal), gst: Number(q.gst), total: Number(q.total), feeCredit: Number(q.fee_credit), balance: Number(q.balance), etaText: q.eta_text, trackUrl: c.trackUrl, revised }));
  // The existing "Quote ready" template (mxp_quote_ready_v2): first name, booking, total. The itemised quote and the approval link are in the email and on the tracking page.
  const wa = async (): Promise<Result> => {
    if (!lead.consent_whatsapp || lead.opted_out) return { ok: false, skipped: true, error: 'customer did not agree to WhatsApp updates' };
    if (!env('AISENSY_API_KEY')) return { ok: false, skipped: true, error: 'AiSensy is not connected' };
    const t = DESK_TEMPLATES.find((x) => x.name === 'mxp_quote_ready_v2')!;
    const ready = await getSetting<Record<string, boolean>>(db, 'desk_campaigns', {});
    if (!ready[t.campaign]) return { ok: false, skipped: true, error: 'the Quote ready template is not approved yet' };
    return await sendCampaign({ apiKey: env('AISENSY_API_KEY'), campaignName: t.campaign, phone: lead.phone, name: lead.name, params: [String(lead.name).split(' ')[0], idParam(lead), String(Math.round(Number(q.total)))], source: 'mechanix-quote' });
  };
  const jobs: Record<string, () => Promise<Result>> = {};
  if (!only || only === 'quote_email') jobs[`quote_email:${version}`] = email;
  if (!only || only === 'quote_whatsapp') jobs[`quote_whatsapp:${version}`] = wa;
  return await deliverAll(dbStore(db), leadId, jobs as any, force);
}
export async function sendEtaMessages(db: Db, leadId: string, rev: number, force = false): Promise<Record<string, string>> {
  const { data: lead } = await db.from('leads').select('*').eq('id', leadId).maybeSingle();
  const { data: q } = await db.from('job_quotes').select('eta_text').eq('lead_id', leadId).in('status', ['sent', 'approved']).order('version', { ascending: false }).limit(1).maybeSingle();
  if (!lead || !q) return { error: 'not found' };
  const c = await contextOf(db, lead);
  return await deliverAll(dbStore(db), leadId, { [`eta_email:${rev}`]: async () => mailTo(db, leadId, c.email, 'eta_changed', etaChanged({ ...siteInfo(), name: lead.name, ref: lead.booking_id ?? null, etaText: q.eta_text, trackUrl: c.trackUrl })) } as any, force);
}
export async function notifyTeamDecision(db: Db, leadId: string, version: number, decision: string): Promise<string> {
  const { data: lead } = await db.from('leads').select('booking_id,vehicle,area').eq('id', leadId).maybeSingle();
  if (!lead) return 'not found';
  const line = `${lead.booking_id ?? 'Booking'} (${String(lead.vehicle ?? 'bike').toUpperCase()}${lead.area ? ', ' + lead.area : ''}): customer ${decision} quote v${version}.`;
  return await deliver(dbStore(db), leadId, `team_quote_decision:${version}` as Kind, () => mailTeam(db, { subject: `Quote ${decision}: ${lead.booking_id ?? ''}`.trim(), text: `${line}\nOpen: ${deskUrl()}`, html: `<p>${line.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p><p><a href="${deskUrl()}">Open the desk</a></p>` }, 'team_quote'));
}

/** Run by desk-automation every few minutes: retries failed customer messages, tells the team about unpaid links and unassigned paid bookings. Each item once. */
export async function sweepConfirmations(db: Db): Promise<Record<string, number>> {
  const out = { retried: 0, link_nudges: 0, unassigned: 0 };
  const nudgeMin = Number(await getSetting(db, 'confirm_nudge_minutes', 30)) || 30, unMin = Number(await getSetting(db, 'unassigned_alert_minutes', 15)) || 15;
  const since = new Date(Date.now() - 3 * 86400_000).toISOString();
  // 1. paid in the last 3 days: anything not sent yet (never run, or failed) is run again
  const { data: paid } = await db.from('leads').select('id').not('confirm_fee', 'is', null).not('confirm_paid_at', 'is', null).gt('confirm_paid_at', since).is('deleted_at', null).limit(40);
  for (const l of paid ?? []) {
    const { data: rows } = await db.from('booking_notifications').select('kind,status,attempts').eq('lead_id', l.id);
    const todo = dueKinds(rows ?? [], ['confirm_email', 'receipt_email', 'confirm_whatsapp', 'team_paid']);
    if (todo.length) { await afterConfirmationPaid(db, l.id); out.retried++; }
  }
  // 2. link sent, unpaid after N minutes
  const { data: unpaid } = await db.from('leads').select('id,booking_id,vehicle,area,payment_link_sent_at').not('confirm_fee', 'is', null).is('confirm_paid_at', null).not('payment_link_sent_at', 'is', null).is('deleted_at', null).in('status', ['payment_sent', 'new', 'contacted', 'quoted']).gt('payment_link_sent_at', since).limit(40);
  for (const l of unpaid ?? []) if (olderThan(l.payment_link_sent_at, nudgeMin)) {
    const r = await deliver(dbStore(db), l.id, 'team_link_unpaid', () => mailTeam(db, teamNudgeMessage('team_link_unpaid', { bookingId: l.booking_id, vehicle: l.vehicle ?? 'bike', area: l.area, minutes: nudgeMin, deskUrl: deskUrl() }), 'team_nudge'));
    if (r === 'sent') out.link_nudges++;
  }
  // 3. paid, no mechanic after M minutes
  const { data: bare } = await db.from('leads').select('id,booking_id,vehicle,area,confirm_paid_at').not('confirm_fee', 'is', null).not('confirm_paid_at', 'is', null).is('mechanic_id', null).is('deleted_at', null).in('status', ['paid', 'scheduled']).gt('confirm_paid_at', since).limit(40);
  for (const l of bare ?? []) if (olderThan(l.confirm_paid_at, unMin)) {
    const r = await deliver(dbStore(db), l.id, 'team_unassigned', () => mailTeam(db, teamNudgeMessage('team_unassigned', { bookingId: l.booking_id, vehicle: l.vehicle ?? 'bike', area: l.area, minutes: unMin, deskUrl: deskUrl() }), 'team_nudge'));
    if (r === 'sent') out.unassigned++;
  }
  return out;
}

/** The mechanic marked On the way: one email to the customer with the private live link, once per booking (booking_notifications ontheway_email). There is no approved WhatsApp template for this yet, so WhatsApp is not sent. Never throws. */
export async function sendOnTheWay(db: Db, leadId: string, force = false): Promise<string> {
  try {
    const { data: lead } = await db.from('leads').select('*').eq('id', leadId).is('deleted_at', null).maybeSingle();
    if (!lead || lead.confirm_fee == null || !lead.confirm_paid_at) return 'not a paid confirmation';
    const c = await contextOf(db, lead);
    return await deliver(dbStore(db), leadId, 'ontheway_email', async () => c.token ? mailTo(db, leadId, c.email, 'mechanic_on_the_way', mechanicOnTheWay({ ...siteInfo(), name: lead.name, ref: lead.booking_id ?? null, mechanicFirst: c.mechanicFirst, trackUrl: c.trackUrl })) : { ok: false, skipped: true, error: 'no tracking link yet' }, force);
  } catch (e) { console.error('sendOnTheWay', (e as Error).message); return 'failed'; }
}
/** A customer reported a problem: one team email per issue (team_issue:N), plus the issue itself in the desk. Never throws. */
export async function notifyTeamIssue(db: Db, leadId: string, n: number, category: string): Promise<string> {
  try {
    const { data: lead } = await db.from('leads').select('booking_id,vehicle,area').eq('id', leadId).maybeSingle();
    if (!lead) return 'not found';
    const k = `team_issue:${Math.max(1, Math.min(999, n || 1))}` as Kind;
    return await deliver(dbStore(db), leadId, k, () => mailTeam(db, teamIssueMessage({ bookingId: lead.booking_id, vehicle: lead.vehicle ?? 'bike', area: lead.area, category, deskUrl: deskUrl() }), 'team_issue'));
  } catch (e) { console.error('notifyTeamIssue', (e as Error).message); return 'failed'; }
}
/** A partner garage sent an estimate (n = its number for this job) or marked the vehicle ready: one team email each, logged in booking_notifications. No customer name or number. Never throws. */
export async function notifyTeamGarage(db: Db, leadId: string, kind: 'estimate' | 'ready', n: number, garageName: string, total?: number): Promise<string> {
  try {
    const { data: lead } = await db.from('leads').select('booking_id,vehicle').eq('id', leadId).maybeSingle();
    if (!lead) return 'not found';
    const k = (kind === 'ready' ? 'team_garage_ready' : `team_garage_estimate:${Math.max(1, Math.min(999, n || 1))}`) as Kind;
    return await deliver(dbStore(db), leadId, k, () => mailTeam(db, teamGarageMessage(kind, { bookingId: lead.booking_id, vehicle: lead.vehicle ?? 'bike', garageName, total, deskUrl: deskUrl() }), 'team_garage'));
  } catch (e) { console.error('notifyTeamGarage', (e as Error).message); return 'failed'; }
}
