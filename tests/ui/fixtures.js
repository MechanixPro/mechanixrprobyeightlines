// UI harness fixtures. PLACEHOLDERS ONLY: no real customer, phone, email or vehicle data. Phone numbers are obviously synthetic (90000 000NN).
// Used by supabase-stub.js (served in place of the Supabase client) so the real Crew and Admin pages render with no network.
const NOW = Date.now();
const ago = (min) => new Date(NOW - min * 60e3).toISOString();
const ahead = (min) => new Date(NOW + min * 60e3).toISOString();
const ph = (n) => '90000' + String(n).padStart(5, '0');

const PAGES = { dashboard: 1, inbox: 1, leads: 1, rsa: 1, tickets: 1, garage_visits: 1, garages: 1, mechanics: 1, knowledge: 1, team: 1 };
const ACTIONS = { take_leads: 1, assign_leads: 1, edit_leads: 1, view_all_leads: 1, create_bookings: 1, add_leads: 1, send_payment_link: 1, manage_technicians: 1, export: 1, create_tickets: 1, delete_leads: 1, manage_garages: 1 };

const lead = (i, o = {}) => ({ id: 'lead-' + i, name: '[Customer Name ' + i + ']', phone: ph(i), bike: '[Vehicle ' + i + ']', service_name: 'Basic service', area: ['Indiranagar', 'HSR Layout', 'Whitefield', 'Jayanagar'][i % 4], pincode: '5600' + (10 + i), status: 'new', source: 'website', utm_source: 'google', campaign: 'search-doorstep', created_at: ago(12 + i * 40), crm_owner: 'me-1', owner_name: 'Care Buddy Demo', crm_first_contact_at: null, crm_next_action_at: null, overdue: false, is_late: false, booking_id: null, vehicle: 'bike', ...o });

const crewMe = { user_id: 'me-1', name: '[Staff Name]', role: 'supervisor', is_admin: true, sla_minutes: 15, booked_today: 3, daily_target: 8, pending_advance: 2, contacts_today: 14, permissions: { pages: PAGES, actions: ACTIONS } };

const queue = [
  lead(1, { status: 'new', is_late: true, created_at: ago(95) }),
  lead(2, { status: 'contacted', crm_first_contact_at: ago(60), crm_next_action_at: ago(30), overdue: true }),
  lead(3, { status: 'quoted', crm_first_contact_at: ago(300), crm_next_action_at: ahead(90) }),
  lead(4, { status: 'payment_sent', crm_first_contact_at: ago(500), confirm_fee: 99 }),
  lead(5, { status: 'paid', booking_id: 'MP-2611-0005', confirm_fee: 49, confirm_paid_at: ago(100), mechanic_name: '[Mechanic Name]', mechanic_id: 'mech-1' }),
];
const callRows = [lead(11, { crm_owner: null, owner_name: null, created_at: ago(5) }), lead(12, { created_at: ago(70) }), lead(13, { crm_owner: null, owner_name: null, created_at: ago(300) }), lead(14, { created_at: ago(2000) })];
const leadRows = queue.map((l, i) => ({ id: l.id, lead: l.name, mobile: l.phone, platform: l.utm_source, source: l.source, stage: l.status, owner_name: l.owner_name, mechanic_id: l.mechanic_id || null, mechanic_name: l.mechanic_name || null, disposition: i % 2 ? 'Interested' : null, sub_disposition: null, follow_up: l.crm_next_action_at, created_at: l.created_at, last_activity: ago(10 + i), booking_id: l.booking_id, bike: l.bike, area: l.area, is_late: l.is_late, overdue: l.overdue, crm_first_contact_at: l.crm_first_contact_at, confirm_fee: l.confirm_fee, confirm_paid_at: l.confirm_paid_at }));
const dispatch = [
  { id: 'lead-5', booking_id: 'MP-2611-0005', vehicle: 'bike', confirm_fee: 49, review: false, first_name: '[Customer Name 5]', area: 'Indiranagar', pincode: '560038', preferred_date: '2026-11-06', preferred_slot: 'morning', bike: '[Vehicle 5]', service_name: 'Basic service', mechanic_id: null, mechanic_name: null, visit_stage: null },
  { id: 'lead-6', booking_id: 'MP-2611-0006', vehicle: 'car', confirm_fee: 99, review: true, first_name: '[Customer Name 6]', area: 'HSR Layout', pincode: '560102', preferred_date: '2026-11-06', preferred_slot: 'afternoon', bike: '[Vehicle 6]', service_name: 'Brake pads', mechanic_id: 'mech-1', mechanic_name: '[Mechanic Name]', visit_stage: 'on_the_way' },
  { id: 'lead-7', booking_id: 'MP-2611-0007', vehicle: 'bike', confirm_fee: 49, review: false, first_name: '[Customer Name 7]', area: 'Whitefield', pincode: '560066', preferred_date: '2026-11-07', preferred_slot: 'asap', bike: '[Vehicle 7]', service_name: 'Chain set', mechanic_id: 'mech-2', mechanic_name: '[Mechanic Name 2]', visit_stage: 'ready' },
];
const issues = [
  { id: 'iss-1', lead_id: 'lead-6', booking_id: 'MP-2611-0006', status: 'open', category: 'late', first_name: '[Customer Name 6]', area: 'HSR Layout', body: '[Customer message about the delay]', created_at: ago(45) },
  { id: 'iss-2', lead_id: 'lead-5', booking_id: 'MP-2611-0005', status: 'open', category: 'payment', first_name: '[Customer Name 5]', area: 'Indiranagar', body: '[Customer message about a payment]', created_at: ago(200) },
  { id: 'iss-3', lead_id: 'lead-7', booking_id: 'MP-2611-0007', status: 'resolved', category: 'other', first_name: '[Customer Name 7]', area: 'Whitefield', body: '[Customer message]', created_at: ago(3000), resolved_by: '[Staff Name]', resolved_at: ago(2900), note: 'Called and sorted' },
];
const num = (d, t, m, mt) => ({ daily_done: d, daily_target: t, monthly_done: m, monthly_target: mt });
const dashboard = { range: { from: new Date(NOW - 6 * 864e5).toISOString() }, leads: { total: 64, won: 18, won_pct: 28, lost: 12, lost_pct: 19 }, unassigned: 4, chats: { unreplied: 2, total: 9 },
  targets: { team: num(11, 30, 140, 600), me: num(3, 8, 31, 160) }, attribution: [{ platform: 'google', leads: 30, share: 47, booked: 9 }, { platform: 'instagram', leads: 18, share: 28, booked: 5 }, { platform: 'website', leads: 16, share: 25, booked: 4 }],
  agents: [{ user_id: 'u1', name: '[Care Buddy 1]', designation: 'Care Buddy', assigned: 22, won: 8, won_pct: 36, lost: 3, lost_pct: 14, daily_done: 3, daily_target: 8, monthly_done: 31, monthly_target: 160 }, { user_id: 'u2', name: '[Care Buddy 2]', designation: 'Care Buddy', assigned: 18, won: 6, won_pct: 33, lost: 4, lost_pct: 22, daily_done: 2, daily_target: 8, monthly_done: 22, monthly_target: 160 }] };
const convRows = queue.concat(callRows).map((l) => ({ ...l, platform: l.utm_source }));

const fullLead = (l) => ({ lead: { ...l, address: null, notes: '[Internal note about the customer]', est_total: 1499, mechanic_phone: null, coupon_code: null, vehicle_source: null, crm_won_at: null }, activities: [{ kind: 'call', actor: '[Staff Name]', created_at: ago(30), body: '[Call note]' }, { kind: 'note', actor: '[Staff Name]', created_at: ago(300), body: '[Earlier note]' }] });

const crewHandlers = {
  crm_me: () => crewMe,
  crm_queue: (a, ui) => (a.p_view === 'unassigned' ? queue.slice(0, 1).map((l) => ({ ...l, crm_owner: null, owner_name: null })) : (ui && ui.extra ? queue.concat(extraLeads) : queue)),
  crm_call_queue: () => callRows,
  crm_my_leads: () => leadRows,
  crm_leads_list: () => leadRows,
  crm_leads_summary: () => ({ all: 64, new: 12, followups: 7, converted: 18, won: 14, lost: 12, junk: 3, unassigned: 4, pct: { converted: 28, won: 22, lost: 19, followups: 11 }, by_vehicle: { bike: { leads: 50, converted: 15 }, car: { leads: 10, converted: 3 }, parts: { leads: 4, converted: 0 } } }),
  crm_dashboard: () => dashboard,
  crm_rating_summary: () => ({ count: 6, avg: 4.5, low: 0 }),
  crm_followup_capacity: () => ({ overdue: 3, today: 5, upcoming: 9, none: 1, contacts: 41, agents: [] }),
  crm_on_duty: () => ({ on: ['[Care Buddy 1]', '[Care Buddy 2]'], off: [] }),
  crm_conversion_rows: () => convRows,
  crm_quote_counts: () => ({ quotes_sent: 8, approved: 5, declined: 1, work_started: 4, delivered: 3 }),
  crm_dispatch_list: () => dispatch,
  crm_tech_seen: () => ({ 'lead-6': { seen: true, age_s: 140, lat: 12.9, lng: 77.6 } }),
  crm_open_issues: (a) => issues.filter((i) => a.p_status === 'all' || i.status === a.p_status),
  crm_replies_waiting: () => [{ id: 'lead-2', name: '[Customer Name 2]', wrote_at: ago(8) }],
  crm_dispositions_list: () => [{ disposition: 'Interested', sub_disposition: 'Call later' }],
  crm_users_list: () => [{ user_id: 'u1', name: '[Care Buddy 1]', active: true }, { user_id: 'u2', name: '[Care Buddy 2]', active: true }],
  crm_unstaffed_jobs: () => [],
  crm_tech_board: () => ({ techs: [{ name: '[Mechanic Name]', area: 'HSR Layout', jobs: [{ id: 'lead-6', booking_id: 'MP-2611-0006', slot: 'afternoon', area: 'HSR Layout', status: 'paid' }] }, { name: '[Mechanic Name 2]', area: 'Whitefield', jobs: [] }], unassigned: [{ id: 'lead-5', booking_id: 'MP-2611-0005', slot: 'morning', area: 'Indiranagar', status: 'paid' }] }),
  crm_mechanic_picker: () => [{ id: 'mech-1', name: '[Mechanic Name]', area: 'HSR Layout' }, { id: 'mech-2', name: '[Mechanic Name 2]', area: 'Whitefield' }],
  crm_paid_badges: (a) => Object.fromEntries((a.p_ids || []).filter((id) => id === 'lead-5').map((id) => [id, { fee: 49, paid: true, stage: null, quote: null, review: false }])),
  crm_lead: (a) => fullLead(queue.concat(extraLeads).find((l) => l.id === a.p_id) || queue[4]),
  crm_lead_rating: () => null, crm_lead_money: () => null, crm_handovers: () => null, crm_wa_links: () => null,
  crm_chat: () => ({ messages: [{ direction: 'in', sender: 'customer', body: '[Customer message]', created_at: ago(20) }, { direction: 'out', sender: 'agent', body: '[Reply from the desk]', created_at: ago(10) }], last_customer_msg_at: ago(20), window_open: true, opted_out: false }),
  crm_confirmation: (a) => (a.p_lead === 'lead-5' || a.p_lead === 'lead-4' ? { fee: a.p_lead === 'lead-5' ? 49 : 99, paid: a.p_lead === 'lead-5', paid_at: ago(100), stage: a.p_lead === 'lead-5' ? 'started' : null, door: a.p_lead === 'lead-5' ? 'open' : 'none', review: false, link_sent_at: ago(50), nudge_minutes: 15, quote: null } : null),
  crm_notifications: () => [{ kind: 'confirmation', status: 'sent', at: ago(90) }, { kind: 'mechanic_job', status: 'failed', at: ago(80), error: 'Template not approved' }, { kind: 'reminder', status: 'skipped', at: ago(60) }],
  crm_quote_get: (a) => (a && (a.p_lead === 'lead-4' || a.p_lead === 'lead-5') ? { ref: 'L-DEMO4', booking_id: 'MP-26-27-0042', versions: [{ version: 1, quote_no: 'Q-MP-26-27-0042-1', status: 'sent' }], latest: { version: 1, quote_no: 'Q-MP-26-27-0042-1', status: 'sent', expired: false, valid_until: new Date(NOW + 2 * 864e5).toISOString(), sent_at: new Date(NOW - 36e5).toISOString(), terms: 'Valid for 3 days. Work starts only after you approve. GST is included in the total.', gst_rate: 18, fee_credit: 49,
    lines: [{ kind: 'parts', name: 'Front brake pad set', amount: 640 }, { kind: 'parts', name: 'Engine oil 1L', amount: 420 }, { kind: 'labour', name: 'Brake service labour', amount: 300 }], subtotal: 1360, gst: 244.8, total: 1604.8, balance: 1555.8, eta_text: 'Ready in about 4 hours' } } : { latest: null, versions: [] }),
  crm_quote_link: () => 'a'.repeat(32),
  funnel_targets: () => ({ claim_minutes: 15, quote_hours: 2, valid_days: 3 }),
  crm_funnel_options: () => ({ sources: ['google', 'instagram', 'website', 'whatsapp'], campaigns: ['brake-service-oct', 'doorstep-launch'], owners: [{ id: 'me-1', name: '[Staff Name]' }, { id: 'u-2', name: '[Care Buddy 1]' }] }),
  crm_funnel: () => ({ money: true, invoiced_total: 41200, targets: { claim_minutes: 15, quote_hours: 2, valid_days: 3 },
    stages: [['lead', 'Lead', 214, null], ['contacted', 'Contacted', 188, 0.3], ['quote_sent', 'Quote sent', 96, 1.4], ['quote_approved', 'Quote approved', 61, 3.2], ['paid', 'Paid and booked', 52, 0.6], ['completed', 'Completed', 44, 27], ['invoiced', 'Invoiced', 41, 6.5]].map(([key, label, n, m]) => ({ key, label, n, median_hours: m })),
    lost: [{ reason: 'Price too high', n: 14 }, { reason: 'No answer (after 3 tries)', n: 9 }, { reason: 'Bought elsewhere', n: 5 }, { reason: 'No reason recorded', n: 3 }], quote_outcomes: { sent: 96, approved: 61, declined: 12, changes: 5, expired: 8 },
    overdue_claim: [{ id: 'lead-1', ref: 'L-DEMO0', vehicle: 'bike', age_min: 42 }, { id: 'lead-2', ref: 'L-DEMO1', vehicle: 'car', age_min: 95 }], overdue_quote: [{ id: 'lead-3', ref: 'L-DEMO2', vehicle: 'bike', age_hours: 3.4 }] }),
  crm_booking_updates: () => ({ details: { landmark: '[Landmark]', reg_no: '[Vehicle Registration No]', kms: 12000 }, photo_count: 0, photos: [], issues: [{ id: 'iss-1', status: 'open', category: 'late', body: '[Customer message]', created_at: ago(45) }] }),
  crm_tech_location: () => ({ seen: false }),
};

// Admin: tables read with sb.from(table).select(...). Rows are filtered by nothing; the stub just returns them.
const adminLeadsBase = queue.concat(callRows.slice(0, 2)).map((l, i) => ({ ...l, id: 'lead-' + (i + 1), ref: 'L-DEMO' + i, bike_id: null, customer_id: 'cust-' + (i + 1), est_total: 1200 + i * 150, paid_amount: l.status === 'paid' ? 49 : null, paid_at: l.status === 'paid' ? ago(100) : null, deleted_at: null, utm: { utm_source: l.utm_source }, preferred_date: '2026-11-06', preferred_slot: 'morning', service_id: 'svc-1', mechanic_id: l.mechanic_id || null, vehicle: 'bike' }));
// Completed bookings for the Invoices page: 21 and 22 are ready to invoice (22 has only a voided invoice), 23 already has one, 24 has an unpaid confirmation fee, 25 has no priced item.
const doneLead = (i, o = {}) => ({ ...lead(i, { status: 'completed', booking_id: 'MP-2611-00' + i, name: 'Demo Customer ' + i }), id: 'lead-' + i, ref: 'L-DONE' + i, bike_id: 'bike-' + i, customer_id: 'cust-' + i, est_total: 899, paid_amount: 899, paid_at: ago(300), completed_at: ago(200 + i), deleted_at: null, preferred_date: '2026-11-04', preferred_slot: 'morning', service_id: 'svc-1', mechanic_id: null, vehicle: 'bike', addons: [], ...o });
const adminLeads = adminLeadsBase.concat([doneLead(21), doneLead(22, { service_id: 'svc-2' }), doneLead(23), doneLead(24, { confirm_fee: 49, confirm_paid_at: null, booking_id: null }), doneLead(25, { service_id: null })]);
// Dense data for the Admin density shots (placeholders only): 70 more bookings across every Today-board column, paid and unpaid, assigned and not; 90 more customers with
// blank names and duplicate phones (one shared number written as +91 with spaces, one with a leading 0).
const istToday = new Date(NOW + 330 * 60e3).toISOString().slice(0, 10);
const BULK_KINDS = ['new', 'contacted', 'quoted', 'payment_sent', 'paid', 'scheduled', 'completed'];
const bulkLeads = Array.from({ length: 70 }, (_, k) => {
  const i = 100 + k, st = BULK_KINDS[k % BULK_KINDS.length], paid = st === 'paid' || st === 'scheduled' || st === 'completed';
  return { ...lead(i, { status: st }), id: 'lead-' + i, ref: 'L-BULK' + i, booking_id: 'MP-2611-0' + i, bike_id: null, customer_id: k % 9 === 8 ? null : 'cust-' + i, phone: k % 9 === 8 ? '+91 ' + ph(i).slice(0, 5) + ' ' + ph(i).slice(5) : ph(i),
    name: k % 13 === 12 ? '' : '[Customer Name ' + i + ']', created_at: ago(st === 'new' ? 90 + k : 600 + k * 20), updated_at: ago(300 + k), completed_at: st === 'completed' ? ago(120 + k) : null, est_total: 599 + (k % 5) * 150,
    paid_amount: paid ? (st === 'completed' ? 599 + (k % 5) * 150 : 49) : null, paid_at: paid ? ago(200) : null, confirm_fee: paid ? 49 : null, confirm_paid_at: paid ? ago(200) : null, deleted_at: null, utm: { utm_source: 'google' },
    preferred_date: st === 'paid' || st === 'scheduled' ? (k % 2 ? istToday : '2026-11-09') : istToday, preferred_slot: ['morning', 'afternoon', 'evening', 'asap'][k % 4], service_id: k % 2 ? 'svc-2' : 'svc-1', mechanic_id: st === 'scheduled' || (st === 'paid' && k % 3 === 0) ? 'mech-1' : null, vehicle: 'bike' };
});
const bulkCustomers = Array.from({ length: 90 }, (_, k) => { const i = 100 + k; return { id: 'cust-' + i, name: k % 7 === 6 ? '' : '[Customer Name ' + i + ']', phone: k % 11 === 10 ? (k % 22 === 10 ? ph(i - 1) : '0' + ph(i - 1)) : ph(i), email: null, created_at: ago(900 + k * 30) }; });
const bulkBikes = bulkCustomers.filter((_, k) => k % 3 !== 2).map((c, k) => ({ id: 'bike-' + c.id, customer_id: c.id, brand: ['Honda', 'TVS', 'Royal Enfield'][k % 3], model: ['Activa', 'Jupiter', 'Classic 350'][k % 3], reg_no: 'KA01AB' + (1000 + k), engine_class: null, big_bike: false }));
const doneInvoice = (leadId, no, o = {}) => ({ id: 'inv-' + leadId, lead_id: leadId, ref: 'L-' + leadId, number: no, revision: 1, doc_key: 'A', issued_at: ago(150), via: 'print', customer_name: 'Demo Customer', customer_phone: '9000000023', vehicle_reg: 'KA01AB0023', has_gst: true, gst_rate: 18, basis: 'excl', taxable: 499, cgst: 44.91, sgst: 44.91, discount: 0, total: 588.82, paid: 588.82, balance: 0, mechanic_id: null, mechanic_name: null, mechanic_rate: 0, mechanic_cut: 0, company_share: 588.82, payable_now: 0, voided_at: null, lines: [{ name: 'Basic service', amount: 499 }], ...o });
const adminTables = {
  admins: [{ user_id: 'me-1', name: '[Staff Name]', role: 'owner' }],
  leads: adminLeads,
  services: [{ id: 'svc-1', name: 'Basic service', price: 499, sort: 1, active: true, kind: 'service' }, { id: 'svc-2', name: 'Full service', price: 899, sort: 2, active: true, kind: 'service' }],
  settings: [], customers: [{ id: 'cust-1', name: '[Customer Name 1]', phone: ph(1), email: null, created_at: ago(900) }], bikes: [21, 22, 23, 24, 25].map((i) => ({ id: 'bike-' + i, customer_id: 'cust-' + i, brand: 'Honda', model: 'Activa', reg_no: 'KA01AB00' + i, engine_class: null, big_bike: false })), mechanics: [{ id: 'mech-1', name: '[Mechanic Name]', area: 'HSR Layout', phone: ph(91), active: true, onboarding_status: 'live', created_at: ago(5000) }],
  coupons: [], home_images: [], issues: [{ id: 'iss-1', kind: 'issue', status: 'open', title: '[Issue title]', created_at: ago(120), lead_id: 'lead-2' }], service_pincodes: [{ pin: '560038', name: 'Indiranagar', active: true }],
  waitlist: [], invoices: [doneInvoice('lead-23', 'MP-2611-0023'), doneInvoice('lead-22', 'MP-2611-0022', { id: 'inv-void-22', voided_at: ago(100) })], invoice_numbers: [{ lead_id: 'lead-23', number: 'MP-2611-0023' }], invoice_items: [],
  ledger_entries: [{ id: 'le-1', lead_id: 'lead-5', kind: 'payment', amount: 49, created_at: ago(100), by: 'customer', note: null }, { id: 'le-2', lead_id: 'lead-5', kind: 'payment', amount: 800, created_at: ago(50), by: 'mechanic', note: null }],
  messages: [], audit_log: [], email_log: [],
};
adminTables.dense = { leads: adminLeads.concat(bulkLeads), customers: adminTables.customers.concat(bulkCustomers), bikes: adminTables.bikes.concat(bulkBikes) };   // used by the 'dense' scenario in the stub
const adminRpc = {
  crm_dispatch_list: crewHandlers.crm_dispatch_list, crm_tech_seen: crewHandlers.crm_tech_seen, crm_open_issues: crewHandlers.crm_open_issues, crm_mechanic_picker: crewHandlers.crm_mechanic_picker,
  crm_paid_badges: crewHandlers.crm_paid_badges, crm_confirmation: crewHandlers.crm_confirmation, crm_notifications: crewHandlers.crm_notifications, crm_quote_get: crewHandlers.crm_quote_get, crm_booking_updates: crewHandlers.crm_booking_updates, crm_tech_location: crewHandlers.crm_tech_location,
};


// Partner garage app (garage-desk): placeholders only. No customer phone, address or email appears in any of these rows.
const gAccess = [{ id: 'acc-1', garage_id: 'g-1', garage: '[Garage Name]', label: 'Owner', active: true, revoked_at: null, locked_until: null, last_login_at: ago(120), created_at: ago(9000) }];
const gAssign = [{ id: 'as-1', lead_id: 'lead-6', booking_id: 'MP-2611-0006', garage_id: 'g-1', garage: '[Garage Name]', status: 'ready', eta: ahead(300), notes: '[Work needed]', assigned_at: ago(600), progress: [{ event: 'ready', at: ago(30), photos: [], note: null }], settlement: null }];
const gEstimates = [{ id: 'es-1', assignment_id: 'as-1', lead_id: 'lead-6', booking_id: 'MP-2611-0006', garage: '[Garage Name]', status: 'submitted', lines: [{ kind: 'parts', name: '[Part]', amount: 800 }, { kind: 'labour', name: '[Labour]', amount: 400 }], notes: null, hours: 6, return_day: null, subtotal: 1200, gst: 216, submitted_at: ago(40), reviewed_at: null, review_note: null, converted_quote_id: null }];
Object.assign(crewHandlers, {
  crm_garage_access_list: () => gAccess, crm_garage_assignments_list: (a) => (a.p_lead ? gAssign.filter((x) => x.lead_id === a.p_lead) : gAssign), crm_garage_estimates_inbox: (a) => gEstimates.filter((e) => !a.p_status || e.status === a.p_status),
});
Object.assign(adminRpc, { crm_garage_picker: () => [{ id: 'g-1', name: '[Garage Name]', code: 'G-0001', pincode: '560102', status: 'live' }], crm_garage_access_list: crewHandlers.crm_garage_access_list, crm_garage_assignments_list: crewHandlers.crm_garage_assignments_list, crm_garage_estimates_inbox: crewHandlers.crm_garage_estimates_inbox });

// ---- Click-through harness additions (personas, extra leads, write results, Edge Function replies). Placeholders only. ----
const PERSONA = (o) => ({ ...crewMe, ...o });
const personas = {
  owner: crewMe,
  agent: PERSONA({ name: '[Agent Name]', role: 'sales', designation: 'sales', is_admin: false, permissions: { pages: { dashboard: 1, inbox: 1, leads: 1, tickets: 1, knowledge: 1 }, actions: { take_leads: 1, add_leads: 1, edit_leads: 1, create_bookings: 1, create_tickets: 1, send_payment_link: 1, close_chats: 1 } } }),
  techlead: PERSONA({ name: '[Technician Lead]', role: 'sales', designation: 'tech_lead', is_admin: false, permissions: { pages: { dashboard: 1, leads: 1, mechanics: 1, garages: 1 }, actions: { view_all_leads: 1, edit_leads: 1, manage_mechanics: 1, manage_technicians: 1 } } }),
};
const extraLeads = [
  lead(8, { status: 'junk', junk_reason: '[spam]', crm_owner: 'me-1' }),
  lead(9, { status: 'scheduled', booking_id: 'MP-2611-0009', confirm_fee: 49, confirm_paid_at: ago(300), mechanic_name: '[Mechanic Name]', mechanic_id: 'mech-1', mechanic_phone: ph(91), crm_first_contact_at: ago(400) }),
  lead(10, { status: 'completed', booking_id: 'MP-2611-0010', confirm_fee: 49, confirm_paid_at: ago(900), mechanic_name: '[Mechanic Name]', mechanic_id: 'mech-1', mechanic_phone: ph(91), crm_first_contact_at: ago(1000) }),
  lead(15, { status: 'new', crm_owner: null, owner_name: null }),
];
const ok = (v) => () => v;
const bookingCatalog = { tiers: { mid: {}, big: {} }, services: [{ id: 'svc-1', name: 'Basic service', price: 499, vehicle: 'bike', kind: 'service' }], addons: [], coupons: [], areas: [{ pin: '560038', name: 'Indiranagar' }], mechanics: [] };

const writeResults = {
  crm_claim: ok(null), crm_assign: ok(null), crm_log: ok(null), crm_set_outcome: ok(null), crm_mark_done: ok(null), confirm_booking: ok('MP-2611-0099'), mark_lead_junk: ok(null), restore_lead_junk: ok('contacted'), set_lead_vehicle: (a) => a.p_vehicle,
  crm_confirm_booking: ok({ ok: true, already: false, mechanic_name: '[Mechanic Name]' }), crm_assign_technician: ok({ ok: true, changed: true, mechanic_name: '[Mechanic Name]' }),
  crm_add_lead: ok({ id: 'lead-1', duplicate: false }), crm_import_leads: ok({ created: 1, duplicates: 0, invalid: 0 }), crm_handover_code: ok({ code: '123456' }), crm_tech_link: ok('https://example.invalid/job/abc'), crm_door_code: ok('123456'),
  crm_visit_mark: ok({ ok: true }), crm_issue_resolve: ok(null), crm_quote_save: ok({ ok: true }), crm_quote_phone_approve: ok({ ok: true }),
  crm_create_booking: ok({ id: 'lead-1' }), crm_update_booking: ok({ ok: true }), crm_booking_catalog: ok(bookingCatalog), crm_garage_picker: ok([{ id: 'g-1', name: '[Garage Name]', area: 'HSR Layout' }]), crm_log_export: ok([]), crm_set_user_active: ok(null), crm_set_permissions: ok(null), crm_reset_permissions: ok(null), crm_set_targets: ok(null),
  crm_mechanic_save: ok({ id: 'mech-1' }), crm_mechanic_set_status: ok(null), crm_garage_save: ok({ id: 'g-1' }), crm_garage_set_status: ok(null), crm_garage_set_availability: ok(null), crm_garage_ops_set: ok(null), crm_garage_bank_set: ok(null), crm_garage_import: ok({ created: 0 }),
  crm_garage_access_create: ok({ access_id: 'acc-2', garage: '[Garage Name]', link: 'https://example.invalid/garage/?g=PLACEHOLDER' }), crm_garage_link_new: ok({ link: 'https://example.invalid/garage/?g=PLACEHOLDER' }), crm_garage_pin_reset: ok({ ok: true }), crm_garage_revoke: ok({ ok: true, active: false }), crm_garage_enable: ok({ ok: true, active: true }),
  crm_garage_assign: ok({ assignment_id: 'as-2', status: 'sent', garage: '[Garage Name]' }), crm_garage_estimate_review: ok({ ok: true, status: 'converted', quote: { version: 1 } }), crm_garage_settlement_set: ok({ ok: true }),
  crm_rsa_create: ok({ id: 'rsa-1' }), crm_rsa_update: ok(null), crm_ticket_create: ok({ id: 't-1', code: 'T-0001', legal: false }), crm_ticket_set: ok(null), crm_ticket_note: ok(null), crm_visit_schedule: ok(null), crm_visit_update: ok(null), crm_visit_complete: ok(null),
  crm_playbook_save: ok({ id: 'p-1' }), crm_playbook_publish: ok(null), crm_playbook_flag: ok(null), crm_fitment_save: ok(null), crm_sop_save: ok(null), crm_delete_leads: ok(null), crm_assign_many: ok(null), crm_roster_set: ok(null), crm_automation_set: ok(null),
};
const functionReply = (fn, body) => {
  if (fn === 'desk-chat-sync') return { ok: false };
  if (fn === 'desk-payment-link' || fn === 'payment-link') return { ok: true, url: 'https://example.invalid/pay/abc', amount: 49, suggested: 49, whatsapp_sent: false, whatsapp_note: 'not_connected', whatsapp_text: 'Hi, pay here https://example.invalid/pay/abc', has_email: true, review: false, nudge_minutes: 15 };
  if (fn === 'booking-notify') return { ok: true, result: 'sent', version: 2, changed: true };
  if (fn === 'desk-reply' || fn === 'desk-template') return { ok: true };
  if (fn === 'confirm-booking') return { ok: true };
  return { ok: true };
};

export const fixtures = { personas, extraLeads, writeResults, functionReply,  crewHandlers, adminTables, adminRpc, crewMe };
