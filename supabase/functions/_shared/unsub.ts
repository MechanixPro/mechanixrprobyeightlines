// Signed unsubscribe links: the token is an HMAC of the customer id, so nobody can unsubscribe someone else by guessing ids.
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');

export async function unsubToken(customerId: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('unsub:' + customerId))).slice(0, 32);
}
export async function verifyUnsub(customerId: string, token: string, secret: string): Promise<boolean> {
  const want = await unsubToken(customerId, secret);
  if (token.length !== want.length) return false;
  let diff = 0; for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ token.charCodeAt(i);
  return diff === 0;
}
// Links for a marketing email: a page for people, and the one-click address mail apps call by themselves.
export async function unsubLinks(customerId: string, secret: string, siteUrl: string, functionsUrl: string) {
  const t = await unsubToken(customerId, secret);
  const q = `c=${encodeURIComponent(customerId)}&t=${t}`;
  return { page: `${siteUrl}/unsubscribe/?${q}`, oneClick: `${functionsUrl}/unsubscribe?${q}` };
}
