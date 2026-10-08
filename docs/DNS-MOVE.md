# Moving mechanixpro.in from GoDaddy DNS to Cloudflare

Why: Cloudflare Pages can serve the bare domain (mechanixpro.in) only when Cloudflare holds the DNS.
Email (Google Workspace) and Resend must keep working, so every record below has to exist in Cloudflare **before** you change nameservers at GoDaddy.

## Records that must exist in Cloudflare (as read from GoDaddy DNS on 2026-10-08)
Set every mail-related record to **DNS only** (grey cloud), never proxied.

| Type | Name | Value |
|---|---|---|
| MX | @ | 1 aspmx.l.google.com, 5 alt1.aspmx.l.google.com, 5 alt2.aspmx.l.google.com, 10 alt3.aspmx.l.google.com, 10 alt4.aspmx.l.google.com |
| TXT | @ | v=spf1 include:dc-aa8e722993._spfm.mechanixpro.in ~all |
| TXT | @ | google-site-verification=ZRW6HEoTHhnO1Iwcp4pup4i4Y5Tv_gRVhNOjZ9-NHYM |
| TXT | dc-aa8e722993._spfm | v=spf1 include:_spf.google.com ~all |
| TXT | _dmarc | v=DMARC1; p=quarantine; adkim=r; aspf=r; rua=mailto:dmarc_rua@onsecureserver.net; |
| TXT | resend._domainkey | (the long p=MIGf... value shown in GoDaddy and in Resend → Domains) |
| CNAME / MX / TXT | send | exactly as in Resend → Domains (the send. records). Copy them from GoDaddy as they are. |
| CNAME | _domainconnect | _domainconnect.gd.domaincontrol.com (optional, GoDaddy helper) |

Any other records in the GoDaddy DNS list (for example a Google DKIM `google._domainkey`) must be copied too.

## Website records (added by Cloudflare when you attach the custom domains)
- mechanixpro.in and www.mechanixpro.in -> project mechanixpro-site
- admin.mechanixpro.in -> project mechanixpro-admin
Delete the old A record for @ (160.153.0.156) and the old www record when Cloudflare asks.

## Order
1. Cloudflare: Add a site -> mechanixpro.in -> Free plan. Let it scan.
2. Compare Cloudflare's imported list with the table and with GoDaddy's DNS page. Add anything missing.
3. GoDaddy: Domains -> mechanixpro.in -> DNS -> Nameservers -> Change -> enter Cloudflare's two nameservers.
4. Wait until Cloudflare says the site is Active (minutes to a few hours).
5. Cloudflare Pages: attach the three custom domains.
6. Then tell Claude. Remaining steps: SITE_URL secret, login email rebuild, allowed origins, live test.
