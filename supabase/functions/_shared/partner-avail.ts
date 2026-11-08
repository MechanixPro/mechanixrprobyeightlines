// Availability selfie, terms version and tour: pure helpers shared by garage-app and mechanic-app (Edge) and the tests (Node).
export const SELFIE_WINDOW_MS = 24 * 3600e3;
export const SELFIE_MAX_BYTES = 5 * 1024 * 1024;
export const TERMS_VERSION = 'v1';
export const SELFIE_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

/** True when a selfie taken at `at` is still good for turning Available on at `now` (24 hours, never from the future). */
export function selfieFresh(at: unknown, now: number = Date.now()): boolean {
  const t = typeof at === 'number' ? at : Date.parse(String(at ?? ''));
  if (!Number.isFinite(t)) return false;
  const age = now - t;
  return age >= -60_000 && age < SELFIE_WINDOW_MS;
}
export function checkSelfie(type: unknown, size: unknown): { ok: true; ext: string } | { ok: false; error: string } {
  const ext = SELFIE_TYPES[String(type ?? '')];
  if (!ext) return { ok: false, error: 'Use a JPG, PNG or WebP photo.' };
  const n = Number(size);
  if (!Number.isFinite(n) || n <= 0 || n > SELFIE_MAX_BYTES) return { ok: false, error: 'The photo must be under 5 MB.' };
  return { ok: true, ext };
}
export const selfiePath = (kind: 'garage' | 'mechanic', id: string, uuid: string, ext: string) => `${kind}/${id}/${uuid}.${ext}`;
export const selfiePathOk = (p: unknown, kind: 'garage' | 'mechanic', id: string) => new RegExp(`^${kind}/${id}/[0-9a-f-]{36}\\.(jpg|png|webp)$`).test(String(p ?? ''));
export const SELFIE_NEEDED = 'Take a quick selfie first to go Available.';
