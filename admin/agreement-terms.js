// Admin > Garages > Agreement terms: the client edits the partner agreement himself. Clause text for Part A and the Bronze, Silver and Gold Part B,
// the penalty amounts and acceptance rates, and each plan's commission, deposit and order band. Saved terms apply to agreements printed from now on; earlier printed copies are unchanged.
import { esc } from './kyc-rules.js';
import { PART_A, PART_B, DEFAULT_VARS, TOKENS, resolveTerms, unknownTokens } from './agreement.js';

const SECTIONS = [['part_a', 'Part A: standard terms (all plans)'], ['bronze', 'Part B: Bronze'], ['silver', 'Part B: Silver'], ['gold', 'Part B: Gold']];
const PLAN_ROWS = [['bronze', 'Bronze'], ['silver', 'Silver'], ['gold', 'Gold']];
const VAR_ROWS = [['pen_noshow', 'Penalty: no-show after accepting (₹)'], ['pen_cancel', 'Penalty: cancelling after accepting (₹)'], ['pen_date', 'Penalty: estimated date not set within 4 hours (₹)'], ['pen_cap', 'Penalty cap, % of one payout'], ['accept_silver', 'Silver must accept at least, % of jobs'], ['accept_gold', 'Gold must accept at least, % of jobs']];

const clauseRow = (c) => `<div class="at-clause"><input class="at-t" value="${esc(c.title)}" maxlength="120" aria-label="Clause title"><textarea class="at-x" rows="4" maxlength="3000" aria-label="Clause text">${esc(c.text)}</textarea><button type="button" class="btn btn-ghost" data-at-del>Remove clause</button></div>`;
const sectionHtml = (key, label, rows) => `<details class="at-sec" data-sec="${key}"><summary>${esc(label)} (${rows.length} clauses)</summary><div class="at-list">${rows.map(clauseRow).join('')}</div><button type="button" class="btn btn-ghost" data-at-add>Add clause</button></details>`;

/** The form body. Pure, so it can be tested. */
export function termsBody(doc, plans) {
  const t = resolveTerms(doc);
  const secs = SECTIONS.map(([k, l]) => sectionHtml(k, l, k === 'part_a' ? t.part_a : t.part_b[k])).join('');
  const vars = VAR_ROWS.map(([k, l]) => `<label class="flow-f"><span>${esc(l)}</span><input name="v_${k}" inputmode="numeric" maxlength="6" value="${esc(t.vars[k])}"></label>`).join('');
  const pl = PLAN_ROWS.map(([k, l]) => { const p = (plans || []).find((x) => x.plan === k) || {}; const b = k === 'bronze';
    return `<fieldset class="flow-f at-plan" data-plan="${k}"><legend>${l}</legend><label class="flow-f"><span>Commission %</span><input name="c_${k}" inputmode="decimal" maxlength="5" value="${esc(p.commission_pct ?? '')}"></label>${b ? '' : `<label class="flow-f"><span>Deposit ₹</span><input name="d_${k}" inputmode="numeric" maxlength="7" value="${esc(p.deposit_amount ?? '')}"></label><label class="flow-f"><span>Deposit covers (months)</span><input name="m_${k}" inputmode="numeric" maxlength="2" value="${esc(p.deposit_months ?? '')}"></label><label class="flow-f"><span>Orders a month: from</span><input name="lo_${k}" inputmode="numeric" maxlength="5" value="${esc(p.orders_min ?? '')}"></label><label class="flow-f"><span>to</span><input name="hi_${k}" inputmode="numeric" maxlength="5" value="${esc(p.orders_max ?? '')}"></label>`}</fieldset>`; }).join('');
  return `<p class="flow-muted">Changes apply to agreements printed from now on. Copies already printed or signed are not changed. Use these placeholders where the number should come from the plan: ${TOKENS.map((x) => `<code>{{${x}}}</code>`).join(' ')}. Never type Aadhaar, PAN or bank numbers.</p>
    <h4>Plans</h4>${pl}<h4>Penalties and acceptance</h4>${vars}<h4>Clauses</h4>${secs}<label class="flow-f"><span>What you changed (optional)</span><input name="note" maxlength="200"></label>
    <p><button type="button" class="btn btn-ghost" data-at-reset>Go back to the original text</button></p>`;
}

/** Reads the form into { doc, plans, errors }. Pure. */
export function readTerms(f) {
  const errors = [], part = (k) => [...f.querySelectorAll(`[data-sec="${k}"] .at-clause`)].map((r) => ({ title: r.querySelector('.at-t').value.trim(), text: r.querySelector('.at-x').value.trim() })).filter((c) => c.title || c.text);
  const doc = { part_a: part('part_a'), part_b: { bronze: part('bronze'), silver: part('silver'), gold: part('gold') }, vars: {} };
  for (const [k, l] of VAR_ROWS) { const n = Number(f.querySelector(`[name=v_${k}]`).value); if (!Number.isInteger(n) || n < 0) errors.push(`${l}: enter a whole number.`); doc.vars[k] = n; }
  for (const [sec, rows] of [['Part A', doc.part_a], ['Bronze', doc.part_b.bronze], ['Silver', doc.part_b.silver], ['Gold', doc.part_b.gold]]) for (const c of rows) {
    if (c.title.length < 2 || c.text.length < 2) errors.push(`${sec}: every clause needs a title and text.`);
    for (const u of unknownTokens(c.title + ' ' + c.text)) errors.push(`${sec}: {{${u}}} is not a placeholder I know.`);
  }
  const plans = PLAN_ROWS.map(([k]) => { const g = (n) => { const e = f.querySelector(`[name=${n}_${k}]`); return e ? Number(e.value) : null; };
    return { plan: k, commission: g('c'), deposit: g('d'), months: g('m'), min: g('lo'), max: g('hi') }; });
  return { doc, plans, errors: [...new Set(errors)], note: f.querySelector('[name=note]').value };
}

export function createAgreementTerms({ rpc, dialog, toast }) {
  const msg = (e) => String((e && e.message) || e || 'Something went wrong. Try again.');
  async function open() {
    let cur, plans;
    try { [cur, plans] = await Promise.all([rpc('agreement_terms_get'), rpc('partner_plans_list')]); } catch (e) { return toast(msg(e), true); }
    const last = cur.version ? `Version ${cur.version}, saved ${new Date(cur.updated_at).toLocaleDateString('en-GB')}.` : 'Showing the original text. Nothing has been changed yet.';
    dialog({ title: 'Agreement terms', intro: esc(last), body: termsBody(cur.doc, plans), submit: 'Save terms',
      onOpen: (form, d) => {
        form.addEventListener('click', async (ev) => {
          const b = ev.target.closest('button'); if (!b) return;
          if (b.hasAttribute('data-at-add')) { b.previousElementSibling.insertAdjacentHTML('beforeend', clauseRow({ title: '', text: '' })); }
          if (b.hasAttribute('data-at-del')) { b.closest('.at-clause').remove(); }
          if (b.hasAttribute('data-at-reset')) { if (!window.confirm('Go back to the original text? Your edits to the clauses are removed. Plan numbers stay as they are.')) return; try { await rpc('agreement_terms_reset'); toast('Back to the original text.'); d.close(); } catch (e) { toast(msg(e), true); } }
        });
      },
      onSubmit: async (f, d) => {
        const r = readTerms(f); if (r.errors.length) throw new Error(r.errors.slice(0, 3).join(' '));
        for (const p of r.plans) await rpc('partner_plan_values_set', { p_plan: p.plan, p_commission: p.commission, p_deposit: p.deposit ?? 0, p_months: p.months ?? 0, p_min: p.min, p_max: p.max });
        const res = await rpc('agreement_terms_save', { p_doc: r.doc, p_note: r.note || null });
        d.close(); toast(`Agreement terms saved (version ${res && res.version}).`);
      } });
  }
  return { open };
}
