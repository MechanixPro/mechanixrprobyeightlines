// A lead is not a booking. The customer-visible booking ID (leads.booking_id, MP-yy-yy-####) exists only after Crew or Admin confirms,
// or the booking is paid, scheduled or completed. leads.ref is the private lookup key for links and URLs ('L-' + 6 characters for new leads); never show it to a customer.

export const REF_RE = /^(?:MP-\d{2}-\d{2}-\d{4}|MP-[A-Z0-9]{6}|L-[A-Z0-9]{6})$/;       // every ref or booking ID a link or customer can hold
export const REF_IN_TEXT = /(?:MP-\d{2}-\d{2}-\d{4}|MP-[A-Z0-9]{6}|L-[A-Z0-9]{6})/;       // the same, found inside a WhatsApp message
export const NEUTRAL_ID = 'request';                                                     // fills a template slot that used to hold the ID (same parameter count)

type HasId = { booking_id?: string | null } | null | undefined;

export const bookingId = (l: HasId): string | null => String(l?.booking_id ?? '').trim() || null;
/** The template parameter that used to carry the ID: the booking ID once there is one, else a neutral word. */
export const idParam = (l: HasId): string => bookingId(l) ?? NEUTRAL_ID;
/** "booking MP-26-27-0001" once confirmed, else "your request". */
export const forBooking = (l: HasId): string => { const id = bookingId(l); return id ? `booking ${id}` : 'your request'; };
/** What the team sees where an ID would go: the booking ID once there is one, else the word Lead. */
export const leadLabel = (l: HasId): string => bookingId(l) ?? 'Lead';
/** Words for a sentence like "We got your request" / "We got booking MP-..." without ever showing a private ref. */
export const idOrRequest = (l: HasId): string => bookingId(l) ?? 'your request';

/** PostgREST filter for a customer or link lookup: the private ref, the ID a link carried before this change, or the booking ID the customer was given. */
export function refFilter(raw: string): string {
  const r = String(raw ?? '').toUpperCase().replace(/[^A-Z0-9-]/g, '');
  return `ref.eq.${r},old_ref.eq.${r},booking_id.eq.${r},ref_aliases.cs.{${r}}`;
}
