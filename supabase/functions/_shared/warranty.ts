// Issues and describes warranty cards. Rules (codes, dates, masking) live in warranty-rules.ts.
import { getSetting } from './util.ts';
import { makeCode, istDate, validUntil } from './warranty-rules.ts';

export const SITE = Deno.env.get('SITE_URL') ?? 'https://mechanixpro.in';
export const cardUrl = (code: string) => `${SITE}/warranty/?c=${encodeURIComponent(code)}`;

/** Creates the card for a completed booking, or returns the one it already has. */
export async function issueCard(db: any, leadId: string): Promise<{ card?: any; error?: string }> {
  const { data: have } = await db.from('warranty_cards').select('*').eq('lead_id', leadId).maybeSingle();
  if (have) return { card: have };
  const { data: lead } = await db.from('leads').select('id,ref,name,phone,status,completed_at,service_id,bike_id,customer_id').eq('id', leadId).maybeSingle();
  if (!lead) return { error: 'Booking not found' };
  if (lead.status !== 'completed' || !lead.completed_at) return { error: 'The booking must be marked completed first' };
  let bike: any = null;
  if (lead.bike_id) bike = (await db.from('bikes').select('reg_no,brand,model').eq('id', lead.bike_id).maybeSingle()).data;
  else if (lead.customer_id) bike = (await db.from('bikes').select('reg_no,brand,model').eq('customer_id', lead.customer_id).limit(1)).data?.[0] ?? null;
  const svc = lead.service_id ? (await db.from('services').select('name').eq('id', lead.service_id).maybeSingle()).data : null;
  const days = Math.max(1, Math.round(Number(await getSetting(db, 'warranty_days', 30)) || 30));
  const done = istDate(lead.completed_at);
  for (let i = 0; i < 5; i++) {
    const code = makeCode(crypto.getRandomValues(new Uint8Array(6)));
    const row = { code, lead_id: lead.id, customer_name: lead.name, phone: lead.phone, vehicle_reg: bike?.reg_no ? String(bike.reg_no).toUpperCase() : null, bike_label: bike ? [bike.brand && bike.brand !== 'Other' ? bike.brand : '', bike.model].filter(Boolean).join(' ') || null : null, service_name: svc?.name ?? null, done_on: done, valid_until: validUntil(done, days), days };
    const { data, error } = await db.from('warranty_cards').insert(row).select('*').single();
    if (!error) return { card: data };
    if (error.code === '23505') { const again = (await db.from('warranty_cards').select('*').eq('lead_id', leadId).maybeSingle()).data; if (again) return { card: again }; continue; }
    return { error: error.message };
  }
  return { error: 'Could not make a card code' };
}
