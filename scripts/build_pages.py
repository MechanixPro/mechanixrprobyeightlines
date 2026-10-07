"""Generates area landing pages, legal pages and sitemap.xml.
Run:  python3 scripts/build_pages.py   (from the repo root). Edit AREAS / legal text below, then re-run."""
import html, json, os, datetime
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = 'https://mechanixpro.in'
TODAY = datetime.date.today().isoformat()

HEAD = '''<!doctype html>
<html lang="en-IN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>{title}</title>
<meta name="description" content="{desc}">
<link rel="canonical" href="{url}">
<meta property="og:title" content="{title}"><meta property="og:description" content="{desc}"><meta property="og:url" content="{url}"><meta property="og:image" content="{site}/assets/img/og.png"><meta property="og:type" content="website">
<link rel="icon" href="/assets/img/favicon-32.png" sizes="32x32"><link rel="apple-touch-icon" href="/assets/img/apple-touch-icon.png"><link rel="manifest" href="/manifest.webmanifest">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap">
<link rel="stylesheet" href="/assets/css/style.css">
{schema}
<script src="/assets/js/config.js" defer></script>
<script src="/assets/js/page.js" defer></script>
</head>
<body>
<header class="nav"><div class="wrap"><a class="brand" href="/" aria-label="Mechanix Pro home"><img src="/assets/img/logo.svg" alt="" width="26" height="29">MECHANIX PRO</a><a class="btn btn-primary btn-sm cta" href="{book}">Book now</a></div></header>
<main class="page">
'''
FOOT = '''</main>
<footer><div class="wrap"><p class="tiny"><a href="/" style="display:inline">Home</a> · <a href="/terms/" style="display:inline">Terms</a> · <a href="/privacy/" style="display:inline">Privacy</a> · <a href="/refund-policy/" style="display:inline">Refund policy</a> · <a href="/contact/" style="display:inline">Contact</a></p><p class="tiny">© 2026 Mechanix Pro, Bengaluru.</p></div></footer>
</body>
</html>
'''

AREAS = [
  ('hsr-layout', 'HSR Layout', '560102', 'Sectors 1 to 7, Agara, Parangi Palya and Somasundarapalya', 'Short hops to Koramangala and the Outer Ring Road add up: stop-start traffic wears brakes, clutch plates and chains faster than highway riding.'),
  ('koramangala', 'Koramangala', '560034, 560095, 560047', 'all 8 blocks, Ejipura and Viveknagar', 'Dense traffic around Sony World, Forum and the 80 Feet Road means a lot of idling, which is hard on engine oil and air filters.'),
  ('btm-layout', 'BTM Layout', '560076, 560029', 'BTM 1st and 2nd Stage, Madiwala and N.S. Palya', 'Daily commutes through Silk Board junction mean long idle times and heavy brake use — exactly what a regular service protects.'),
  ('bellandur', 'Bellandur', '560103', 'Kadubeesanahalli, Green Glen Layout, Devarabisanahalli and the ORR tech parks', 'Office commutes on the Outer Ring Road and Sarjapur Road are tough on chains, tyres and brakes; we can service your bike while you work.'),
  ('electronic-city', 'Electronic City', '560100', 'Phase 1 and Phase 2, Neeladri Nagar, Hosa Road and Konappana Agrahara', 'Long rides on Hosur Road and the elevated expressway mean more kilometres per month, so oil and chain care matter more.'),
  ('marathahalli', 'Marathahalli', '560037', 'Munnekollal, Kundalahalli, AECS Layout and Doddanekundi', 'Heavy traffic on the ORR and Varthur Road means frequent braking and overheating risk in summer.'),
]
PRICES = [('Basic service', 799), ('General service', 1299), ('Full service', 1999), ('Repair or problem check', 199), ('Roadside emergency', 349)]

def write(path, content):
    full = os.path.join(ROOT, path); os.makedirs(os.path.dirname(full), exist_ok=True)
    open(full, 'w', encoding='utf-8').write(content)

urls = [('/', '1.0')]
for slug, name, pins, locs, why in AREAS:
    url = f'{SITE}/bike-service-{slug}/'
    title = f'Doorstep Bike Service in {name}, Bengaluru | Mechanix Pro'
    desc = f'Bike and scooter service at your home or office in {name} ({pins}). Fixed prices from ₹799, genuine parts, 15-day warranty. Book on WhatsApp.'
    book = f'/?area={html.escape(name)}#build'
    faq = [
      (f'Do you come to my home in {name}?', f'Yes. Our mechanics cover {locs}. We service your bike at home, at your office parking or at the roadside.'),
      (f'How much is a bike service in {name}?', 'Basic service ₹799, General ₹1,299, Full ₹1,999 for bikes up to 180cc; above 180cc add ₹300. GST included. Parts only after your approval.'),
      ('How fast can a mechanic reach me?', 'Scheduled services are done in your chosen slot. For breakdowns, use the Get help button and we send the nearest available mechanic.'),
    ]
    schema = '<script type="application/ld+json">' + json.dumps({
      "@context": "https://schema.org", "@type": "AutoRepair", "name": f"Mechanix Pro — {name}", "url": url,
      "image": f"{SITE}/assets/img/og.png", "telephone": "+91-XXXXXXXXXX", "priceRange": "₹199–₹1999",
      "areaServed": {"@type": "Place", "name": f"{name}, Bengaluru"},
      "address": {"@type": "PostalAddress", "addressLocality": "Bengaluru", "addressRegion": "Karnataka", "addressCountry": "IN"}}, ensure_ascii=False) + '</script>\n<script type="application/ld+json">' + json.dumps({
      "@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [{"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in faq]}, ensure_ascii=False) + '</script>'
    body = f'''<p class="breadcrumb"><a href="/">Home</a> › Bike service in {name}</p>
<h1 style="font-size:clamp(34px,6vw,52px)">Doorstep bike service in {name}.</h1>
<p class="muted" style="font-size:20px">Certified mechanics at your home or office across {locs}. Fixed prices, genuine parts, and nothing extra without your OK.</p>
<p><a class="btn btn-primary" href="{book}">Build your service</a> <a class="btn btn-ghost" href="#" data-wa="{html.escape(name)}">WhatsApp us</a></p>
<h2>Why riders in {name} service at home</h2>
<p>{why} Instead of losing half a day at a garage, a Mechanix Pro mechanic services your bike where it is parked, usually in 60 to 90 minutes.</p>
<h2>Prices in {name}</h2>
<div class="card">{''.join(f'<div class="price-row"><span>{n}</span><b>₹{p:,}</b></div>' for n, p in PRICES)}</div>
<p class="tiny muted" style="margin-top:8px">Bikes and scooters up to 180cc; above 180cc add ₹300 to service packages. GST included. Pincodes: {pins}.</p>
<h2>How it works</h2>
<ol><li>Build your service on the website and send it on WhatsApp.</li><li>We confirm your slot and send a secure link to pay ₹199 (adjusted in your bill).</li><li>The mechanic arrives, shows you any extra work, and starts only after your OK.</li></ol>
<h2>Questions from {name} riders</h2>
{''.join(f'<details><summary>{html.escape(q)}</summary><p>{html.escape(a)}</p></details>' for q, a in faq)}
<div class="final" style="margin-top:32px"><h2>Book a service in {name}.</h2><p>Takes under a minute.</p><a class="btn btn-primary" href="{book}">Build your service</a></div>
'''
    write(f'bike-service-{slug}/index.html', HEAD.format(title=html.escape(title), desc=html.escape(desc), url=url, site=SITE, schema=schema, book=book) + body + FOOT)
    urls.append((f'/bike-service-{slug}/', '0.8'))

LEGAL = {
 'privacy': ('Privacy Policy', 'How Mechanix Pro collects, uses and protects your personal data.', '''
<p class="muted">Last updated: [date]. This policy follows India's Digital Personal Data Protection Act, 2023.</p>
<h2>Who we are</h2><p>Mechanix Pro is operated by [Registered business name], [registered address], Bengaluru, Karnataka ("we", "us").</p>
<h2>What we collect</h2><ul><li>Name and mobile number; email if you give it.</li><li>Service details: area or address, bike brand, model, nickname and registration number, the service you choose, photos taken during inspection.</li><li>WhatsApp messages you send us about your booking.</li><li>Payment status from Razorpay. We never see or store your card or UPI PIN.</li><li>Basic technical data (device, browser, approximate location from IP) for security and to prevent misuse.</li></ul>
<h2>Why we use it</h2><p>To confirm and deliver your service, send booking updates and reminders on WhatsApp (only if you agree), process payments, give warranty support, prevent fraud and meet tax law. With your consent we may send offers; you can stop them anytime by replying STOP.</p>
<h2>Automated replies</h2><p>Some WhatsApp replies are written by an AI assistant trained on our services and prices. A team member reviews conversations and you can ask for a person at any time.</p>
<h2>Who we share it with</h2><p>Only as needed: the mechanic assigned to your job; service providers who process data for us — Supabase (database), Cloudflare (hosting and security), Meta (WhatsApp), Razorpay (payments), Anthropic (AI replies), Google (analytics, if enabled); and authorities where the law requires. We do not sell your data.</p>
<h2>How long we keep it</h2><p>Booking records and invoices for 8 years (tax law). Leads that do not become bookings are deleted or anonymised after 12 months. Chat logs for up to 24 months.</p>
<h2>Security</h2><p>Encrypted connections, access limited by role, bot and attack protection by Cloudflare, and audit logs of staff actions.</p>
<h2>Your rights</h2><p>You can ask to access, correct or delete your data, withdraw consent, or raise a complaint by writing to our Grievance Officer below. We respond within the time set by law.</p>
<h2>Grievance Officer</h2><p>[Name], [Registered business name], [address]. Email: support@mechanixpro.in</p>'''),
 'terms': ('Terms & Conditions', 'Terms for booking and using Mechanix Pro doorstep bike services.', '''
<p class="muted">Last updated: [date]. Draft — to be reviewed by a lawyer before launch.</p>
<h2>1. Service</h2><p>Mechanix Pro, operated by [Registered business name] (GSTIN [GSTIN]), provides two-wheeler service and repair at your location in our service areas in Bengaluru, through trained mechanics from our partner workshops.</p>
<h2>2. Booking</h2><p>You can request a booking on our website or WhatsApp. A booking is confirmed when we confirm your slot and you pay the booking advance (currently ₹199), which is adjusted in your final bill.</p>
<h2>3. Prices and extra work</h2><p>Listed prices include GST and cover the labour and items described for each package. Parts, oil above standard grade and work outside the package are charged only after you approve an itemised estimate.</p>
<h2>4. Payment</h2><p>Advance and final payments are made through Razorpay (UPI, cards, wallets, net banking) or as agreed with us. Invoices show GST separately.</p>
<h2>5. Cancellation</h2><p>See our <a href="/refund-policy/">Refund & Cancellation Policy</a>.</p>
<h2>6. Vehicle handover</h2><p>If your bike must go to a workshop, it leaves only after you share a one-time code with the mechanic, and returns the same way. Please remove valuables. Keep your registration and insurance documents valid.</p>
<h2>7. Warranty</h2><p>Labour is covered for 15 days from service. Parts carry the manufacturer's warranty. Accidents, misuse and work by others after our service are not covered.</p>
<h2>8. Your responsibilities</h2><p>Give accurate details, provide safe access to the vehicle, and be reachable during your slot. Abuse towards our staff may lead to cancellation.</p>
<h2>9. Liability</h2><p>We are liable for loss or damage caused by our negligence during service, up to the invoice value of that booking, except where the law does not allow such a limit. We are not liable for pre-existing defects or normal wear.</p>
<h2>10. Law</h2><p>These terms are governed by Indian law. Courts in Bengaluru, Karnataka have jurisdiction.</p>
<h2>11. Contact</h2><p>support@mechanixpro.in · <span data-phone>+91 XXXXX XXXXX</span></p>'''),
 'refund-policy': ('Refund & Cancellation Policy', 'How cancellations and refunds work for Mechanix Pro bookings.', '''
<p class="muted">Last updated: [date].</p>
<h2>Cancelling a booking</h2><ul><li><b>More than 2 hours before your slot:</b> free. Your ₹199 advance is refunded in full.</li><li><b>Less than 2 hours before, or after the mechanic has left:</b> the ₹199 advance covers the visit and is not refunded.</li><li><b>Emergency (SOS) visits:</b> cancellable free until a mechanic is assigned.</li></ul>
<h2>If we cancel</h2><p>If we cannot reach you in your slot, we offer another slot or a full refund — your choice.</p>
<h2>Service issues</h2><p>If something we fixed fails within 15 days, we redo the labour free. If we cannot fix it, we refund the labour charge for that item.</p>
<h2>How refunds are paid</h2><p>Refunds go to your original payment method through Razorpay within 5–7 working days of approval.</p>
<h2>Contact</h2><p>Write to support@mechanixpro.in or message us on WhatsApp with your booking reference.</p>'''),
 'contact': ('Contact Mechanix Pro', 'Reach Mechanix Pro for bookings, support and partnerships in Bengaluru.', '''
<p class="muted" style="font-size:20px">Fastest: message us on WhatsApp. We reply from 8 AM to 9 PM, every day.</p>
<p><a class="btn btn-wa" href="#" data-wa="Contact">Chat on WhatsApp</a></p>
<div class="card" style="margin-top:20px"><div class="price-row"><span>Phone</span><b data-phone>+91 XXXXX XXXXX</b></div><div class="price-row"><span>Email</span><b>support@mechanixpro.in</b></div><div class="price-row"><span>Areas</span><b>South-East Bengaluru</b></div></div>
<h2>Garage partners</h2><p>Run a two-wheeler workshop in Bengaluru and want more jobs? Email us with your garage name, area and number of mechanics.</p>
<p class="tiny muted">[Registered business name], [registered address], Bengaluru, Karnataka. GSTIN [GSTIN].</p>'''),
}
for slug, (title, desc, body) in LEGAL.items():
    url = f'{SITE}/{slug}/'
    write(f'{slug}/index.html', HEAD.format(title=html.escape(title + ' | Mechanix Pro'), desc=html.escape(desc), url=url, site=SITE, schema='', book='/#build') + f'<h1 style="font-size:40px">{title}</h1>\n' + body + FOOT)
    urls.append((f'/{slug}/', '0.3'))

sm = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + ''.join(f'  <url><loc>{SITE}{u}</loc><lastmod>{TODAY}</lastmod><priority>{p}</priority></url>\n' for u, p in urls) + '</urlset>\n'
write('sitemap.xml', sm)
print('Generated', len(urls), 'pages')
