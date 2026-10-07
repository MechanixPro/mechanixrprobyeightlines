// WhatsApp Cloud API (Meta) helpers.
import { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { env } from './util.ts';

const graph = () => `https://graph.facebook.com/${env('WA_GRAPH_VERSION', 'v21.0')}/${env('WA_PHONE_NUMBER_ID')}/messages`;
export const whatsappReady = () => Boolean(env('WA_TOKEN') && env('WA_PHONE_NUMBER_ID'));

async function post(payload: Record<string, unknown>): Promise<string | null> {
  if (!whatsappReady()) return null;
  const r = await fetch(graph(), {
    method: 'POST',
    headers: { Authorization: `Bearer ${env('WA_TOKEN')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', ...payload }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { console.error('WhatsApp send failed', r.status, JSON.stringify(j)); return null; }
  return j?.messages?.[0]?.id ?? null;
}

/** Free-form text: only allowed within 24 hours of the customer's last message. */
export const sendText = (to10: string, body: string) =>
  post({ to: '91' + to10, type: 'text', text: { preview_url: true, body: body.slice(0, 4000) } });

/** Pre-approved template: allowed any time (needed for follow-ups after 24 hours). */
export const sendTemplate = (to10: string, name: string, params: string[], lang = env('WA_TEMPLATE_LANG', 'en')) =>
  post({
    to: '91' + to10, type: 'template',
    template: { name, language: { code: lang }, components: params.length ? [{ type: 'body', parameters: params.map((t) => ({ type: 'text', text: String(t).slice(0, 200) })) }] : [] },
  });

export function inServiceWindow(lastCustomerMsgAt: string | null): boolean {
  return !!lastCustomerMsgAt && Date.now() - new Date(lastCustomerMsgAt).getTime() < 23.5 * 3600_000;
}

/** Send text inside the 24h window, otherwise fall back to a template. Logs the message. */
export async function sendSmart(db: SupabaseClient, lead: { id: string; phone: string; last_customer_msg_at: string | null },
  text: string, template: { name: string; params: string[] }, sender: 'ai' | 'staff' | 'system' = 'system') {
  const id = inServiceWindow(lead.last_customer_msg_at)
    ? await sendText(lead.phone, text)
    : await sendTemplate(lead.phone, template.name, template.params);
  await db.from('messages').insert({ lead_id: lead.id, phone: lead.phone, direction: 'out', sender, body: text, wa_message_id: id });
  return id;
}

export const TPL = {
  received: () => env('WA_TPL_RECEIVED', 'mxp_booking_received'),
  followup: () => env('WA_TPL_FOLLOWUP', 'mxp_followup'),
  payment: () => env('WA_TPL_PAYMENT', 'mxp_payment_reminder'),
  paid: () => env('WA_TPL_PAID', 'mxp_payment_received'),
  last: () => env('WA_TPL_LAST', 'mxp_last_reminder'),
};
