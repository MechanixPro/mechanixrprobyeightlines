// What a customer may see when they look up a booking: progress only, never contact details, address or notes. No Deno APIs, so Node can test it.
import { formatWhen } from './when.ts';
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
  if (!/^MP-[A-Z0-9]{6}$/.test(ref) || !/^[6-9]\d{9}$/.test(phone)) return { ok: false };
  return { ok: true, ref, phone };
}

type Extra = { service?: string | null; bike?: string | null; nick?: string | null; mechanic?: string | null; certified?: boolean };
export function trackView(l: Record<string, any>, x: Extra) {
  const st = stageFor(l.status);
  const when = l.preferred_date && l.preferred_slot ? formatWhen(l.preferred_date, l.preferred_slot, l.preferred_time) : null;
  const base = String(x.bike ?? '').trim();
  const bike = x.nick ? `"${x.nick}"${base ? ` (${base})` : ''}` : base || null;
  const showMech = ['scheduled', 'completed'].includes(l.status) && x.mechanic;
  return {
    ref: l.ref, status: l.status, stage: st.index, closed: st.closed, note: st.note, stages: STAGES,
    service: x.service ?? null, bike, area: l.area ?? null, when,
    mechanic: showMech ? String(x.mechanic).trim().split(/\s+/)[0] : null, certified: showMech ? x.certified !== false : null,
    estimate: l.est_total ?? null,
  };
}
