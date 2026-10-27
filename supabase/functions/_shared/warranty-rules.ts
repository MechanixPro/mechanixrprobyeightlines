// Pure rules for warranty cards (no imports, so tests can load it).
export const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // no 0, 1, I, O

/** A card code like MPW-7K3Q9X from random bytes. */
export function makeCode(bytes: ArrayLike<number>): string {
  let s = ''; for (let i = 0; i < 6; i++) s += CODE_ALPHABET[(bytes[i] ?? 0) % CODE_ALPHABET.length];
  return 'MPW-' + s;
}
export const validCode = (c: unknown): c is string => typeof c === 'string' && /^MPW-[23456789A-HJ-NP-Z]{6}$/.test(c);

/** The Indian date (YYYY-MM-DD) of a moment. */
export const istDate = (ts: number | string | Date): string => new Date(new Date(ts).getTime() + 330 * 60_000).toISOString().slice(0, 10);

/** The last day of a warranty that starts on `done` (YYYY-MM-DD) and lasts `days` days, counting the day of service as day 1. */
export function validUntil(done: string, days: number): string {
  const d = new Date(done + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + Math.max(1, Math.round(days)) - 1); return d.toISOString().slice(0, 10);
}
export const warrantyStatus = (until: string, now: number | Date = Date.now()): 'active' | 'expired' => (istDate(now) <= until ? 'active' : 'expired');

/** Registration number with the middle hidden for the public page: KA05MQ1234 becomes KA••MQ1234. */
export function maskReg(reg: string | null | undefined): string {
  const r = String(reg ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase(); if (r.length <= 6) return r;
  return r.slice(0, 2) + '••' + r.slice(4);
}
/** "Asha Rao" becomes "Asha R." for the public page. */
export function shortName(name: string | null | undefined): string {
  const p = String(name ?? '').trim().split(/\s+/).filter(Boolean); if (!p.length) return 'Customer';
  return p.length === 1 ? p[0] : `${p[0]} ${p[p.length - 1][0].toUpperCase()}.`;
}
export const WARRANTY_TERMS = [
  'Valid for the dates shown, starting on the day of service.',
  'Covers the workmanship of the service listed on this card. Parts carry the part maker\'s limited warranty, as labelled on your invoice.',
  'Does not cover accidents, misuse, water damage, normal wear of wear parts, or work done by anyone else after our service.',
  'To claim, message us on WhatsApp with the booking number and a photo of the issue.',
];
