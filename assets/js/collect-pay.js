/* Collect payment screen, shared by the technician job page (/job/) and the garage app (/garage/).
   Online first: the amount due, a QR code, Send link on WhatsApp. Cash or UPI hides behind "Customer wants to inspect first" and the server decides if it is allowed.
   Only a Razorpay link and amounts are ever held here: no card or bank details. Needs qr.js (MXP_QR) for the QR code. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.MXP_PAY = api;
})(typeof self !== 'undefined' ? self : this, function () {
  var inr = function (n) { return '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 }); };
  /** Cash/UPI is offered only when the vehicle has arrived AND the customer asked to inspect first. Mirror of the server rule (the server enforces it). */
  function cashAvailable(s) { return !!(s && s.arrived === true && s.inspect_first === true); }
  function waText(first, amount, url) { return 'Hi ' + (first || 'there') + ', your Mechanix Pro service is done. Please pay ' + inr(amount) + ' here: ' + url; }
  function waLink(phone, text) { var p = String(phone || '').replace(/\D/g, '').slice(-10); return /^[6-9]\d{9}$/.test(p) ? 'https://wa.me/91' + p + '?text=' + encodeURIComponent(text) : null; }
  function el(doc, tag, attrs, kids) {
    var n = doc.createElement(tag); attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) { var v = attrs[k]; if (v == null || v === false) return; if (k === 'text') n.textContent = v; else if (k.indexOf('on') === 0) n[k] = v; else n.setAttribute(k, v === true ? '' : v); });
    (kids || []).forEach(function (c) { if (c) n.appendChild(typeof c === 'string' ? doc.createTextNode(c) : c); });
    return n;
  }
  /** opts: { doc, win, call(action, body) -> Promise<{ok, data}>, state: {paid, inspect_first, arrived, cash_available, method, amount}, phone, first, poll() -> Promise<state|null>, onChange(state) } */
  function create(opts) {
    var d = opts.doc, w = opts.win || (typeof window !== 'undefined' ? window : null), S = { state: opts.state || {}, view: 'online', link: null, amount: null, err: null, busy: false, sub: null };
    var root = el(d, 'section', { class: 'cp', 'aria-live': 'polite' }), timer = null, gone = false;
    function stop() { gone = true; if (timer) w.clearTimeout(timer); }
    function schedule() {
      if (gone || !opts.poll || S.state.paid) return;
      timer = w.setTimeout(function () {
        if (gone) return;
        if (d.hidden) { schedule(); return; }
        opts.poll().then(function (s) { if (s) { S.state = s; if (s.paid) { paint(); if (opts.onChange) opts.onChange(s); return; } } schedule(); }).catch(schedule);
      }, 10000);
    }
    function request() {
      S.busy = true; S.err = null; paint();
      opts.call('payment_request', {}).then(function (r) {
        S.busy = false;
        if (!r.ok) { S.err = (r.data && r.data.error) || 'Could not make the link. Try again.'; paint(); return; }
        if (r.data.paid) { S.state = Object.assign({}, S.state, { paid: true, method: r.data.method, amount: r.data.amount }); paint(); return; }
        S.link = r.data.url; S.amount = r.data.amount; paint(); schedule();
      });
    }
    function btn(label, cls, fn, id, off) { return el(d, 'button', { type: 'button', class: 'cp-btn ' + cls, id: id, disabled: off, text: label, onclick: fn }); }
    function paint() {
      while (root.firstChild) root.removeChild(root.firstChild);
      var st = S.state, kids = [];
      if (st.paid) {
        var how = st.method === 'online' ? 'Paid online' : st.method === 'upi' ? 'UPI collected' : 'Cash collected';
        kids.push(el(d, 'div', { class: 'cp-tick', id: 'cpPaid' }, [el(d, 'span', { class: 'cp-tickmark', 'aria-hidden': 'true', text: '✓' }), el(d, 'h2', { class: 'cp-h', text: 'Paid' }), el(d, 'p', { class: 'cp-amt', text: inr(st.amount) }), el(d, 'p', { class: 'cp-line', text: how })]));
        root.appendChild(el(d, 'div', { class: 'cp-in' }, kids)); return;
      }
      if (S.view === 'inspect') { paintInspect(kids); root.appendChild(el(d, 'div', { class: 'cp-in' }, kids)); return; }
      kids.push(el(d, 'p', { class: 'cp-lab', text: 'Amount due' }));
      kids.push(el(d, 'p', { class: 'cp-amt', id: 'cpAmt', text: S.amount != null ? inr(S.amount) : '…' }));
      if (S.err) kids.push(el(d, 'p', { class: 'cp-err', role: 'alert', text: S.err }), btn('Try again', 'cp-ghost', request, 'cpRetry'));
      else if (S.link) {
        var qr = null; try { qr = w.MXP_QR ? w.MXP_QR.svg(d, S.link, 168) : null; } catch (e) { qr = null; }
        kids.push(el(d, 'div', { class: 'cp-qr', id: 'cpQr' }, [qr || el(d, 'p', { class: 'cp-line', text: 'QR could not be drawn. Use the link.' })]));
        var wa = waLink(opts.phone, waText(opts.first, S.amount, S.link));
        kids.push(wa ? el(d, 'a', { class: 'cp-btn cp-primary', id: 'cpWa', href: wa, target: '_blank', rel: 'noopener', text: 'Send link on WhatsApp' }) : btn('Copy link', 'cp-primary', copy, 'cpCopyMain'));
        if (wa) kids.push(btn('Copy link', 'cp-ghost cp-small', copy, 'cpCopy'));
        kids.push(el(d, 'p', { class: 'cp-wait', id: 'cpWait', text: 'Waiting for payment' }, []));
      } else kids.push(el(d, 'p', { class: 'cp-line', text: 'Making the link' }));
      kids.push(btn('Customer wants to inspect first: cash or UPI on arrival', 'cp-linkbtn', function () { S.view = 'inspect'; S.sub = null; paint(); }, 'cpInspect'));
      root.appendChild(el(d, 'div', { class: 'cp-in' }, kids));
    }
    function copy(e) { var b = e.currentTarget; try { w.navigator.clipboard.writeText(S.link).then(function () { b.textContent = 'Copied'; }, function () { b.textContent = 'Copy failed'; }); } catch (x) { b.textContent = 'Copy failed'; } }
    function setInspect(on) {
      S.busy = true; S.err = null; paint();
      opts.call('inspect_first_set', { on: on }).then(function (r) {
        S.busy = false;
        if (!r.ok) { S.err = (r.data && r.data.error) || 'Could not save.'; paint(); return; }
        S.state = Object.assign({}, S.state, { inspect_first: r.data.inspect_first, cash_available: r.data.cash_available }); paint();
      });
    }
    function paintInspect(kids) {
      var st = S.state, ok = cashAvailable(st) && st.cash_available !== false;
      kids.push(el(d, 'h2', { class: 'cp-h', text: 'Inspect first' }));
      if (S.err) kids.push(el(d, 'p', { class: 'cp-err', role: 'alert', text: S.err }));
      if (!st.arrived) kids.push(el(d, 'p', { class: 'cp-line', text: 'Cash or UPI opens once the vehicle has arrived.' }));
      else if (!st.inspect_first) kids.push(el(d, 'p', { class: 'cp-line', text: 'Only if the customer asked to inspect the work before paying.' }), btn('Customer wants to inspect before paying', 'cp-primary', function () { setInspect(true); }, 'cpTick', S.busy));
      else {
        kids.push(el(d, 'p', { class: 'cp-line', text: 'Inspect first is on. Take the payment after the customer has checked the work.' }));
        var amt = el(d, 'input', { class: 'cp-in-amt', id: 'cpAmtIn', type: 'text', inputmode: 'decimal', 'aria-label': 'Amount received in rupees', value: S.amount != null ? String(S.amount) : '' });
        var how = S.sub || 'cash';
        var seg = el(d, 'div', { class: 'cp-seg', role: 'group', 'aria-label': 'How the customer paid' }, ['cash', 'upi'].map(function (m) { return el(d, 'button', { type: 'button', class: 'cp-segb' + (how === m ? ' is-on' : ''), id: 'cpM-' + m, 'aria-pressed': how === m ? 'true' : 'false', text: m === 'cash' ? 'Cash' : 'UPI', onclick: function () { S.sub = m; S.amount = amt.value; paint(); } }); }));
        kids.push(seg, el(d, 'label', { class: 'cp-lab', for: 'cpAmtIn', text: 'Amount received (₹)' }), amt);
        kids.push(btn('Mark collected', 'cp-primary', function (e) {
          var v = Number(amt.value); if (!(v >= 1)) { S.err = 'Enter the amount you received.'; S.amount = amt.value; paint(); return; }
          e.currentTarget.disabled = true; S.busy = true;
          opts.call('payment_cash', { amount: v, method: how }).then(function (r) { S.busy = false; if (!r.ok) { S.err = (r.data && r.data.error) || 'Could not save.'; S.amount = amt.value; paint(); return; } S.state = Object.assign({}, S.state, { paid: true, method: r.data.method, amount: r.data.amount }); paint(); if (opts.onChange) opts.onChange(S.state); });
        }, 'cpCollect', !ok));
        kids.push(btn('Not inspecting: back to online', 'cp-linkbtn', function () { setInspect(false); S.view = 'online'; }, 'cpUntick'));
      }
      kids.push(btn('Back to pay online', 'cp-ghost', function () { S.view = 'online'; S.err = null; paint(); }, 'cpBack'));
    }
    paint();
    if (!S.state.paid) request(); else if (opts.poll) schedule();
    return { el: root, stop: stop, state: function () { return S.state; } };
  }
  return { create: create, cashAvailable: cashAvailable, waText: waText, waLink: waLink, inr: inr };
});
