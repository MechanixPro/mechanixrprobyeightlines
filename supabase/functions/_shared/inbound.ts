// Saves one customer message from the desk's WhatsApp number on their lead. Shared by the AiSensy flow endpoint and the AiSensy webhook.
// It never replies by itself. STOP-type words opt the customer out of automated messages.
const OPEN = ['new', 'contacted', 'quoted', 'payment_sent'];
export const STOP_WORDS = /^\s*(stop|unsubscribe|cancel messages|band karo)\s*$/i;

export async function ingestInbound(db: any, x: { phone: string; name: string; text: string; id: string | null }): Promise<{ ok: boolean; duplicate?: boolean; lead?: string; error?: string }> {
  // A flow can fire twice for one message: skip an identical message from the same number in the last 20 seconds.
  const since = new Date(Date.now() - 20_000).toISOString();
  const { count: same } = await db.from('messages').select('id', { count: 'exact', head: true }).eq('phone', x.phone).eq('direction', 'in').eq('body', x.text).gte('created_at', since);
  if ((same ?? 0) > 0) return { ok: true, duplicate: true };

  const { data: cust } = await db.from('customers').upsert({ phone: x.phone, ...(x.name ? { name: x.name } : {}) }, { onConflict: 'phone', ignoreDuplicates: !x.name }).select('id,blocked').maybeSingle();
  if (cust?.blocked) return { ok: true };
  let lead: any = (await db.from('leads').select('*').eq('phone', x.phone).is('deleted_at', null).order('created_at', { ascending: false }).limit(1).maybeSingle()).data;
  if (!lead || ['completed', 'lost'].includes(lead.status)) {
    lead = (await db.from('leads').insert({ customer_id: cust?.id ?? null, name: (x.name || 'WhatsApp customer').slice(0, 60), phone: x.phone, source: 'whatsapp', consent_whatsapp: true, page: 'whatsapp-desk' }).select('*').single()).data;
  }
  if (!lead) return { ok: false, error: 'Could not save' };

  const { error: dup } = await db.from('messages').insert({ lead_id: lead.id, phone: x.phone, direction: 'in', sender: 'customer', body: x.text, wa_message_id: x.id });
  if (dup?.code === '23505') return { ok: true, duplicate: true };
  const patch: Record<string, unknown> = { last_customer_msg_at: new Date().toISOString(), consent_whatsapp: true };
  if (lead.status === 'new' && lead.crm_owner) patch.status = 'contacted';
  if (STOP_WORDS.test(x.text)) Object.assign(patch, { opted_out: true, ai_enabled: false, next_followup_at: null });
  await db.from('leads').update(patch).eq('id', lead.id);
  return { ok: true, lead: lead.ref };
}
