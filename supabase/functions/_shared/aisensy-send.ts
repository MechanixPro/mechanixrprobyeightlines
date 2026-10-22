// Sending a WhatsApp template through AiSensy's Campaign API (the Care Buddy desk number). Pure builder plus a small sender, so Node can test the builder.
export const AISENSY_URL = 'https://backend.aisensy.com/campaign/t1/api/v2';

export function buildCampaignRequest(o: { apiKey: string; campaignName: string; phone: string; name: string; params: string[]; source?: string }):
  { ok: true; body: Record<string, unknown> } | { ok: false; error: string } {
  const phone = String(o.phone ?? '').replace(/\D/g, '').slice(-10);
  if (!o.apiKey) return { ok: false, error: 'AiSensy is not connected' };
  if (!/^[a-zA-Z0-9_-]{3,80}$/.test(o.campaignName ?? '')) return { ok: false, error: 'campaign name' };
  if (!/^[6-9]\d{9}$/.test(phone)) return { ok: false, error: 'phone' };
  const clean = (s: unknown, n: number) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n);
  return {
    ok: true,
    body: {
      apiKey: o.apiKey, campaignName: o.campaignName, destination: '+91' + phone, userName: clean(o.name, 60) || 'Customer',
      source: clean(o.source ?? 'mechanix-desk', 40), templateParams: (o.params ?? []).map((p) => clean(p, 1000)),
    },
  };
}

/** Returns { ok } or { ok: false, error }. Never throws, and never puts the key in an error message. */
export async function sendCampaign(o: Parameters<typeof buildCampaignRequest>[0], doFetch: typeof fetch = fetch): Promise<{ ok: boolean; error?: string }> {
  const req = buildCampaignRequest(o);
  if (!req.ok) return { ok: false, error: req.error };
  try {
    const r = await doFetch(AISENSY_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req.body) });
    if (r.ok) return { ok: true };
    const t = (await r.text().catch(() => '')).replace(o.apiKey, '***').slice(0, 200);
    return { ok: false, error: `AiSensy said ${r.status}${t ? ': ' + t : ''}` };
  } catch (e) {
    return { ok: false, error: 'Could not reach AiSensy' };
  }
}
