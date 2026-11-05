// What a customer may add to their booking from the private tracking page. Pure (no Deno APIs), so Node can test it. The database cleans and limits the same fields again.
export const ISSUE_TYPES = ['late', 'mechanic', 'payment', 'safety', 'other'] as const;
export const MAX_PHOTOS = 3, MAX_PHOTO_BYTES = 1_572_864;
export const PHOTO_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const text = (v: unknown, max: number) => String(v ?? '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const FIELDS: Record<string, number> = { landmark: 120, access_note: 200, vehicle_note: 300, issue_text: 600 };

/** Only the keys that were sent are returned (a missing key means "leave it"; an empty string clears it). */
export function cleanDetails(b: Record<string, unknown>): { ok: true; value: Record<string, string> } | { ok: false; error: string; field: string } {
  const out: Record<string, string> = {};
  for (const k of Object.keys(FIELDS)) if (k in (b ?? {})) out[k] = text(b[k], FIELDS[k]);
  if ('reg_no' in (b ?? {})) {
    const r = text(b.reg_no, 13).toUpperCase();
    if (r && !/^[A-Z0-9 -]{4,13}$/.test(r)) return { ok: false, field: 'reg_no', error: 'Enter the registration number like KA 01 AB 1234, or leave it empty.' };
    out.reg_no = r;
  }
  if ('kms' in (b ?? {})) {
    const k = String(b.kms ?? '').replace(/[\s,]/g, '');
    if (k && !/^\d{1,6}$/.test(k)) return { ok: false, field: 'kms', error: 'Enter the kilometres as a number, or leave it empty.' };
    out.kms = k;
  }
  if (!Object.keys(out).length) return { ok: false, field: '', error: 'Nothing to save.' };
  return { ok: true, value: out };
}

export function cleanIssue(b: Record<string, unknown>): { ok: true; value: { category: string; body: string } } | { ok: false; error: string; field: string } {
  const category = String(b?.category ?? '');
  if (!(ISSUE_TYPES as readonly string[]).includes(category)) return { ok: false, field: 'category', error: 'Choose what the problem is about.' };
  const body = text(b?.body, 500);
  if (body.length < 3) return { ok: false, field: 'body', error: 'Tell us briefly what went wrong.' };
  return { ok: true, value: { category, body } };
}

/** The extensions for the signed upload URLs to make: 1 to the number of free slots, each a JPEG, PNG or WebP. */
export function cleanPhotoRequest(b: any, left: number): { ok: true; value: string[] } | { ok: false; error: string } {
  const types = Array.isArray(b?.types) ? b.types.map((t: unknown) => String(t)) : [];
  if (!types.length) return { ok: false, error: 'Choose a photo.' };
  if (types.length > Math.max(0, Math.min(MAX_PHOTOS, left))) return { ok: false, error: left > 0 ? `You can add ${left} more photo${left === 1 ? '' : 's'}.` : 'You can add up to 3 photos.' };
  if (!types.every((t: string) => PHOTO_TYPES[t])) return { ok: false, error: 'Photos must be JPEG, PNG or WebP.' };
  return { ok: true, value: types.map((t: string) => PHOTO_TYPES[t]) };
}
export const photoPathOk = (leadId: string, path: unknown) => new RegExp(`^${leadId}/[0-9a-f-]{36}\\.(jpg|png|webp)$`).test(String(path ?? ''));
