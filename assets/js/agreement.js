// Printable partner agreement (Bronze, Silver, Gold), filled from the garage record. The commercial terms are the client's signed-off text, wording only tidied.
// Never includes Aadhaar, PAN or bank details: those stay on the Platform. Opened in its own window; "Print or save as PDF" produces the signed copy.
const esc = (x) => String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const TIERS = { bronze: { name: 'Bronze', code: 'BR' }, silver: { name: 'Silver', code: 'SL' }, gold: { name: 'Gold', code: 'GD' } };
const inr = (n) => 'Rs ' + Number(n).toLocaleString('en-IN');
const dmy = (d) => d.toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric' });

export const PART_A = [
  ['Parties and status', 'NOVA VENTURES, brand Mechanix Pro (the Company), and the garage named in the tier terms (the Garage). The Garage is an independent business, not an employee, agent or partner of the Company. The Garage pays its own staff, taxes and dues. The Company introduces Jobs through its Platform (website, Crew and Admin desks, garage and mechanic apps) and acts as a service aggregator.'],
  ['Onboarding', 'Before the first Job the Garage uploads: owner’s Aadhaar and PAN, garage photos, any shop or trade licence, and this signed Agreement. The Company may approve or reject any application without giving a reason. A false or forged document means immediate termination and, where the law requires, a report to the authorities. The Garage keeps its registrations and insurance valid and informs the Company within 7 days of any change. The Garage does not submit KYC or documents for its mechanics. The Garage alone is fully responsible for every mechanic and worker it uses, including their conduct, work, safety and pay, and for any loss, damage, theft or claim they cause. Any such amount is the Garage’s liability under clause 13.'],
  ['App access', 'The Garage keeps its app link and PIN private and is responsible for all use of them. A Job not accepted or declined within 15 minutes may be reassigned, without penalty.'],
  ['Quote first', 'No chargeable work starts until the customer approves an itemised quote on the Platform. Extra work needs a revised quote and fresh approval. The Garage never charges for unapproved work. Parts must be genuine or equivalent quality, as stated in the quote. Never fit a used part and charge for a new one.'],
  ['Code and photos', 'The Garage enters the customer’s one-time handover code in the app before starting work. Five wrong tries lock the code, and the Garage must call the Company. The Garage takes clear photos at pickup (all sides, odometer, existing damage), at arrival at the garage, when work is complete (including replaced parts) and at delivery. The Garage sets an estimated completion date when the vehicle arrives. All photos and records belong to the Company’s Job record and may be used to settle disputes.'],
  ['Standards', 'The Garage works with reasonable skill and care, with trained people and a safe workshop. It follows the Motor Vehicles Act 1988, does not road-test without a licensed driver, and does not use child labour. It follows fire, safety, labour and environmental laws, and there is no bribery, harassment or pressure to buy extra work.'],
  ['Warranty', 'Normal service work is warranted for 30 days or 500 km, whichever comes first. Engine repair work is warranted for 6 months. Defects in either are redone free of charge within 3 working days of notice. Accident, misuse, neglect and third-party work are excluded.'],
  ['Custody', 'From pickup until delivery the vehicle is the Garage’s responsibility. The Garage is liable for loss, theft or damage to the vehicle and its accessories up to its declared value, unless caused by something outside its control that it could not reasonably have prevented. The pickup, arrival, ready and delivery photos are the main evidence. The vehicle must be kept locked and safe overnight and must not be lent, sold or used for anything other than the Job. The Garage should carry garage keeper’s liability insurance.'],
  ['Payments', 'The Company collects the customer’s payment and issues the final bill. The customer’s confirmation fee (Rs 49, Rs 69 or Rs 99, including GST) is adjusted in the final bill. Commission is calculated only on the bill’s base price, excluding GST. All GST collected from the customer goes directly to the Company, which files and pays it. The Garage cannot claim any GST, input credit or GST invoice for Jobs, and cannot ask the Company to file GST for it. Any cash or UPI collected directly by the Garage is recorded in the app, and the Company’s share is paid to the Company within 24 hours of collection. Taking payment outside the Platform to avoid the Company’s share is a ground for immediate termination.'],
  ['Payout', 'The Company pays the Garage by bank transfer to the verified account one day after Razorpay settles the customer’s payment to the Company (settlement date plus 1 day), for Jobs that are delivered, paid, photo-complete and undisputed. Razorpay’s settlement timing applies. The payout is the bill’s base price less commission and any deductions; GST is never payable to the Garage. If that day is a bank holiday, the payout is made on the next working day.'],
  ['Deductions and holds', 'The Company may deduct from payouts the commission, refunds paid because of the Garage’s work, chargebacks, reversed payments and penalties. Penalties: no-show after accepting {{pen_noshow}}; cancelling after accepting without valid reason {{pen_cancel}}; estimated date not set within 4 hours of arrival {{pen_date}}. Penalties are capped at {{pen_cap}}% of any one payout. For a disputed Job the Company may hold up to 10% of that Job’s payout for up to 30 days.'],
  ['Customer data', 'The Garage uses customer details only for the open Job assigned to it. It does not contact the customer outside the Job, advertise to them, take them to another platform or share their details. It follows the Digital Personal Data Protection Act 2023, reports any leak to the Company within 72 hours, and deletes customer data when the Job ends unless the law requires otherwise. The Company uses the Garage’s identity documents only for verification and compliance and deletes them after exit, except what the law requires it to keep.'],
  ['Indemnity and liability', 'The Garage compensates the Company for losses, claims and costs caused by its negligence, breach of this Agreement or the law, or the acts of its staff and mechanics. The Company’s total liability to the Garage is limited to payouts due and unpaid. Neither side is liable for indirect or consequential loss.'],
  ['Quality suspension', 'The Company may pause the Garage’s access for repeated complaints, poor ratings, missing photos or dates, no-shows, unsafe work or breach, and will give the reason. Access is restored once the problem is fixed.'],
  ['Immediate termination', 'The Company may terminate immediately for fraud, forged documents, theft or damage of a vehicle, risk to a customer, payments taken outside the Platform, misuse of customer data, or loss of a required licence. On termination the Garage completes Jobs in progress and returns all vehicles, and the Company pays what is due.'],
  ['Confidentiality and non-solicit', 'Commission rates, customer data and the Platform’s workings are confidential during the Agreement and for 3 years after. For 12 months after exit the Garage will not solicit or serve, outside the Platform, any customer it first met through the Platform in a way that avoids the Company’s share. Ordinary walk-in business is not restricted.'],
  ['Law and disputes', 'Indian law governs. Disputes are discussed for 15 days, then go to arbitration under the Arbitration and Conciliation Act 1996 before a sole arbitrator, seated in Bengaluru, in English. The courts at Bengaluru have exclusive jurisdiction for anything arbitration cannot decide.'],
  ['General', 'This Part A, the tier terms and the app terms are the whole agreement. Changes must be in writing, except that the Company may update the app terms on 30 days’ notice. The Garage may not transfer its rights or sub-contract the work without the Company’s written consent. Neither side is liable for delay caused by events outside its control, which does not excuse payment obligations. Notices are given by email or in the app. A signed scan is valid. This Agreement is executed on stamp paper of proper value under the Karnataka Stamp Act, and the Company bears the stamp duty.'],
];

const TERM = 'The deposit term is 3 months from activation and renews for further 3-month terms unless either side gives 15 days’ written notice before it ends. Each renewal keeps the same deposit, which need not be paid again. This Agreement lasts 12 months from signing and does not renew automatically: a new agreement is prepared and signed every year, and the deposit is non-refundable and carries over to it only if the new agreement says so. Either side may exit on 30 days’ written notice.';
const BAND = (tail) => `The Company will use reasonable efforts to route {{min}} to {{max}} orders a month to the Garage, ${tail}`;
export const PART_B = {
  bronze: [
    ['Tier', 'Bronze: no deposit, commission-based only.'],
    ['Commission', 'The Company sets the Garage’s commission rate in the Admin panel according to the Garage’s system profile (location, capacity, rating and service type). The rate shown in the Garage’s profile and Settlement Statement at onboarding is the agreed rate. The Company may change it on 30 days’ notice in the app. If the Garage does not accept the new rate, it may exit on 30 days’ notice. Commission applies to the overall bill base price (labour, service and parts), excluding GST.'],
    ['Jobs', 'The Company promises no minimum number of Jobs. The Garage need not accept every Job.'],
    ['Deposit', 'None.'],
    ['Term', '12 months from signing. It does not renew automatically: a new agreement is prepared and signed every year, and the Garage’s access ends on expiry if the new agreement is not signed. Either side may exit on 30 days’ written notice. Upgrade to Silver or Gold is possible by signing that tier’s agreement.'],
    ['Agreed rate at signing', '{{rate}} %'],
  ],
  silver: [
    ['Tier', 'Silver: non-refundable deposit, fixed commission, volume band of {{min}} to {{max}} orders per month.'],
    ['Deposit', 'The Garage pays {{deposit}} to the Company before activation, by bank transfer, and receives a receipt. The deposit covers 3 months (the Silver Term). It is non-refundable and earns no interest.'],
    ['Commission', '{{rate}}% of the overall bill base price (labour, service and parts), excluding GST. Parts are charged at cost with a Garage margin capped at 10%, itemised in the quote. Commission is deducted from each payout and summarised in a monthly statement.'],
    ['Order band', BAND('subject to customer demand, location and the Garage’s ratings. This is a target band, not a guarantee. The Garage confirms it has capacity for up to {{max}} orders a month and will accept at least {{accept}}% of the Jobs assigned to it. If it falls below that, or its quality is poor for two consecutive months, the Company may move it to Bronze, with no refund of the deposit.')],
    ['No refund', 'The deposit is non-refundable. The Company keeps it on expiry of the term, exit by either side, termination, or a move to Bronze.'],
    ['Term', TERM],
  ],
  gold: [
    ['Tier', 'Gold: higher non-refundable deposit, lower commission, volume band of {{min}} to {{max}} orders per month, priority allocation.'],
    ['Deposit', 'The Garage pays {{deposit}} to the Company before activation, by bank transfer, and receives a receipt. The deposit covers 3 months (the Gold Term). It is non-refundable and earns no interest.'],
    ['Commission', '{{rate}}% of the overall bill base price (labour, service and parts), excluding GST. Parts are charged at cost with a Garage margin capped at 10%, itemised in the quote. Commission is deducted from each payout and summarised in a monthly statement.'],
    ['Order band and priority', BAND('with priority over Bronze and Silver garages in the same area when ratings and availability allow. This is a target band, not a guarantee. The Garage confirms it has capacity for up to {{max}} orders a month and will accept at least {{accept}}% of the Jobs assigned to it. If it falls below that, or its quality is poor for two consecutive months, the Company may move it to Silver or Bronze, with no refund of any part of the deposit.')],
    ['No refund', 'The deposit is non-refundable. The Company keeps it on expiry of the term, exit by either side, termination, or a move to Silver or Bronze.'],
    ['Term', TERM],
  ],
};
export const DEFAULT_VARS = { pen_noshow: 300, pen_cancel: 200, pen_date: 100, pen_cap: 10, accept_silver: 70, accept_gold: 80 };
export const TOKENS = ['rate', 'deposit', 'min', 'max', 'accept', 'pen_noshow', 'pen_cancel', 'pen_date', 'pen_cap'];

/** The terms to print: the client's saved document if there is one, else the built-in text. Clauses are { title, text }. */
export function resolveTerms(doc) {
  const cl = (rows) => rows.map((r) => (Array.isArray(r) ? { title: r[0], text: r[1] } : { title: String(r.title || ''), text: String(r.text || '') }));
  const d = doc && typeof doc === 'object' ? doc : {};
  const ok = (a) => Array.isArray(a) && a.length > 0;
  return { part_a: cl(ok(d.part_a) ? d.part_a : PART_A), part_b: { bronze: cl(ok(d.part_b?.bronze) ? d.part_b.bronze : PART_B.bronze), silver: cl(ok(d.part_b?.silver) ? d.part_b.silver : PART_B.silver), gold: cl(ok(d.part_b?.gold) ? d.part_b.gold : PART_B.gold) }, vars: { ...DEFAULT_VARS, ...(d.vars || {}) } };
}
const fill = (text, ctx) => String(text).replace(/\{\{([a-z_]+)\}\}/g, (m, k) => (ctx[k] ?? ''));
export const unknownTokens = (text) => [...String(text).matchAll(/\{\{([a-z_]+)\}\}/g)].map((m) => m[1]).filter((k) => !TOKENS.includes(k));

const CSS = `*{box-sizing:border-box}body{font:11.5px/1.45 Arial,Helvetica,sans-serif;color:#111;margin:0;background:#eef0f4}.bar{position:sticky;top:0;background:#12294f;color:#fff;padding:10px 16px;display:flex;gap:12px;align-items:center}.bar button{background:#f26a1b;color:#fff;border:0;border-radius:6px;padding:8px 14px;font-weight:700;cursor:pointer}
.pg{width:210mm;margin:12px auto;background:#fff;padding:12mm 14mm 16mm;box-shadow:0 1px 6px rgba(0,0,0,.15)}.hd{text-align:center;border-bottom:3px solid #f26a1b;padding-bottom:8px;margin-bottom:10px}.hd img{height:84px;width:auto;max-width:100%}.hd .t{font-size:16px;font-weight:700;color:#12294f;margin-top:6px;letter-spacing:.02em}
h2{font-size:13px;color:#12294f;margin:10px 0 4px}p{margin:0 0 5px;text-align:justify}.meta{text-align:center;margin:0 0 8px}.v{border-bottom:1px solid #777;padding:0 3px;font-weight:700}table{width:100%;border-collapse:collapse;margin:6px 0}td,th{border:1px solid #12294f;padding:6px 8px;vertical-align:top;text-align:left}th{background:#eaf0fb;text-align:center}
.ft{margin-top:10px;border-top:2px solid #12294f;padding-top:5px;text-align:center;color:#12294f;font-size:10.5px}.sm{font-size:10.5px}@media print{body{background:#fff}.bar{display:none}.pg{margin:0;box-shadow:none;width:auto;padding:0}.brk{page-break-before:always}@page{size:A4;margin:12mm}}`;

/** d: { tier, garage, terms (the saved document or null), plan: {commission_pct, deposit_amount, orders_min, orders_max}, rate, signer: {name, designation}, now: Date } → one complete HTML document. */
/** The agreement as data: header facts and the numbered clauses with the numbers filled in. Used by the printable page and by the partner's sign screen (which builds it with textContent, no HTML). */
export function agreementParts(d) {
  const tier = TIERS[d.tier] ? d.tier : 'bronze', T = TIERS[tier], g = d.garage || {}, pl = d.plan || {}, now = d.now || new Date();
  const rate = d.rate ?? pl.commission_pct ?? '';
  const terms = resolveTerms(d.terms), V = terms.vars;
  const ctx = { rate, deposit: pl.deposit_amount != null ? inr(pl.deposit_amount) : '', min: pl.orders_min ?? '', max: pl.orders_max ?? '', accept: tier === 'gold' ? V.accept_gold : V.accept_silver, pen_noshow: inr(V.pen_noshow), pen_cancel: inr(V.pen_cancel), pen_date: inr(V.pen_date), pen_cap: V.pen_cap };
  const mk = (rows) => rows.map((c, i) => ({ n: i + 1, title: fill(c.title, ctx), text: fill(c.text, ctx) }));
  return { tier, tierName: T.name, no: `MXP-${T.code}-${g.code || ''}`, date: dmy(now), garageName: g.legal_name || g.name || '', owner: g.owner_name || '', addr: [g.address, g.landmark, g.pincode, g.city].filter(Boolean).join(', '), A: mk(terms.part_a), B: mk(terms.part_b[tier]), rate };
}

/** d: { tier, garage, terms, plan, rate, signer, now, esign: { name, at } | null, bar: false hides the print bar } → one complete HTML document. */
export function agreementHtml(d) {
  const P = agreementParts(d), tier = P.tier, T = TIERS[tier], g = d.garage || {}, pl = d.plan || {}, now = d.now || new Date(), no = P.no, addr = P.addr;
  const v = (x, w = 160) => `<span class="v" style="display:inline-block;min-width:${w}px">${esc(x || '')}&nbsp;</span>`;
  const held = g.deposit_status === 'held';
  const A = P.A.map((c) => `<p><b>${c.n}. ${esc(c.title)}.</b> ${esc(c.text)}</p>`).join('');
  const B = P.B.map((c) => `<p><b>${c.n}. ${esc(c.title)}.</b> ${esc(c.text)}</p>`).join('');
  const es = d.esign && d.esign.name ? `Signed online by <b>${esc(d.esign.name)}</b> on ${esc(d.esign.at ? new Date(d.esign.at).toLocaleString('en-GB', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }) : '')} IST` : '';
  const row = (a, b) => `<tr><td>${a}</td><td>${b}</td></tr>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(no)} Garage Partner Agreement ${T.name}</title><style>${CSS}</style></head><body>
<div class="bar"><button onclick="print()">Print or save as PDF</button><span>${esc(no)} · ${esc(g.legal_name || g.name || '')}. Check the details, then print. Bank details are entered on the Platform, never on this page.</span></div>
<div class="pg"><div class="hd"><img src="https://mechanixpro.in/assets/img/logo-full.png" alt="Mechanix Pro"><div class="t">GARAGE PARTNER AGREEMENT – ${T.name.toUpperCase()}</div></div>
<p class="meta">NOVA VENTURES (Mechanix Pro), Bengaluru · GSTIN 29DVCPR0895G1Z3<br>Agreement No. ${v(no, 130)} · Date: ${v(dmy(now), 90)} · Place: Bengaluru</p>
<p class="sm"><b>Between</b> NOVA VENTURES (Mechanix Pro) <b>and</b> ${v(g.legal_name || g.name, 200)} (owner: ${v(g.owner_name, 140)}), ${v(addr, 260)}.</p>
<h2>Part A: Standard Terms</h2>${A}
<h2 class="brk">Part B: ${T.name} Partner Terms <span class="sm">(if Part A and Part B conflict, Part B applies)</span></h2>${B}
<h2>Signatures</h2><p>Signed by the parties on the date above.</p>
<table><tr><th>For NOVA VENTURES (Mechanix Pro)</th><th>For the Garage</th></tr>
${row('Name: ' + v(d.signer && d.signer.name, 160), 'Garage name: ' + v(g.legal_name || g.name, 150))}
${row('Designation: ' + v(d.signer && d.signer.designation, 130), 'Owner name: ' + v(g.owner_name, 150))}
${row('Signature:<br><br>', 'Signature:<br>' + (es || '<br>'))}
${row('Date: ' + v(dmy(now), 120), 'Date: ' + v(d.esign && d.esign.at ? dmy(new Date(d.esign.at)) : '', 150))}
${row('Place: Bengaluru', 'Place: ' + v(es ? 'Online' : '', 150))}
${row('Email: ' + v('hello@mechanixpro.in', 160), 'Email: ' + v('', 150))}</table>
<p class="sm"><b>Garage details:</b> Address ${v(addr, 260)} Phone ${v(g.mobile, 90)} GSTIN (if any) ${v(g.gstin, 150)} Shop/trade licence no. (if any) ${v(g.trade_id, 120)}</p>
<p class="sm"><b>Bank account for payouts:</b> to be given in the Platform, not on this page.</p>
${tier === 'bronze' ? '' : `<p class="sm"><b>Deposit received:</b> Rs ${v(held ? Number(pl.deposit_amount).toLocaleString('en-IN') : '', 70)} Date ${v(held && g.deposit_received_at ? dmy(new Date(g.deposit_received_at)) : '', 80)} Ref ${v('', 110)}</p>`}
<p class="sm">Witness 1: Name ${v('', 130)} Signature ${v('', 100)}</p><p class="sm">Witness 2: Name ${v('', 130)} Signature ${v('', 100)}</p>
<p class="sm">Stamp paper details: [value, serial number, date, purchased in the name of] ${v('', 200)}</p>
<div class="ft">+91 83106 21498 &nbsp;|&nbsp; hello@mechanixpro.in &nbsp;|&nbsp; mechanixpro.in</div></div></body></html>`;
}
