// Screenshot fixtures for the Admin Money screens: 44 jobs with long names, partial payments, three mechanics, zero balances and null fields.
// PLACEHOLDERS ONLY. Served in place of the normal tables when a shot sets money:true (see supabase-stub.js).
const NOW = Date.now();
const ago = (min) => new Date(NOW - min * 60e3).toISOString();
const today = (d) => new Date(NOW - d * 864e5).toISOString().slice(0, 10);
const NAMES = ['[Customer Name]', '[Customer With A Very Long Full Name Pvt Ltd Bengaluru Branch]', 'Demo Customer', '[Customer Name Extra Long Surname Placeholder]', 'A'];
const MECHS = [{ id: 'mech-1', name: '[Mechanic Name One]', rate: 75 }, { id: 'mech-2', name: '[Mechanic With A Long Placeholder Name]', rate: 70 }, { id: 'mech-3', name: '[Mechanic Three]', rate: 80 }, null];
const leads = [], invoices = [], ledger = [];
for (let i = 1; i <= 44; i++) {
  const id = 'lead-' + (100 + i), m = MECHS[i % 4], gst = i % 3 !== 0, taxable = 400 + (i * 137) % 3200, tax = gst ? Math.round(taxable * 18) / 100 : 0, total = Math.round((taxable + tax) * 100) / 100;
  const pay = i % 5 === 0 ? 0 : i % 4 === 0 ? Math.round(total / 3) : total;           // unpaid, partial, full
  leads.push({ id, ref: 'L-MONEY' + i, name: NAMES[i % 5] + (i % 5 === 2 ? ' ' + i : ''), phone: '90000' + String(i).padStart(5, '0'), status: 'completed', booking_id: 'MP-2611-' + String(100 + i).padStart(4, '0'), bike_id: null, customer_id: null, est_total: total, paid_amount: pay, paid_at: pay ? ago(300) : null, completed_at: ago(200 + i * 40), created_at: ago(900 + i * 40), deleted_at: null, preferred_date: today(i % 20), preferred_slot: 'morning', service_id: 'svc-1', mechanic_id: m ? m.id : null, vehicle: 'bike', addons: [] });
  invoices.push({ id: 'inv-' + id, lead_id: id, ref: 'L-MONEY' + i, number: 'MP-26-27-' + String(100 + i).padStart(4, '0'), revision: 1, doc_key: 'A', issued_at: ago(150 + i * 40), via: 'print', customer_name: NAMES[i % 5] + (i % 5 === 2 ? ' ' + i : ''), customer_phone: '90000' + String(i).padStart(5, '0'), customer_company: null, customer_gstin: null, vehicle_reg: '[Vehicle Registration No]', has_gst: gst, gst_rate: gst ? 18 : 0, basis: 'excl', taxable, cgst: tax / 2, sgst: tax / 2, discount: 0, total, paid: pay, balance: total - pay, mechanic_id: m ? m.id : null, mechanic_name: m ? m.name : null, mechanic_rate: m ? m.rate : 0, mechanic_cut: m ? Math.round(taxable * m.rate) / 100 : 0, company_share: m ? total - Math.round(taxable * m.rate) / 100 : total, payable_now: 0, voided_at: null, lines: [{ name: 'Basic service', amount: taxable }] });
  if (pay) ledger.push({ id: 'le-' + i, lead_id: id, mechanic_id: m ? m.id : null, entry_type: 'customer_payment', collected_by: m && i % 2 ? 'mechanic' : i % 3 ? 'company_portal' : 'company_manual', amount: pay, gateway_fee: 0, occurred_on: today(i % 20), created_at: ago(100 + i), created_by: 'me-1', method: 'UPI', reference: null, reason: null, note: null, source: 'manual', reverses_id: null });
}
ledger.push({ id: 'le-r1', lead_id: null, mechanic_id: 'mech-1', entry_type: 'remittance', collected_by: null, amount: 500, gateway_fee: 0, occurred_on: today(1), created_at: ago(60), created_by: 'me-1', method: 'UPI', reference: null, reason: null, note: null, source: 'manual', reverses_id: null });
export const moneyTables = {
  leads, invoices, invoice_numbers: leads.map((l, i) => ({ lead_id: l.id, number: invoices[i].number })), ledger_entries: ledger,
  mechanics: MECHS.filter(Boolean).map((m, i) => ({ id: m.id, name: m.name, area: 'HSR Layout', phone: '90000009' + i, active: true, onboarding_status: 'live', payout_rate: m.rate, created_at: ago(5000) })),
};
