/* The technician's job page: shows the job from the link, then takes the amount collected and shows the company-share payment link.
   Pickup jobs also get Pickup and Return steps: photos (compressed on the phone), uploaded to one-time signed URLs, then the 4-digit code the customer gives.
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
  var hand = document.getElementById('jbHand'), photos = { pickup: [], return: [] }, busy = false;
  var MIN_PHOTOS = 4, MAX_PHOTOS = 8, MAX_SIDE = 1280, QUALITY = 0.7, HINT = 'front, back, left and right', VEH = 'bike';
  var TITLE = { pickup: 'Pickup', return: 'Return' };
  // Shrink a photo on the phone: longest side 1280px, JPEG at 0.7 (about 150 KB).
  var compress = function (file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        var k = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight)), c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
        c.toBlob(function (b) { b ? resolve(b) : reject(new Error('compress')); }, 'image/jpeg', QUALITY);
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('image')); };
      img.src = url;
    });
  };
  var stepHtml = function (s) {
    var k = s.kind, head = '<h2>' + TITLE[k] + '</h2>';
    if (s.state === 'verified') return '<div class="card job-step" data-kind="' + k + '">' + head + '<p class="job-ok">Done. ' + TITLE[k] + ' verified with ' + Number(s.photos || 0) + ' photos.</p></div>';
    var hold = { waiting: 'Opens after the pickup is verified.', no_code: 'The desk has not sent the customer a code yet. Ask the desk to send it.', locked: 'Too many wrong codes. Ask the desk to send a new code.', expired: 'The code has expired. Ask the desk to send a new code.' }[s.state];
    if (hold) return '<div class="card job-step" data-kind="' + k + '">' + head + '<p class="muted">' + hold + '</p></div>';
    return '<div class="card job-step" data-kind="' + k + '">' + head
      + '<p class="hint">Take at least ' + MIN_PHOTOS + ' photos: ' + HINT + '. Add any damage if you can.</p>'
      + '<label class="btn btn-ghost job-snap" for="jh-file-' + k + '">Take photos</label>'
      + '<input class="job-file" id="jh-file-' + k + '" data-kind="' + k + '" type="file" accept="image/*" capture="environment" multiple>'
      + '<p class="job-count" id="jh-count-' + k + '" role="status">No photos yet.</p><div class="job-thumbs" id="jh-thumbs-' + k + '"></div>'
      + (s.code_needed === false ? '<p class="hint">The customer already gave the code at the door. Photos are enough.</p>' : '<label class="label" for="jh-code-' + k + '">Code from the customer</label>'
      + '<input id="jh-code-' + k + '" data-kind="' + k + '" class="job-code" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="off" placeholder="4 digits">')
      + '<p class="err" id="jh-msg-' + k + '" role="alert"></p>'
      + '<button class="btn btn-primary wide" type="button" data-kind="' + k + '" data-go="1">Verify ' + TITLE[k].toLowerCase() + '</button></div>';
  };
  var renderHand = function (d) {
    if (!d.pickup) { hand.hidden = true; return; }
    if (d.photos) { MIN_PHOTOS = d.photos.min; HINT = d.photos.hint; } VEH = d.vehicle || 'bike';
    hand.innerHTML = '<h2 class="job-h">Handover</h2>' + d.steps.map(stepHtml).join(''); hand.hidden = false;
    d.steps.forEach(function (s) { paint(s.kind); });
  };
  var paint = function (k) {
    var n = photos[k].length, c = document.getElementById('jh-count-' + k), th = document.getElementById('jh-thumbs-' + k); if (!c) return;
    c.textContent = n ? n + (n === 1 ? ' photo ready.' : ' photos ready.') + (n < MIN_PHOTOS ? ' Take ' + (MIN_PHOTOS - n) + ' more.' : '') : 'No photos yet.';
    th.innerHTML = photos[k].map(function (p, i) { return '<span class="job-thumb"><img alt="Photo ' + (i + 1) + '" src="' + p.preview + '"><button type="button" data-rm="' + i + '" data-kind="' + k + '" aria-label="Remove photo ' + (i + 1) + '">×</button></span>'; }).join('');
  };
  var loadHand = function () {
    call({ action: 'handover_state', t: t }).then(function (x) { if (x.ok) renderHand(x.d); }).catch(function () {});
  };
  var upload = function (k) {
    var todo = photos[k].filter(function (p) { return !p.path; });
    if (!todo.length) return Promise.resolve();
    return call({ action: 'handover_upload_url', t: t, kind: k, types: todo.map(function () { return 'image/jpeg'; }) }).then(function (x) {
      if (!x.ok) throw new Error((x.d && x.d.error) || 'Could not start the upload.');
      return Promise.all(x.d.uploads.map(function (u, i) {
        var fd = new FormData(); fd.append('cacheControl', '3600'); fd.append('', todo[i].blob);
        return fetch(u.url, { method: 'PUT', headers: { 'x-upsert': 'false' }, body: fd }).then(function (r) { if (!r.ok) throw new Error('A photo did not upload. Check your internet and try again.'); todo[i].path = u.path; });
      }));
    });
  };
  var verify = function (k) {
    var msgEl = document.getElementById('jh-msg-' + k), codeEl = document.getElementById('jh-code-' + k), code = codeEl ? codeEl.value.trim() : '', say = function (m) { msgEl.textContent = m; };
    if (busy) return;
    if (photos[k].length < MIN_PHOTOS) { say('Take at least ' + MIN_PHOTOS + ' photos first.'); return; }
    if (codeEl && !/^[0-9]{4}$/.test(code)) { say('Enter the 4-digit code from the customer.'); return; }
    busy = true; say('Uploading photos…');
    upload(k).then(function () {
      say('Checking the code…');
      return call({ action: 'handover_verify', t: t, kind: k, code: codeEl ? code : undefined, photos: photos[k].map(function (p) { return p.path; }) });
    }).then(function (x) {
      busy = false;
      if (x.ok) { photos[k] = []; loadHand(); loadVisit(); return; }
      say((x.d && x.d.error) || 'Something went wrong. Please try again.');
      if (x.d && (x.d.locked || /expired|already/.test(x.d.error || ''))) loadHand();
    }).catch(function (e) { busy = false; say(e && e.message ? e.message : 'Could not save. Check your internet and try again.'); });
  };
  hand.addEventListener('change', function (e) {
    var inp = e.target; if (!inp.classList.contains('job-file')) return;
    var k = inp.dataset.kind, files = Array.prototype.slice.call(inp.files || []), msgEl = document.getElementById('jh-msg-' + k);
    inp.value = ''; msgEl.textContent = '';
    if (photos[k].length + files.length > MAX_PHOTOS) { msgEl.textContent = 'At most ' + MAX_PHOTOS + ' photos.'; files = files.slice(0, Math.max(0, MAX_PHOTOS - photos[k].length)); }
    files.reduce(function (p, f) {
      return p.then(function () { return compress(f).then(function (b) { photos[k].push({ blob: b, preview: URL.createObjectURL(b), path: null }); paint(k); }); });
    }, Promise.resolve()).catch(function () { msgEl.textContent = 'A photo could not be read. Take it again.'; });
  });
  hand.addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    if (b.dataset.go) verify(b.dataset.kind);
    if (b.dataset.rm) { var k = b.dataset.kind, p = photos[k].splice(Number(b.dataset.rm), 1)[0]; if (p) URL.revokeObjectURL(p.preview); paint(k); }
  });

  /* ---------- The visit: on the way, arrived, the customer's code, repair at the door or pick-up, ready, delivered. No prices here. ---------- */
  var vis = document.getElementById('jbVisit'), vbusy = false;
  var QTXT = { sent: 'The quote was sent. Waiting for the customer to approve.', declined: 'The customer declined the quote. Do not start.', approved: 'The customer approved the quote.' };
  var vbtn = function (act, label, extra, cls) { return '<button class="btn ' + (cls || 'btn-primary') + ' wide" type="button" data-v="' + act + '"' + (extra || '') + '>' + label + '</button>'; };
  var renderVisit = function (d) {
    var what = d.vehicle === 'car' ? 'car' : 'bike', st = d.stage, h = '<h2 class="job-h">Visit</h2><div class="card job-step">';
    if (!d.paid) h += '<p class="muted">This booking is not paid yet. Ask the desk.</p>';
    else if (!st) h += '<p class="hint">Tell the customer you are coming, then mark Arrived when you reach the address.</p>' + (d.next.indexOf('on_the_way') > -1 ? vbtn('visit_status', 'On the way', ' data-stage="on_the_way"') : '') + vbtn('visit_status', 'Arrived', ' data-stage="arrived"', 'btn-ghost');
    else if (st === 'on_the_way') h += vbtn('visit_status', 'Arrived', ' data-stage="arrived"');
    else if (st === 'arrived' || (d.door !== 'verified' && !/started|repair|picked|ready|returned/.test(st))) {
      var hold = { none: 'The customer has no code yet. Ask the desk to send one.', locked: 'Too many wrong codes. Ask the desk to send a new code.', expired: 'The code has expired. Ask the desk for a new one.' }[d.door];
      h += hold ? '<p class="muted">' + hold + '</p>' : '<p class="hint">Ask the customer for their 4-digit code. Do not start without it.</p><label class="label" for="jv-code">Code from the customer</label><input id="jv-code" class="job-code" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="off" placeholder="4 digits"><p class="err" id="jv-msg" role="alert"></p>' + vbtn('visit_start', 'Verify code and start the job');
    } else if (st === 'started') {
      h += '<p class="job-ok">Code verified. Check the ' + what + ' and tell the desk what it needs.</p>'
        + '<p class="' + (d.can_start_work ? 'job-ok' : 'muted') + '" id="jv-quote"><b>Quote:</b> ' + esc(d.quote ? (QTXT[d.quote.status] || d.quote.status) + (d.quote.eta_text && d.quote.status !== 'declined' ? ' Delivery: ' + d.quote.eta_text + '.' : '') : 'No quote yet. The desk builds it after your check.') + '</p>'
        + (d.can_start_work ? '' : '<p class="hint">Start work is blocked until the customer approves the quote. If they said yes on the phone, ask the desk to record it.</p>')
        + vbtn('visit_outcome', 'Start work: repair at the customer\'s place', ' data-outcome="repair_doorstep"' + (d.can_start_work ? '' : ' disabled aria-disabled="true"'))
        + vbtn('visit_outcome', 'Start work: pick up for the workshop', ' data-outcome="pickup"' + (d.can_start_work ? '' : ' disabled aria-disabled="true"'), 'btn-ghost') + '<p class="err" id="jv-msg" role="alert"></p>'
        + '<button class="btn btn-ghost wide" type="button" data-v="refresh">Check the quote again</button>';
    } else if (st === 'repair_doorstep') h += '<p class="job-ok">Repair in progress at the customer\'s place.</p>' + vbtn('visit_ready', 'Mark ready');
    else if (st === 'picked_up') h += '<p class="job-ok">Picked up for the workshop.</p>' + vbtn('visit_ready', 'Mark ready for return');
    else if (st === 'ready') h += d.place === 'garage' ? '<p class="job-ok">Ready. Use Return below with a new code and photos when you bring it back.</p>' : '<p class="job-ok">Ready.</p>' + vbtn('visit_deliver', 'Handed back to the customer');
    else if (st === 'returned') h += '<p class="job-ok">Delivered.</p>';
    vis.innerHTML = h + '<p class="err" id="jv-err" role="alert"></p></div>'; vis.hidden = false;
  };
  var loadVisit = function () { call({ action: 'visit_state', t: t }).then(function (x) { if (x.ok) renderVisit(x.d); }).catch(function () {}); };
  vis.addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b || vbusy) return; var act = b.dataset.v, msgEl = document.getElementById('jv-msg') || document.getElementById('jv-err'), body = { action: act, t: t };
    if (act === 'refresh') { loadVisit(); return; }
    if (act === 'visit_status') body.stage = b.dataset.stage;
    if (act === 'visit_outcome') body.outcome = b.dataset.outcome;
    if (act === 'visit_start') { var c = (document.getElementById('jv-code').value || '').trim(); if (!/^[0-9]{4}$/.test(c)) { msgEl.textContent = 'Enter the 4-digit code from the customer.'; return; } body.code = c; }
    vbusy = true; msgEl.textContent = 'Saving…';
    call(body).then(function (x) { vbusy = false; if (x.ok) { loadVisit(); loadHand(); return; } msgEl.textContent = (x.d && x.d.error) || 'Something went wrong. Please try again.'; if (x.d && (x.d.locked || x.d.blocked)) loadVisit(); })
      .catch(function () { vbusy = false; msgEl.textContent = 'Could not save. Check your internet and try again.'; });
  });
  if (!/^[0-9a-f]{64}$/.test(t)) { fail('This link is not valid.'); return; }
  if (!C.supabaseUrl || !C.supabaseAnonKey) { fail('This page is not available right now. Message the desk on WhatsApp.'); return; }
  call({ action: 'get', t: t }).then(function (x) {
    if (!x.ok) { fail((x.d && x.d.error) || 'This link is not valid.'); return; }
    var d = x.d, rows = [['Booking', d.booking_id], ['Customer', [d.first_name, d.phone].filter(Boolean).join(' · ')], ['Bike', d.bike], ['Service', d.service], ['When', d.when], ['Place', [d.area, d.address].filter(Boolean).join(', ')], ['Notes', d.notes]];
    if (d.reported) { lead.textContent = d.booking_id ? 'Booking ' + d.booking_id + '.' : 'Your job.'; result(d); loadHand(); return; }
    facts.innerHTML = rows.filter(function (r) { return r[1]; }).map(function (r) { return '<dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd>'; }).join('');
    if (d.phone) facts.insertAdjacentHTML('beforeend', '<dt></dt><dd><a class="btn btn-ghost btn-sm" href="tel:+91' + esc(String(d.phone).replace(/\D/g, '').slice(-10)) + '">Call the customer</a></dd>');
    lead.textContent = d.booking_id ? 'Booking ' + d.booking_id + '.' : 'Your job.'; job.hidden = false; form.hidden = false; loadVisit(); loadHand();
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
