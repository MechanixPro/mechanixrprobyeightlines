// Customer rating links. Pure (WebCrypto only), so Node can test it.
// The link carries the booking reference and a signature only the server can make, so nobody can rate a booking they were not sent a link for.
const enc = new TextEncoder();
async function hmacHex(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export const ratingToken = async (secret: string, ref: string): Promise<string> => (await hmacHex(secret, 'rate|' + ref)).slice(0, 24);
export async function ratingTokenOk(secret: string, ref: string, k: string): Promise<boolean> {
  if (!secret || !/^[a-f0-9]{24}$/.test(String(k ?? ''))) return false;
  const want = await ratingToken(secret, ref); let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ k.charCodeAt(i);
  return diff === 0;
}
export const ratingUrl = (site: string, ref: string, token: string) => `${site.replace(/\/$/, '')}/rate/?r=${encodeURIComponent(ref)}&k=${token}`;

export function cleanRating(b: Record<string, unknown>): { ok: true; value: { ref: string; k: string; rating: number; comment: string | null } } | { ok: false; error: string } {
  const ref = String(b?.ref ?? '').toUpperCase().replace(/[^A-Z0-9-]/g, '');
  if (!/^MP-[A-Z0-9]{6}$/.test(ref)) return { ok: false, error: 'This rating link is not valid.' };
  const rating = Number(b?.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return { ok: false, error: 'Choose a rating from 1 to 5.' };
  const comment = String(b?.comment ?? '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500) || null;
  return { ok: true, value: { ref, k: String(b?.k ?? ''), rating, comment } };
}
