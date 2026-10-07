// Email address checking shared by the lead validator and the sender. No Deno APIs, so Node can test it.
export const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$/i;
export function cleanEmail(v: unknown): string | null {
  const s = String(v ?? '').trim().toLowerCase();
  return s.length <= 120 && EMAIL_RE.test(s) ? s : null;
}
