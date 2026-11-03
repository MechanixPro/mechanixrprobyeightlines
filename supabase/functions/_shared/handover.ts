// Rules for the OTP handover of pickup jobs (/job/ page, tech-job function, desk RPCs): the code, its hash, expiry, lockout, photos and the purge cutoff.
// No Deno APIs, so node --test can run them. The SQL in supabase/migrations/20261224000000_handover.sql follows the same numbers.

export const HANDOVER_KINDS = ['pickup', 'return'] as const;
export type HandoverKind = (typeof HANDOVER_KINDS)[number];
export const CODE_TTL_HOURS = 24;
export const MAX_ATTEMPTS = 5;
export const MIN_PHOTOS = 4;
export const MAX_PHOTOS = 8;
/** Photos are kept 12 months; handover_purge_photos() in the database reads the settings key handover_keep_months and falls back to this. */
export const HANDOVER_KEEP_MONTHS = 12;
export const PHOTO_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

export const isKind = (k: unknown): k is HandoverKind => k === 'pickup' || k === 'return';
export const isCode = (c: unknown) => /^[0-9]{4}$/.test(String(c ?? ''));

/** Only pickup jobs have a handover: the bike goes to a garage (job_place) or the customer asked for pickup (place). */
export const isPickupJob = (lead: any) => lead?.job_place === 'garage' || lead?.place === 'pickup';

/** SHA-256 of "<handover id>:<code>". The id is the salt, so a 4-digit code cannot be looked up in a table of hashes. Same as encode(extensions.digest(id || ':' || code, 'sha256'), 'hex') in the RPC. */
export async function handoverHash(id: string, code: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${id}:${code}`));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time comparison of two hex hashes. */
export function sameHash(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export const codeExpiry = (now: Date | number = new Date()) => new Date(new Date(now).getTime() + CODE_TTL_HOURS * 3600e3);

/** Where one handover row stands: verified, locked (5 wrong tries), expired (24 hours) or open. */
export function codeState(row: { verified_at?: string | null; locked_at?: string | null; code_expires_at?: string | null; attempts?: number } | null | undefined, now: Date | number = new Date()): 'none' | 'verified' | 'locked' | 'expired' | 'open' {
  if (!row) return 'none';
  if (row.verified_at) return 'verified';
  if (row.locked_at || Number(row.attempts) >= MAX_ATTEMPTS) return 'locked';
  if (!row.code_expires_at || Date.parse(row.code_expires_at) <= new Date(now).getTime()) return 'expired';
  return 'open';
}

/** The technician's view of one step. The return step waits for a verified pickup. rows are the lead's handovers, newest first. */
export function stepState(rows: any[], kind: HandoverKind, now: Date | number = new Date()): { kind: HandoverKind; state: 'waiting' | 'no_code' | 'open' | 'locked' | 'expired' | 'verified'; verified_at: string | null; photos: number } {
  const mine = rows.filter((r) => r.kind === kind);
  const done = mine.find((r) => r.verified_at);
  if (done) return { kind, state: 'verified', verified_at: done.verified_at, photos: (done.photo_paths ?? []).length };
  if (kind === 'return' && !rows.some((r) => r.kind === 'pickup' && r.verified_at)) return { kind, state: 'waiting', verified_at: null, photos: 0 };
  const s = codeState(mine[0], now);
  return { kind, state: s === 'none' ? 'no_code' : (s as 'open' | 'locked' | 'expired'), verified_at: null, photos: 0 };
}

/** After a wrong code: the new attempt count and whether it locks the handover. */
export function afterWrongTry(attempts: number) {
  const n = (Number(attempts) || 0) + 1;
  return { attempts: n, locked: n >= MAX_ATTEMPTS, left: Math.max(0, MAX_ATTEMPTS - n) };
}

/** Photo paths must be this lead's own, in the folder for this kind, one file each: <lead id>/<kind>/<uuid>.<jpg|png|webp>. Returns the clean list or an error. */
export function cleanPhotos(paths: unknown, leadId: string, kind: HandoverKind): { ok: true; value: string[] } | { ok: false; error: string } {
  if (!Array.isArray(paths)) return { ok: false, error: `Take at least ${MIN_PHOTOS} photos.` };
  const list = [...new Set(paths.map((p) => String(p ?? '')))];
  const shape = new RegExp(`^${leadId}/${kind}/[0-9a-f-]{36}\\.(jpg|png|webp)$`);
  if (!list.every((p) => shape.test(p))) return { ok: false, error: 'A photo is not valid. Take the photos again.' };
  if (list.length < MIN_PHOTOS) return { ok: false, error: `Take at least ${MIN_PHOTOS} photos: front, back, left and right.` };
  if (list.length > MAX_PHOTOS) return { ok: false, error: `Send at most ${MAX_PHOTOS} photos.` };
  return { ok: true, value: list };
}

/** How many signed upload URLs to make for a request: 1 to MAX_PHOTOS, each a jpeg, png or webp. Returns the file extensions. */
export function cleanUploadRequest(b: any): { ok: true; value: string[] } | { ok: false; error: string } {
  const types = Array.isArray(b?.types) ? b.types.map((t: unknown) => String(t)) : [];
  if (!types.length || types.length > MAX_PHOTOS) return { ok: false, error: `Send 1 to ${MAX_PHOTOS} photos at a time.` };
  if (!types.every((t: string) => PHOTO_TYPES[t])) return { ok: false, error: 'Photos must be JPEG, PNG or WebP.' };
  return { ok: true, value: types.map((t: string) => PHOTO_TYPES[t]) };
}

/** Handover photos created before this moment are due for deletion. */
export function purgeCutoff(now: Date | number = new Date(), months = HANDOVER_KEEP_MONTHS): Date {
  const d = new Date(now), day = d.getUTCDate();
  d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
}
