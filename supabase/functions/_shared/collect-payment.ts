// Collect payment at the end of a job. Pure helpers (no Deno APIs, so node --test runs them) plus one server routine shared by tech-job and garage-app.
// Only payment link ids, urls and amounts are stored. Never card or bank details.
export const r2 = (n: unknown): number => Math.round((Number(n) || 0) * 100) / 100;
// Visit stages at or after the vehicle reaching the customer's door or the garage (mechanic link).
export const ARRIVED_STAGES = ['arrived', 'started', 'repair_doorstep', 'picked_up', 'ready', 'returned'];
// Garage assignment statuses once the vehicle is with the garage.
export const GARAGE_ARRIVED = ['received', 'in_work', 'ready', 'returned'];
export const METHODS = ['cash', 'upi'];

export const amountDue = (bill: unknown, feePaid: unknown): number => Math.max(0, r2(r2(bill) - r2(feePaid)));
export const isArrived = (stage: string | null | undefined, status?: string | null): boolean => ARRIVED_STAGES.includes(String(stage ?? '')) || GARAGE_ARRIVED.includes(String(status ?? ''));
// Cash or UPI at the door is offered ONLY when the vehicle has arrived AND the customer asked to inspect first. Never the default.
export const cashAllowed = ({ arrived, inspectFirst }: { arrived: boolean; inspectFirst: boolean }): boolean => arrived === true && inspectFirst === true;
export const cleanCash = (b: any, due: number): { ok: true; amount: number; method: 'cash' | 'upi' } | { ok: false; error: string } => {
  const method = String(b?.method ?? '').toLowerCase();
  if (!METHODS.includes(method)) return { ok: false, error: 'Choose cash or UPI.' };
  const amount = r2(b?.amount);
  if (!(amount >= 1 && amount <= 100000)) return { ok: false, error: 'Enter the amount you received.' };
  if (due > 0 && amount > due + 0.5) return { ok: false, error: 'That is more than the amount due.' };
  return { ok: true, amount, method: method as 'cash' | 'upi' };
};
export const linkMessage = (first: string, amount: number, url: string): string =>
  `Hi ${first || 'there'}, your Mechanix Pro service is done. Please pay Rs ${amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })} here: ${url}`;
export const reusable = (lead: { final_link_id?: string | null; final_link_url?: string | null; final_link_amount?: unknown; final_paid_at?: unknown }, amount: number): boolean =>
  !!(lead.final_link_id && lead.final_link_url && !lead.final_paid_at && r2(lead.final_link_amount) === r2(amount));

// Bill for the lead: the approved quote total, else the saved invoice, else the one built from the booking (caller passes a builder).
export async function dueFor(db: any, lead: any, build: () => Promise<number>): Promise<{ bill: number; feePaid: number; due: number }> {
  const { data: q } = await db.from('job_quotes').select('total').eq('lead_id', lead.id).eq('status', 'approved').order('version', { ascending: false }).limit(1).maybeSingle();
  let bill = Number(q?.total) || 0;
  if (!bill) { const { data: inv } = await db.from('invoices').select('total').eq('lead_id', lead.id).is('voided_at', null).order('revision', { ascending: false }).limit(1).maybeSingle(); bill = Number(inv?.total) || 0; }
  if (!bill) bill = await build().catch(() => 0);
  const feePaid = lead.confirm_paid_at ? Number(lead.confirm_fee) || 0 : 0;
  return { bill, feePaid, due: amountDue(bill, feePaid) };
}

type Who = { kind: 'mechanic' | 'garage'; name: string; mechanicId: string | null };
type Ops = { createLink: (o: any) => Promise<{ id: string; url: string }>; paymentsReady?: () => boolean; razorpayReady?: () => boolean };   // paymentsReady is the active gateway; razorpayReady is the old name

// The three actions, identical rules for both apps. `arrived` is worked out by the caller from its own stage data.
export async function collectAction(db: any, ops: Ops, action: string, lead: any, who: Who, arrived: boolean, body: any, build: () => Promise<number>): Promise<{ status: number; body: any }> {
  const note = (text: string) => db.from('crm_activities').insert({ lead_id: lead.id, actor: null, kind: 'note', body: text }).then(() => {}, () => {});
  const paid = !!lead.final_paid_at;
  if (action === 'inspect_first_set') {
    if (typeof body?.on !== 'boolean') return { status: 400, body: { error: 'Choose on or off.' } };
    if (paid) return { status: 409, body: { error: 'This job is already paid.' } };
    await db.from('leads').update({ inspect_first: body.on, inspect_first_at: new Date().toISOString(), inspect_first_by: `${who.kind}:${who.name}`.slice(0, 80) }).eq('id', lead.id);
    await note(body.on ? `${who.name} ticked: customer wants to inspect before paying.` : `${who.name} cleared: customer wants to inspect before paying.`);
    await db.from('audit_log').insert({ action: 'inspect_first_set', details: { lead: lead.ref, on: body.on, by: who.kind } });
    return { status: 200, body: { ok: true, inspect_first: body.on, cash_available: cashAllowed({ arrived, inspectFirst: body.on }) } };
  }
  const { due } = await dueFor(db, lead, build);
  if (action === 'payment_request') {
    if (paid) return { status: 200, body: { ok: true, paid: true, method: lead.final_paid_method, amount: Number(lead.final_paid_amount) || 0 } };
    if (due < 1) return { status: 409, body: { error: 'There is no amount due yet. Ask the desk.' } };
    if (!(ops.paymentsReady ?? ops.razorpayReady ?? (() => false))()) return { status: 503, body: { error: 'Payments are not connected yet.' } };
    try {
      if (reusable(lead, due)) return { status: 200, body: { ok: true, url: lead.final_link_url, amount: due, reused: true, paid: false } };
      const first = String(lead.name ?? '').split(' ')[0];
      const link = await ops.createLink({ amount: due, ref: lead.ref, leadId: lead.id, name: lead.name, phone: String(lead.phone ?? '').replace(/\D/g, '').slice(-10), description: `Mechanix Pro ${lead.booking_id ? 'booking ' + lead.booking_id : 'service'}: balance`, notes: { purpose: 'final' } });
      await db.from('leads').update({ final_link_id: link.id, final_link_url: link.url, final_link_amount: due }).eq('id', lead.id);
      await note(`Payment link for Rs ${due} created by ${who.name}.`);
      return { status: 200, body: { ok: true, url: link.url, amount: due, reused: false, paid: false, first } };
    } catch (e) { const m = String((e as Error).message ?? '').replace(/[^\x20-\x7E]/g, ' ').trim().slice(0, 160); console.error('collect-payment link', m); if (/link_creation_api|not enabled or approved/i.test(m)) return { status: 502, body: { error: 'Online payment links are not switched on yet. Ask the desk, or tick "Customer wants to inspect first" to take cash or UPI on arrival.' } };
      return { status: 502, body: { error: m ? `Could not make the link: ${m}` : 'Could not make the link. Try again.' } }; }   // the gateway message holds no keys; only technicians and garages see this
  }
  // payment_cash: the rule is enforced here, not only in the screen.
  if (paid) return { status: 409, body: { error: 'This job is already paid.' } };
  if (!cashAllowed({ arrived, inspectFirst: lead.inspect_first === true })) return { status: 403, body: { error: 'Cash or UPI is only for a customer who wants to inspect first, after the vehicle has arrived.' } };
  const v = cleanCash(body, due);
  if (!v.ok) return { status: 400, body: { error: v.error } };
  if (!who.mechanicId) return { status: 409, body: { error: 'No technician is linked to this job. Ask the desk to record the cash.' } };
  const now = new Date().toISOString();
  const { data: claimed } = await db.from('leads').update({ final_paid_at: now, final_paid_method: v.method, final_paid_amount: v.amount }).eq('id', lead.id).is('final_paid_at', null).select('id').maybeSingle();
  if (!claimed) return { status: 409, body: { error: 'This job is already paid.' } };
  const { error } = await db.from('ledger_entries').insert({ entry_type: 'customer_payment', lead_id: lead.id, mechanic_id: who.mechanicId, amount: v.amount, collected_by: 'mechanic', method: v.method === 'upi' ? 'UPI at the door (technician)' : 'Cash at the door (technician)', note: `Collected by ${who.name} after the customer inspected`, source: 'technician' });
  if (error) { console.error('collect-payment ledger', error.code); await db.from('leads').update({ final_paid_at: null, final_paid_method: null, final_paid_amount: null }).eq('id', lead.id); return { status: 500, body: { error: 'Could not save. Please try again.' } }; }
  await note(`${v.method === 'upi' ? 'UPI' : 'Cash'} Rs ${v.amount} collected at the door by ${who.name}.`);
  await db.from('audit_log').insert({ action: 'final_collected', details: { lead: lead.ref, amount: v.amount, method: v.method, by: who.kind } });
  return { status: 200, body: { ok: true, paid: true, method: v.method, amount: v.amount } };
}
