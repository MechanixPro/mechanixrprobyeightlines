/* The technician's job page: shows the job from the link, then takes the amount collected and shows the company-share payment link.
   Pickup jobs also get Pickup and Return steps: photos (compressed on the phone), uploaded to one-time signed URLs, then the 4-digit code the customer gives.
   Also: My jobs (this mechanic's other jobs, opened with a fresh link), Navigate (Google Maps), what the customer added, the quote read-only, and Share my live location (job-geo.js, only after a tap, only while On the way or Arrived).
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
    if (window.MXP_JOBGEO && typeof sharer !== 'undefined' && sharer) sharer.stop('stage');
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

  /* ---------- Journey extras: Navigate, the customer's note, the quote (read-only), My jobs, live location ---------- */
  var QSTAT = { sent: ['jm-wait', 'Waiting for customer approval.', ' Do not start work yet.'], approved: ['jm-go', 'Approved: you can start.', ''], declined: ['jm-wait', 'The customer declined the quote.', ' Do not start. Ask the desk.'] };
  var quotePanel = function (z) {
    if (!z) return '<p class="muted" id="jv-quote">No quote yet. The desk builds it after your check.</p>';
    var k = QSTAT[z.status] || ['jm-wait', z.status, ''], rows = (z.lines || []).map(function (l) { return '<tr><td>' + esc(l.name) + '</td><td class="r">' + rs(l.amount) + '</td></tr>'; }).join('');
    return '<div class="jm-quote" id="jv-quote"><div class="' + k[0] + '" role="status"><b>' + k[1] + '</b>' + k[2] + '</div><table><tbody>' + rows
      + '<tr><td>Before GST</td><td class="r">' + rs(z.subtotal) + '</td></tr><tr><td>GST 18%</td><td class="r">' + rs(z.gst) + '</td></tr><tr class="b"><td>Total</td><td class="r">' + rs(z.total) + '</td></tr>'
      + (Number(z.fee_credit) ? '<tr><td>Confirmation fee paid</td><td class="r">− ' + rs(z.fee_credit) + '</td></tr>' : '') + '<tr class="b"><td>Balance for the customer</td><td class="r">' + rs(z.balance) + '</td></tr></tbody></table>'
      + (z.eta_text && z.status !== 'declined' ? '<p><b>Delivery:</b> ' + esc(z.eta_text) + '</p>' : '') + '<p class="hint">Version ' + esc(z.version) + '. You cannot change the quote here. The desk revises it.</p></div>';
  };
  var navBtn = function (u) { return u ? '<a class="btn btn-primary jm-nav" href="' + esc(u) + '" target="_blank" rel="noopener">Navigate</a>' : ''; };
  var noteEl = document.getElementById('jbNote');
  var renderNote = function (n) {
    if (!n || !(n.landmark || n.access_note || n.reg_no || n.kms || n.vehicle_note || n.issue_text || (n.photos && n.photos.length))) { noteEl.hidden = true; noteEl.innerHTML = ''; return; }
    var rows = [['Landmark', n.landmark], ['Gate or parking', n.access_note], ['Registration', n.reg_no], ['Kilometres', n.kms != null ? String(n.kms) : null], ['About the vehicle', n.vehicle_note], ['What the customer says is wrong', n.issue_text]];
    noteEl.innerHTML = '<div class="card jm-card"><h2>From the customer</h2><dl class="job-facts">' + rows.filter(function (r) { return r[1]; }).map(function (r) { return '<dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd>'; }).join('') + '</dl>'
      + (n.photos && n.photos.length ? '<div class="job-thumbs">' + n.photos.map(function (u, i) { return '<a class="job-thumb" href="' + esc(u) + '" target="_blank" rel="noopener"><img alt="Customer photo ' + (i + 1) + '" src="' + esc(u) + '"></a>'; }).join('') + '</div>' : '') + '</div>';
    noteEl.hidden = false;
  };
  var SLOT = { asap: 'As soon as possible', morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening' }, STAGE_TXT = { on_the_way: 'On the way', arrived: 'Arrived', started: 'Code verified', repair_doorstep: 'Repair at the door', picked_up: 'Picked up', ready: 'Ready', returned: 'Delivered' };
  var mine = document.getElementById('jbMine');
  var loadMine = function () {
    call({ action: 'my_jobs', t: t }).then(function (x) {
      var jobs = x.ok && x.d && x.d.jobs ? x.d.jobs : []; if (jobs.length < 2) { mine.hidden = true; return; }
      mine.innerHTML = '<div class="card"><h2>My jobs</h2><ul class="jm-jobs">' + jobs.map(function (j) {
        var when = (j.is_today === 'true' ? 'Today' : j.preferred_date ? new Date(j.preferred_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '') + (j.preferred_slot ? ' · ' + (SLOT[j.preferred_slot] || j.preferred_slot) : '');
        return '<li' + (j.current ? ' class="now"' : '') + '><div class="jm-row"><b>' + esc(j.booking_id || 'Booking') + '</b><span>' + esc(when) + '</span></div><div>' + esc(j.first_name || '') + ' · ' + esc(j.area || '') + '</div><div class="muted">' + esc([j.bike || (j.vehicle === 'car' ? 'Car' : 'Bike'), j.service_name].filter(Boolean).join(' · ')) + (j.stage ? ' · ' + esc(STAGE_TXT[j.stage] || j.stage) : '') + '</div>'
          + (j.current ? '<p class="job-ok">This job is open now.</p>' : '<button class="btn btn-ghost wide" type="button" data-open="' + esc(j.id) + '">Open this job</button>') + '</li>'; }).join('') + '</ul><p class="err" id="jbMineMsg" role="alert"></p></div>';
      mine.hidden = false;
    }).catch(function () {});
  };
  mine.addEventListener('click', function (e) {
    var b = e.target.closest('[data-open]'); if (!b) return; var m = document.getElementById('jbMineMsg'); b.disabled = true; m.textContent = 'Opening…';
    call({ action: 'my_job_open', t: t, job: b.dataset.open }).then(function (x) { if (x.ok && x.d.token) { location.href = '/job/?t=' + encodeURIComponent(x.d.token); return; } b.disabled = false; m.textContent = (x.d && x.d.error) || 'Could not open that job.'; })
      .catch(function () { b.disabled = false; m.textContent = 'Could not open that job. Check your internet.'; });
  });
  /* Live location. Starts only on the mechanic's tap; the consent line is next to the button. */
  var geoMsg = function (text) { var el = document.getElementById('jmShareMsg'); if (el) el.textContent = text; }, lastSent = 0;
  var sharer = window.MXP_JOBGEO ? window.MXP_JOBGEO.createSharer(window, function (pos) {
    return call({ action: 'location_update', t: t, lat: pos.lat, lng: pos.lng, accuracy: pos.accuracy, heading: pos.heading }).then(function (x) { return { ok: x.ok, stopped: !!(x.d && x.d.stopped) }; });
  }, {
    onStart: function () { geoMsg('Sharing your location with the customer and the team.'); paintShare(); },
    onSent: function (pos, at) { lastSent = at; var el = document.getElementById('jmLast'); if (el) el.textContent = 'Last sent ' + new Date(at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) + '.'; },
    onStop: function (why) { paintShare(); geoMsg(why === 'stage' ? 'Sharing stopped: this job is no longer On the way or Arrived.' : why === 'denied' ? 'Location is blocked for this page.' : why === 'closed' ? '' : 'Sharing stopped.'); },
    onError: function (m) { geoMsg(m); paintShare(); }
  }) : null;
  var CONSENT = 'Your location is shared with the customer and the Mechanix Pro team only while this job is On the way or Arrived. It stops when you arrive and verify the code, or finish.';
  var shareHtml = function () {
    if (!sharer) return '';
    var on = sharer.active();
    return '<div class="jm-share" id="jmShare"><p class="jm-consent" id="jmConsent">' + CONSENT + '</p>'
      + (on ? '<p class="jm-live"><i class="jm-dot" aria-hidden="true"></i><span>Sharing your location</span></p><p class="hint" id="jmLast"></p>' : '')
      + '<button class="btn ' + (on ? 'btn-ghost' : 'btn-primary') + ' wide" type="button" data-v="share" aria-describedby="jmConsent" aria-pressed="' + on + '">' + (on ? 'Stop sharing' : 'Share my live location') + '</button>'
      + '<p class="hint" id="jmShareMsg" role="status" aria-live="polite"></p></div>';
  };
  var paintShare = function () { var el = document.getElementById('jmShare'); if (!el) return; var w = document.createElement('div'); w.innerHTML = shareHtml(); var keep = (document.getElementById('jmShareMsg') || {}).textContent; el.replaceWith(w.firstChild); if (keep) geoMsg(keep); };

  /* ---------- The visit: on the way, arrived, the customer's code, repair at the door or pick-up, ready, delivered. No prices here. ---------- */
  var vis = document.getElementById('jbVisit'), vbusy = false;
  var QTXT = { sent: 'The quote was sent. Waiting for the customer to approve.', declined: 'The customer declined the quote. Do not start.', approved: 'The customer approved the quote.' };
  var vbtn = function (act, label, extra, cls) { return '<button class="btn ' + (cls || 'btn-primary') + ' wide" type="button" data-v="' + act + '"' + (extra || '') + '>' + label + '</button>'; };
  var renderVisit = function (d) {
    var what = d.vehicle === 'car' ? 'car' : 'bike', st = d.stage, h = '<h2 class="job-h">Visit</h2><div class="card job-step">';
    if (sharer && sharer.active() && !d.share_ok) sharer.stop('stage');   // code verified or finished: sharing ends by itself
    renderNote(d.customer_note);
    if (!/ready|returned/.test(st || '')) h += navBtn(d.navigate_url);
    if (!d.paid) h += '<p class="muted">This booking is not paid yet. Ask the desk.</p>';
    else if (!st) h += '<p class="hint">Tell the customer you are coming, then mark Arrived when you reach the address.</p>' + (d.next.indexOf('on_the_way') > -1 ? vbtn('visit_status', 'On the way', ' data-stage="on_the_way"') : '') + vbtn('visit_status', 'Arrived', ' data-stage="arrived"', 'btn-ghost');
    else if (st === 'on_the_way') h += vbtn('visit_status', 'Arrived', ' data-stage="arrived"') + shareHtml();
    else if (st === 'arrived' || (d.door !== 'verified' && !/started|repair|picked|ready|returned/.test(st))) {
      if (d.share_ok) h += shareHtml();
      var hold = { none: 'The customer has no code yet. Ask the desk to send one.', locked: 'Too many wrong codes. Ask the desk to send a new code.', expired: 'The code has expired. Ask the desk for a new one.' }[d.door];
      h += hold ? '<p class="muted">' + hold + '</p>' : '<p class="hint">Ask the customer for their 4-digit code. Do not start without it.</p><label class="label" for="jv-code">Code from the customer</label><input id="jv-code" class="job-code" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="off" placeholder="4 digits"><p class="err" id="jv-msg" role="alert"></p>' + vbtn('visit_start', 'Verify code and start the job');
    } else if (st === 'started') {
      h += '<p class="job-ok">Code verified. Check the ' + what + ' and tell the desk what it needs.</p>'
        + quotePanel(d.quote_view)
        + (d.can_start_work ? '' : '<p class="hint">Start work is blocked until the customer approves the quote. If they said yes on the phone, ask the desk to record it.</p>')
        + vbtn('visit_outcome', 'Start work: repair at the customer\'s place', ' data-outcome="repair_doorstep"' + (d.can_start_work ? '' : ' disabled aria-disabled="true"'))
        + vbtn('visit_outcome', 'Start work: pick up for the workshop', ' data-outcome="pickup"' + (d.can_start_work ? '' : ' disabled aria-disabled="true"'), 'btn-ghost') + '<p class="err" id="jv-msg" role="alert"></p>'
        + '<button class="btn btn-ghost wide" type="button" data-v="refresh">Check the quote again</button>';
    } else if (st === 'repair_doorstep') h += '<p class="job-ok">Repair in progress at the customer\'s place.</p>' + quotePanel(d.quote_view) + '<p class="hint">When the work is done, mark it out so the customer and the desk know.</p>' + vbtn('visit_ready', 'Mark ready');
    else if (st === 'picked_up') h += '<p class="job-ok">Picked up for the workshop.</p>' + quotePanel(d.quote_view) + vbtn('visit_ready', 'Mark ready for return');
    else if (st === 'ready') h += d.place === 'garage' ? '<p class="job-ok">Ready. Use Return below with a new code and photos when you bring it back.</p>' : '<p class="job-ok">Ready.</p>' + vbtn('visit_deliver', 'Handed back to the customer');
    else if (st === 'returned') h += '<p class="job-ok">Delivered.</p>';
    vis.innerHTML = h + '<p class="err" id="jv-err" role="alert"></p></div>'; vis.hidden = false;
  };
  var pollTimer = null;
  var loadVisit = function () {
    call({ action: 'visit_state', t: t }).then(function (x) {
      if (!x.ok) return; renderVisit(x.d);
      // While the quote waits for the customer, check again every 20 seconds (only while this page is visible) so the mechanic knows when to begin.
      clearTimeout(pollTimer); if (x.d.stage === 'started' && !x.d.can_start_work && x.d.quote_view && x.d.quote_view.status === 'sent') pollTimer = setTimeout(function () { if (!document.hidden) loadVisit(); else pollTimer = setTimeout(loadVisit, 20000); }, 20000);
    }).catch(function () {});
  };
  vis.addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b || vbusy) return; var act = b.dataset.v, msgEl = document.getElementById('jv-msg') || document.getElementById('jv-err'), body = { action: act, t: t };
    if (act === 'refresh') { loadVisit(); return; }
    if (act === 'share') { if (!sharer) return; if (sharer.active()) sharer.stop('stopped'); else sharer.start(); paintShare(); return; }
    if (act === 'visit_status') body.stage = b.dataset.stage;
    if (act === 'visit_outcome') body.outcome = b.dataset.outcome;
    if (act === 'visit_start') { var c = (document.getElementById('jv-code').value || '').trim(); if (!/^[0-9]{4}$/.test(c)) { msgEl.textContent = 'Enter the 4-digit code from the customer.'; return; } body.code = c; }
    vbusy = true; msgEl.textContent = 'Saving…';
    var wasStart = act === 'visit_start';
    call(body).then(function (x) { vbusy = false; if (x.ok) { if (wasStart && sharer) sharer.stop('stage'); loadVisit(); loadHand(); return; } msgEl.textContent = (x.d && x.d.error) || 'Something went wrong. Please try again.'; if (x.d && (x.d.locked || x.d.blocked)) loadVisit(); })
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
    if (d.navigate_url) facts.insertAdjacentHTML('beforeend', '<dt></dt><dd><a class="btn btn-ghost btn-sm" href="' + esc(d.navigate_url) + '" target="_blank" rel="noopener">Navigate</a></dd>');
    lead.textContent = d.booking_id ? 'Booking ' + d.booking_id + '.' : 'Your job.'; job.hidden = false; form.hidden = false; loadVisit(); loadHand(); loadMine();
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
