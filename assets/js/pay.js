/* Pay for a booking with Razorpay Standard Checkout.
   1) ask our server to create an order (create-order), 2) open Razorpay's payment window, 3) send the result to our server to verify the signature (verify-payment).
   Only the public key id ever reaches this page; the secret stays on the server. No inline script (CSP). */
(function () {
  'use strict';
  var C = window.MXP || {}, form = document.getElementById('payForm'), msg = document.getElementById('payMsg'), out = document.getElementById('payResult'), go = document.getElementById('payGo');
  if (!form) return;
  var esc = function (v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var q = new URLSearchParams(location.search), pre = (q.get('ref') || '').toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 9);
  if (pre) document.getElementById('pay-ref').value = pre;
  function call(fn, body) {
    return fetch(C.supabaseUrl + '/functions/v1/' + fn, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: C.supabaseAnonKey, Authorization: 'Bearer ' + C.supabaseAnonKey }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { status: r.status, ok: r.ok, d: d }; }); });
  }
  function loadCheckout() {
    return new Promise(function (resolve, reject) {
      if (window.Razorpay) return resolve();
      var s = document.createElement('script'); s.src = 'https://checkout.razorpay.com/v1/checkout.js'; s.onload = resolve; s.onerror = function () { reject(new Error('load')); }; document.head.appendChild(s);
    });
  }
  function done(html) { out.innerHTML = '<div class="card track-card fade">' + html + '</div>'; msg.textContent = ''; go.disabled = false; }
  function verify(resp, ref) {
    msg.textContent = 'Confirming your payment…';
    call('verify-payment', { razorpay_order_id: resp.razorpay_order_id, razorpay_payment_id: resp.razorpay_payment_id, razorpay_signature: resp.razorpay_signature }).then(function (x) {
      if (x.ok && x.d.status === 'paid') done('<h2 style="font-size:28px">Payment received.</h2><p>Thank you. Your booking <b>' + esc(x.d.ref || ref) + '</b> is confirmed. We will message you on WhatsApp with the next steps.</p>');
      else if (x.status === 202) done('<h2 style="font-size:28px">Almost done.</h2><p>' + esc(x.d.message || 'Your payment is being confirmed.') + '</p>');
      else { go.disabled = false; msg.textContent = (x.d && x.d.error) || 'We could not confirm the payment. If money was taken, message us on WhatsApp with your reference.'; }
    }).catch(function () { go.disabled = false; msg.textContent = 'No connection while confirming. If money was taken, message us on WhatsApp with your reference.'; });
  }
  form.addEventListener('submit', function (e) {
    e.preventDefault(); out.innerHTML = '';
    var ref = document.getElementById('pay-ref').value.trim(), phone = document.getElementById('pay-phone').value.trim();
    if (!ref || !phone) { msg.textContent = 'Enter your reference and the mobile number you booked with.'; return; }
    if (!C.supabaseUrl || !C.supabaseAnonKey) { msg.textContent = 'Online payment is not available right now. Please pay through the link on WhatsApp.'; return; }
    go.disabled = true; msg.textContent = 'Starting your payment…';
    call('create-order', { ref: ref, phone: phone }).then(function (x) {
      if (!x.ok) { go.disabled = false; msg.textContent = (x.d && x.d.error) || 'Something went wrong. Please try again.'; return; }
      return loadCheckout().then(function () {
        var o = x.d, rzp = new window.Razorpay({
          key: o.key_id, amount: o.amount, currency: o.currency, order_id: o.order_id, name: 'Mechanix Pro', description: 'Booking ' + o.ref,
          prefill: { name: o.name, contact: '+91' + phone.replace(/\D/g, '').slice(-10) }, theme: { color: '#F2801F' },
          handler: function (resp) { verify(resp, o.ref); },
          modal: { ondismiss: function () { go.disabled = false; msg.textContent = 'Payment cancelled. Nothing was charged. You can try again.'; } },
        });
        rzp.on('payment.failed', function (r) { go.disabled = false; msg.textContent = 'Payment failed' + (r && r.error && r.error.description ? ': ' + r.error.description : '') + '. You can try again.'; });
        msg.textContent = ''; rzp.open();
      }).catch(function () { go.disabled = false; msg.textContent = 'Could not load the payment window. Check your connection and try again.'; });
    }).catch(function () { go.disabled = false; msg.textContent = 'No connection. Please try again.'; });
  });
})();
