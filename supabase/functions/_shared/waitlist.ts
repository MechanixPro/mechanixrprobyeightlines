// The "coming soon" waitlist: which services people can ask for, and cleaning of a signup. Pure functions so Node can test them.
import { cleanEmail } from './email-address.ts';

export const INTERESTS = [
  { id: 'car', label: 'Car service' }, { id: 'echallan', label: 'E-challan services' }, { id: 'pdi', label: 'AI PDI reports' }, { id: 'damage', label: 'AI damage analysis' },
  { id: 'rental', label: 'Bike rental' }, { id: 'oem', label: 'OEM parts' }, { id: 'insurance', label: 'Insurance claim service' }, { id: 'franchise', label: 'Franchise model' },
];
const known = new Set(INTERESTS.map((i) => i.id));
const text = (v: unknown, max: number) => String(v ?? '').replace(/<[^>]*>/g, '').replace(/[<>"\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

export type Signup = { name: string; phone: string | null; email: string | null; interests: string[]; city: string; note: string };

export function cleanWaitlist(b: Record<string, unknown>): { ok: true; value: Signup } | { ok: false; error: string } {
  const interests = [...new Set((Array.isArray(b.interests) ? b.interests : []).map((x) => String(x)).filter((x) => known.has(x)))];
  if (!interests.length) return { ok: false, error: 'Pick at least one service you are interested in.' };
  const rawPhone = String(b.phone ?? '').replace(/\D/g, '').slice(-10), phone = rawPhone ? (/^[6-9]\d{9}$/.test(rawPhone) ? rawPhone : null) : null;
  if (String(b.phone ?? '').trim() && !phone) return { ok: false, error: 'Enter a valid 10-digit mobile number, or leave it empty and give an email.' };
  const hasEmail = String(b.email ?? '').trim() !== '', email = cleanEmail(b.email);
  if (hasEmail && !email) return { ok: false, error: 'Enter a valid email address.' };
  if (!phone && !email) return { ok: false, error: 'Give a mobile number or an email so we can reach you.' };
  if (b.consent !== true) return { ok: false, error: 'Please tick the box so we may contact you about these services.' };
  return { ok: true, value: { name: text(b.name, 60), phone, email, interests, city: text(b.city, 40), note: text(b.note, 200) } };
}
