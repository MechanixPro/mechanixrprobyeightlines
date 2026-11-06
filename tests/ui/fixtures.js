// UI harness fixtures. PLACEHOLDERS ONLY: no real customer, phone, email or vehicle data. Phone numbers are obviously synthetic (90000 000NN).
// Used by supabase-stub.js (served in place of the Supabase client) so the real Crew and Admin pages render with no network.
const NOW = Date.now();
const ago = (min) => new Date(NOW - min * 60e3).toISOString();
const ahead = (min) => new Date(NOW + min * 60e3).toISOString();
const ph = (n) => '90000' + String(n).padStart(5, '0');

const PAGES = { dashboard: 1, inbox: 1, leads: 1, rsa: 1, tickets: 1, garage_visits: 1, garages: 1, mechanics: 1, knowledge: 1, team: 1 };
const ACTIONS = { take_leads: 1, assign_leads: 1, edit_leads: 1, view_all_leads: 1, create_bookings: 1, add_leads: 1, send_payment_link: 1, manage_technicians: 1, export: 1, create_tickets: 1, delete_leads: 1 };

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
  crm_quote_get: () => ({ latest: null, versions: [] }),
  crm_booking_updates: () => ({ details: { landmark: '[Landmark]', reg_no: '[Vehicle Registration No]', kms: 12000 }, photo_count: 0, photos: [], issues: [{ id: 'iss-1', status: 'open', category: 'late', body: '[Customer message]', created_at: ago(45) }] }),
  crm_tech_location: () => ({ seen: false }),
};

// Admin: tables read with sb.from(table).select(...). Rows are filtered by nothing; the stub just returns them.
const adminLeads = queue.concat(callRows.slice(0, 2)).map((l, i) => ({ ...l, id: 'lead-' + (i + 1), ref: 'L-DEMO' + i, bike_id: null, customer_id: 'cust-' + (i + 1), est_total: 1200 + i * 150, paid_amount: l.status === 'paid' ? 49 : null, paid_at: l.status === 'paid' ? ago(100) : null, deleted_at: null, utm: { utm_source: l.utm_source }, preferred_date: '2026-11-06', preferred_slot: 'morning', service_id: 'svc-1', mechanic_id: l.mechanic_id || null, vehicle: 'bike' }));
const adminTables = {
  admins: [{ user_id: 'me-1', name: '[Staff Name]', role: 'owner' }],
  leads: adminLeads,
  services: [{ id: 'svc-1', name: 'Basic service', price: 499, sort: 1, active: true }, { id: 'svc-2', name: 'Full service', price: 899, sort: 2, active: true }],
  settings: [], customers: [{ id: 'cust-1', name: '[Customer Name 1]', phone: ph(1), email: null, created_at: ago(900) }], bikes: [], mechanics: [{ id: 'mech-1', name: '[Mechanic Name]', area: 'HSR Layout', phone: ph(91), active: true, onboarding_status: 'live', created_at: ago(5000) }],
  coupons: [], home_images: [], issues: [{ id: 'iss-1', kind: 'issue', status: 'open', title: '[Issue title]', created_at: ago(120), lead_id: 'lead-2' }], service_pincodes: [{ pin: '560038', name: 'Indiranagar', active: true }],
  waitlist: [], invoices: [], invoice_numbers: [], invoice_items: [],
  ledger_entries: [{ id: 'le-1', lead_id: 'lead-5', kind: 'payment', amount: 49, created_at: ago(100), by: 'customer', note: null }, { id: 'le-2', lead_id: 'lead-5', kind: 'payment', amount: 800, created_at: ago(50), by: 'mechanic', note: null }],
  messages: [], audit_log: [], email_log: [],
};
const adminRpc = {
  crm_dispatch_list: crewHandlers.crm_dispatch_list, crm_tech_seen: crewHandlers.crm_tech_seen, crm_open_issues: crewHandlers.crm_open_issues, crm_mechanic_picker: crewHandlers.crm_mechanic_picker,
  crm_paid_badges: crewHandlers.crm_paid_badges, crm_confirmation: crewHandlers.crm_confirmation, crm_notifications: crewHandlers.crm_notifications, crm_quote_get: crewHandlers.crm_quote_get, crm_booking_updates: crewHandlers.crm_booking_updates, crm_tech_location: crewHandlers.crm_tech_location,
};


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
