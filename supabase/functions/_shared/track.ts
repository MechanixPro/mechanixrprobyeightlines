// What a customer may see when they look up a booking: progress only, never contact details, address or notes. No Deno APIs, so Node can test it.
import { formatWhen } from './when.ts';
import { REF_RE } from './booking-id.ts';
export const STAGES = ['Request received', 'Quote shared', 'Slot confirmed', 'Mechanic booked', 'Service done'];
const BY_STATUS: Record<string, { index: number; note: string; closed?: boolean }> = {
  new: { index: 0, note: 'We have your request. Our expert will message or call you soon.' },
  contacted: { index: 0, note: 'Our expert is checking your bike details and preparing your quote.' },
  quoted: { index: 1, note: 'Your quote has been shared. Approve it on WhatsApp to go ahead.' },
  payment_sent: { index: 1, note: 'Waiting for the checkup and quote fee to lock your slot.' },
  paid: { index: 2, note: 'Your slot is confirmed. We will assign your mechanic.' },
  scheduled: { index: 3, note: 'Your mechanic is booked for your slot.' },
  completed: { index: 4, note: 'Your service is done. Your 30-day service warranty has started.' },
  lost: { index: 0, note: 'This booking is closed. Message us on WhatsApp to start again.', closed: true },
};
export function stageFor(status: string) { const s = BY_STATUS[status] ?? BY_STATUS.new; return { index: s.index, note: s.note, closed: !!s.closed }; }

export function cleanLookup(b: Record<string, unknown>): { ok: true; ref: string; phone: string } | { ok: false } {
  const ref = String(b?.ref ?? '').trim().toUpperCase();
  const phone = String(b?.phone ?? '').replace(/\D/g, '').slice(-10);
  if (!REF_RE.test(ref) ||!/^[6-9]\d{9}$/.test(phone)) return { ok: false };
  return { ok: true, ref, phone };
}

type QuoteView = { status: string; version: number; eta_text?: string | null; lines?: { kind: string; name: string; amount: number }[]; subtotal?: number; gst?: number; total?: number; fee_credit?: number; balance?: number };
type Extra = { quote?: QuoteView | null; service?: string | null; bike?: string | null; nick?: string | null; mechanic?: string | null; certified?: boolean; doorVerified?: boolean; secret?: { code?: string | null; address?: string | null } | null; vehicle?: string | null };

export const DOOR_LINE = 'Give this code to the mechanic when they arrive. Do not share it before.';
const paidConfirmation = (l: Record<string, any>) => l.confirm_fee != null;
const isPaid = (l: Record<string, any>) => !paidConfirmation(l) || !!l.confirm_paid_at || ['paid', 'scheduled', 'completed'].includes(l.status);

/** The visit timeline for a booking with a confirmation fee, in the customer's words:
 *  Confirmed and paid, Mechanic assigned, On the way, Arrived and verified, Quote sent, Approved, Work started (or Picked up), Ready, Delivered, Completed.
 *  Pure: lead columns in, steps out. Only the mechanic's first name is used; no phone, no address. quote is the latest sent, approved or declined quote. */
export const VISIT_KEYS = ['confirmed', 'assigned', 'on_the_way', 'verified', 'quote_sent', 'approved', 'work', 'ready', 'delivered', 'completed'] as const;
export function visitView(l: Record<string, any>, x: { mechanic?: string | null; doorVerified?: boolean; vehicle?: string | null; quote?: { status?: string; version?: number; eta_text?: string | null } | null } = {}) {
  const what = x.vehicle === 'car' ? 'car' : 'bike';
  const stage = String(l.visit_stage ?? ''), q = x.quote ?? null, qs = q?.status ?? null;
  const picked = ['picked_up', 'ready', 'returned'].includes(stage) && l.job_place === 'garage';
  const label: Record<string, string> = {
    confirmed: 'Confirmed and paid', assigned: 'Mechanic assigned', on_the_way: 'On the way', verified: 'Arrived and verified',
    quote_sent: qs === 'declined' ? 'Quote declined' : (q?.version ?? 1) > 1 ? 'Revised quote sent' : 'Quote sent', approved: 'Approved',
    work: picked ? 'Picked up' : 'Work started', ready: 'Ready', delivered: 'Delivered', completed: 'Completed',
  };
  const steps0 = () => VISIT_KEYS.map((key) => ({ key, label: label[key], state: 'todo' as string }));
  if (l.status === 'lost' || l.status === 'junk') return { steps: steps0(), index: -1, closed: true, note: 'This booking is closed. Message us on WhatsApp to start again.', next: null as string | null, eta: null as string | null };
  let index = -1, note = 'Pay the small confirmation fee to confirm your slot.', next: string | null = 'We confirm your slot as soon as the payment is received.';
  const first = x.mechanic ? String(x.mechanic).trim().split(/\s+/)[0] : null;
  if (isPaid(l)) {
    index = 0; note = 'Your slot is confirmed. We are assigning your mechanic.'; next = 'We assign a mechanic and you will see the name here.';
    if (l.mechanic_id && first) { index = 1; note = `${first} is your mechanic for this slot.`; next = 'The mechanic marks On the way before leaving for your address.'; }
    if (stage === 'on_the_way') { index = 2; note = `${first ?? 'Your mechanic'} is on the way.`; next = 'On arrival the mechanic asks for your code. Have it ready.'; }
    if (stage === 'arrived') { index = 2; note = `${first ?? 'Your mechanic'} has arrived.`; next = 'Give your code to the mechanic so the job can start.'; }
    if (x.doorVerified || ['started', 'repair_doorstep', 'picked_up', 'ready', 'returned'].includes(stage)) { index = 3; note = 'Code verified. The mechanic is checking your vehicle.'; next = 'You get an itemised quote here. Nothing starts without your OK.'; }
    if (qs === 'sent') { index = 4; note = 'Your quote is ready. Review it and approve or decline.'; next = 'The work starts after you approve.'; }
    if (qs === 'declined') { index = 4; note = 'You declined the quote. We will call you to talk about it.'; next = 'No work starts unless you approve a quote.'; }
    if (qs === 'approved') { index = 5; note = 'Quote approved. The work can start.'; next = `The mechanic repairs your ${what} here or takes it to the workshop.`; }
    if (stage === 'repair_doorstep') { index = 6; note = 'Work started at your place.'; next = 'We tell you when it is ready.'; }
    if (stage === 'picked_up') { index = 6; note = `Your ${what} was picked up for the workshop.`; next = 'We tell you when it is ready. The return is checked with a new code.'; }
    if (stage === 'ready') { index = 7; note = `Your ${what} is ready.`; next = picked ? 'The mechanic brings it back and you give a code again.' : 'The mechanic hands it over.'; }
    if (stage === 'returned') { index = 8; note = `Your ${what} was delivered.`; next = 'We close the job after the final payment.'; }
    if (l.status === 'completed') { index = 9; note = 'Your job is done. Your 30-day service warranty has started.'; next = null; }
  }
  const steps = VISIT_KEYS.map((key, i) => ({ key, label: label[key], state: index === 9 ? 'done' : i < index ? 'done' : i === index ? 'current' : 'todo' }));
  if (index < 0) steps[0].state = 'current';
  return { steps, index, closed: false, note, next, eta: qs && qs !== 'declined' ? q?.eta_text ?? null : null };
}

export function trackView(l: Record<string, any>, x: Extra) {
  const st = stageFor(l.status);
  const when = l.preferred_date && l.preferred_slot ? formatWhen(l.preferred_date, l.preferred_slot, l.preferred_time) : null;
  const base = String(x.bike ?? '').trim();
  const bike = x.nick ? `"${x.nick}"${base ? ` (${base})` : ''}` : base || null;
  const showMech = (['scheduled', 'completed'].includes(l.status) || (paidConfirmation(l) && isPaid(l))) && x.mechanic;   // with a confirmation fee the mechanic shows (first name) as soon as one is assigned
  return {
    booking_id: l.booking_id ?? null, status: l.status, stage: st.index, closed: st.closed, note: st.note, stages: STAGES,
    service: x.service ?? null, bike, area: l.area ?? null, when,
    mechanic: showMech ? String(x.mechanic).trim().split(/\s+/)[0] : null, certified: showMech ? x.certified !== false : null,
    estimate: l.est_total ?? null,
    ...(paidConfirmation(l) ? confirmationExtras(l, x) : {}),
  };
}

/** Extra fields for a booking with a confirmation fee. The door code and the address appear only when the caller proved the secret tracking link (x.secret). */
function confirmationExtras(l: Record<string, any>, x: Extra) {
  const v = visitView(l, { mechanic: x.mechanic, doorVerified: x.doorVerified, vehicle: x.vehicle, quote: x.quote });
  const paid = isPaid(l), showCode = !!x.secret?.code && paid && !x.doorVerified && l.status !== 'completed';
  return {
    visit: v, confirmation: { fee: l.confirm_fee, paid, adjusted: 'Adjusted in your final bill.' }, vehicle: x.vehicle === 'car' ? 'car' : 'bike',
    quote: x.quote ? (x.secret ? { ...x.quote, can_decide: x.quote.status === 'sent' } : { status: x.quote.status, version: x.quote.version, eta_text: x.quote.eta_text ?? null }) : null,
    door_code: showCode ? x.secret!.code : null, door_line: showCode ? DOOR_LINE : null, address: x.secret?.address ?? null, secret_link: !!x.secret,
  };
}
