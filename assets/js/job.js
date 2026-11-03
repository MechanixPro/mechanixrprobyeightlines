/* The technician's job page: shows the job from the link, then takes the amount collected and shows the company-share payment link.
   The token in the link is the only key; the tech-job function checks it. No inline script (CSP), no tracking. */
(function () {
  'use strict';
  var C = window.MXP || {}, lead = document.getElementById('jbLead'), job = document.getElementById('jbJob'), facts = document.getElementById('jbFacts');
  var form = document.getElementById('jbForm'), msg = document.getElementById('jbMsg'), go = document.getElementById('jbGo'), done = document.getElementById('jbDone');
  var t = (new URLSearchParams(location.search).get('t') || '').toLowerCase();
  var esc = function (v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var rs = function (n) { return '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 }); };
  var fail = function (text) { lead.textContent = text; job.hidden = true; form.hidden = true; };
  var call = function (body) {
    return fetch(C.supabaseUrl + '/functions/v1/tech-job', { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: C.supabaseAnonKey, Authorization: 'Bearer ' + C.supabaseAnonKey }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, d: d }; }); });
  };
  var result = function (d) {
    form.hidden = true;
    done.innerHTML = '<div class="card"><h2>Thank you. The job is reported.</h2>' + (Number(d.company_share) >= 1
      ? '<p>Company share for this job: <b>' + rs(d.company_share) + '</b>.</p>' + (d.pay_url ? '<a class="btn btn-primary job-pay" href="' + esc(d.pay_url) + '" rel="noopener">Pay ' + rs(d.company_share) + ' company share</a>' : '<p>The desk will send you the payment link.</p>')
      : '<p>Nothing to pay to the company for this job.</p>') + '</div>';
  };
  if (!/^[0-9a-f]{64}$/.test(t)) { fail('This link is not valid.'); return; }
  if (!C.supabaseUrl || !C.supabaseAnonKey) { fail('This page is not available right now. Message the desk on WhatsApp.'); return; }
  call({ action: 'get', t: t }).then(function (x) {
    if (!x.ok) { fail((x.d && x.d.error) || 'This link is not valid.'); return; }
    var d = x.d, rows = [['Booking', d.ref], ['Customer', [d.first_name, d.phone].filter(Boolean).join(' · ')], ['Bike', d.bike], ['Service', d.service], ['When', d.when], ['Place', [d.area, d.address].filter(Boolean).join(', ')], ['Notes', d.notes]];
    facts.innerHTML = rows.filter(function (r) { return r[1]; }).map(function (r) { return '<dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd>'; }).join('');
    if (d.phone) facts.insertAdjacentHTML('beforeend', '<dt></dt><dd><a class="btn btn-ghost btn-sm" href="tel:+91' + esc(String(d.phone).replace(/\D/g, '').slice(-10)) + '">Call the customer</a></dd>');
    lead.textContent = 'Booking ' + d.ref + '.'; job.hidden = false;
    if (d.reported) { result(d); return; }
    form.hidden = false;
  }).catch(function () { fail('Could not load the job. Check your internet and open the link again.'); });
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var a = document.getElementById('jb-amount').value.trim();
    if (a === '' || !(Number(a) >= 0) || Number(a) > 100000) { msg.textContent = 'Enter the amount you collected, from ₹0 to ₹1,00,000.'; return; }
    go.disabled = true; msg.textContent = 'Saving…';
    call({ action: 'report', t: t, amount: a, note: document.getElementById('jb-note').value }).then(function (x) {
      go.disabled = false;
      if (x.ok || (x.d && x.d.reported)) { msg.textContent = ''; result(x.d); return; }
      msg.textContent = (x.d && x.d.error) || 'Something went wrong. Please try again.';
    }).catch(function () { go.disabled = false; msg.textContent = 'Could not save. Check your internet and try again.'; });
  });
})();
