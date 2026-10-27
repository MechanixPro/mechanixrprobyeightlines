// POST /functions/v1/mechanic-pay-link  { lead_id, amount }  — called from the admin panel by a signed-in admin.
// Makes a Razorpay link for the amount a mechanic owes the company from money collected at the customer's door, and returns a ready WhatsApp message.
// When the mechanic pays, razorpay-webhook records it in the ledger as a remittance for that mechanic and booking.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { adminDb, env, json, corsHeaders } from '../_shared/util.ts';
import { createPaymentLink } from '../_shared/razorpay.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405);
  const userClient = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }, auth: { persistSession: false } });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json(req, { error: 'Sign in again' }, 401);
  const db = adminDb();
  const { data: admin } = await db.from('admins').select('user_id').eq('user_id', user.id).maybeSingle();
  if (!admin) return json(req, { error: 'Not allowed' }, 403);

  const b = await req.json().catch(() => ({}));
  const amount = Math.round(Number(b.amount) * 100) / 100;
  if (!(amount >= 1 && amount <= 100000)) return json(req, { error: 'Amount must be between ₹1 and ₹1,00,000' }, 400);
  const { data: lead } = await db.from('leads').select('id,ref,mechanic_id').eq('id', String(b.lead_id ?? '')).maybeSingle();
  if (!lead) return json(req, { error: 'Booking not found' }, 404);
  if (!lead.mechanic_id) return json(req, { error: 'Assign a mechanic to this booking first' }, 400);
  const { data: mech } = await db.from('mechanics').select('id,name,phone').eq('id', lead.mechanic_id).maybeSingle();
  if (!mech) return json(req, { error: 'Mechanic not found' }, 404);

  try {
    const link = await createPaymentLink({ amount, ref: lead.ref, leadId: lead.id, name: mech.name, phone: String(mech.phone ?? '').replace(/\D/g, '').slice(-10), description: `Company share for booking ${lead.ref}`, notes: { purpose: 'remittance', mechanic_id: mech.id } });
    await db.from('audit_log').insert({ actor: user.id, action: 'mechanic_pay_link_created', details: { lead: lead.ref, mechanic: mech.name, amount } });
    return json(req, { ok: true, url: link.url, mechanic: mech.name, phone: mech.phone ?? null });
  } catch (e) {
    return json(req, { error: (e as Error).message }, 400);
  }
});
