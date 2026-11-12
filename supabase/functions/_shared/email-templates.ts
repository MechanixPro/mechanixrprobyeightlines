import { COMPANY, companyLine } from './company.ts';
import type { Invoice } from './invoice.ts';
// Mechanix Pro email designs. Pure functions (no Deno APIs) so Node can test them.
// Layout: 600px table, navy header with the logo, white card, ember button, plain business footer. Inline CSS only, as email apps require.
export const escapeHtml = (v: unknown): string => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
const rupee = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');
const NAVY = '#14295A', EMBER = '#F2801F', INK = '#101828', MUTED = '#5E687A', LINE = '#D8DEE9', PAGE = '#F2F4F8', WA = '#25D366';
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";

export type Site = { siteUrl: string; phoneDisplay: string; phoneTel: string; whatsappUrl: string; email: string };
type Mail = { subject: string; html: string; text: string };

function button(label: string, href: string, bg = EMBER, fg = '#1F1206'): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="display:inline-block;margin:0 8px 8px 0"><tr><td bgcolor="${bg}" style="border-radius:999px"><a href="${escapeHtml(href)}" style="display:inline-block;padding:14px 26px;font:700 16px ${FONT};color:${fg};text-decoration:none;border-radius:999px">${escapeHtml(label)}</a></td></tr></table>`;
}
function rows(pairs: Array<[string, string]>): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid ${LINE};margin:20px 0">${pairs.map(([k, v]) => `<tr><td style="padding:12px 0;border-bottom:1px solid ${LINE};font:14px ${FONT};color:${MUTED};width:38%;vertical-align:top">${escapeHtml(k)}</td><td style="padding:12px 0;border-bottom:1px solid ${LINE};font:600 15px ${FONT};color:${INK};vertical-align:top">${escapeHtml(v)}</td></tr>`).join('')}</table>`;
}
const p = (t: string) => `<p style="margin:0 0 16px;font:16px/1.55 ${FONT};color:${INK}">${t}</p>`;
const h1 = (t: string) => `<h1 style="margin:0 0 14px;font:700 26px/1.2 ${FONT};color:${INK};letter-spacing:-0.4px">${escapeHtml(t)}</h1>`;

function layout(o: { preheader: string; title: string; body: string; site: Site; links?: boolean; footerNote?: string }): string {
  const { site } = o, links = o.links !== false;
  const contact = links
    ? `<a href="mailto:${escapeHtml(site.email)}" style="color:${MUTED};text-decoration:underline">${escapeHtml(site.email)}</a> &nbsp;·&nbsp; <a href="tel:${escapeHtml(site.phoneTel)}" style="color:${MUTED};text-decoration:underline">${escapeHtml(site.phoneDisplay)}</a>`
    : `${escapeHtml(site.email)} &nbsp;·&nbsp; ${escapeHtml(site.phoneDisplay)}`;
  return `<!doctype html>
<html lang="en-IN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><title>${escapeHtml(o.title)}</title></head>
<body style="margin:0;padding:0;background:${PAGE}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all">${escapeHtml(o.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PAGE}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:20px;overflow:hidden">
<tr><td bgcolor="#ffffff" style="padding:22px 32px;border-bottom:6px solid ${EMBER}"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="vertical-align:middle"><img src="${escapeHtml(site.siteUrl)}/assets/img/email-logo.png" width="40" height="42" alt="Mechanix Pro" style="display:block;border:0"></td><td style="padding-left:12px;vertical-align:middle"><img src="${escapeHtml(site.siteUrl)}/assets/img/email-wordmark.png" width="170" height="15" alt="MECHANIX PRO" style="display:block;border:0"></td></tr></table></td></tr>
<tr><td style="padding:32px">${o.body}</td></tr>
<tr><td style="padding:20px 32px 28px;border-top:1px solid ${LINE};background:#FAFBFD"><p style="margin:0 0 6px;font:13px/1.5 ${FONT};color:${MUTED}">Mechanix Pro · Doorstep bike service, Bengaluru</p><p style="margin:0 0 6px;font:12px/1.5 ${FONT};color:${MUTED}">${escapeHtml(companyLine())} · GSTIN ${escapeHtml(COMPANY.gstin)}</p><p style="margin:0;font:13px/1.5 ${FONT};color:${MUTED}">${contact}</p>${o.footerNote ? `<p style="margin:12px 0 0;font:12px/1.5 ${FONT};color:${MUTED}">${o.footerNote}</p>` : ''}</td></tr>
<tr><td height="8" bgcolor="${NAVY}" style="height:8px;font-size:0;line-height:0;border-top:3px solid ${EMBER}">&nbsp;</td></tr>
</table></td></tr></table></body></html>`;
}
// The customer's own build, shown back to them: their bike's name, the package and the price. Edit link opens the booking form with it filled in.
function buildCard(d: { bike: string; service: string; estimate?: number | null; buildUrl?: string | null }): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 22px"><tr><td bgcolor="${NAVY}" style="border-radius:18px;padding:20px 22px">
<p style="margin:0 0 4px;font:600 12px ${FONT};letter-spacing:1.2px;text-transform:uppercase;color:#FFC38A">Your package for</p>
<p style="margin:0 0 10px;font:700 22px/1.25 ${FONT};color:#ffffff">${escapeHtml(d.bike)}</p>
<p style="margin:0;font:15px/1.5 ${FONT};color:#D5DDF0">${escapeHtml(d.service)}${d.estimate ? ` &nbsp;·&nbsp; from <b style="color:#ffffff">${rupee(d.estimate)}</b>, excluding GST` : ''}</p>
${d.buildUrl ? `<p style="margin:14px 0 0"><a href="${escapeHtml(d.buildUrl)}" style="font:700 14px ${FONT};color:#FFC38A;text-decoration:underline">Edit your build</a></p>` : ''}
</td></tr></table>`;
}
const first = (name: string) => escapeHtml(String(name || 'there').trim().split(/\s+/)[0] || 'there');
const firstText = (name: string) => String(name || 'there').trim().split(/\s+/)[0] || 'there';

// ref is the booking ID (MP-yy-yy-####). A request that is not confirmed yet has none, so every template leaves the line out instead of showing a private ref.
export type BookingData = Site & { checkupFee?: number | null; newCustomer?: boolean; nick?: string | null; buildUrl?: string | null; name: string; ref?: string | null; bike: string; service: string; area: string; whenText: string; estimate: number };

const step = (n: number, t: string) => `<tr><td style="padding:5px 12px 5px 0;font:700 15px ${FONT};color:${EMBER};vertical-align:top">${n}</td><td style="padding:5px 0;font:15px/1.5 ${FONT};color:${INK}">${t}</td></tr>`;
const tick = (t: string) => `<tr><td style="padding:4px 10px 4px 0;font:700 15px ${FONT};color:${EMBER};vertical-align:top">&#10003;</td><td style="padding:4px 0;font:15px/1.5 ${FONT};color:${INK}">${t}</td></tr>`;
const heading = (t: string) => `<p style="margin:22px 0 8px;font:700 16px ${FONT};color:${INK}">${escapeHtml(t)}</p>`;

// The one email a customer gets when they book. It explains the journey, the slot fee and how their money is protected, and states only true things.
export function bookingReceived(d: BookingData): Mail {
  const subject = `We got your request${d.ref ? ' ' + d.ref : ''}`;
  const fee = d.checkupFee ? rupee(d.checkupFee) : null;
  const feeLine = fee
    ? (d.newCustomer
      ? `Because this is your first booking with us, the slot fee is only <b>${fee}</b>. It is asked for only after you approve the quote.`
      : `The <b>${fee}</b> checkup and quote fee is asked for only after you approve the quote.`)
    : 'The slot fee is asked for only after you approve the quote.';
  const feeText = fee
    ? (d.newCustomer ? `Because this is your first booking with us, the slot fee is only ${fee}. It is asked for only after you approve the quote.` : `The ${fee} checkup and quote fee is asked for only after you approve the quote.`)
    : 'The slot fee is asked for only after you approve the quote.';
  const body = `${h1(`Thanks, ${firstText(d.name)}. We got your request.`)}
${p('Our expert will check what your bike needs and send you a quote on WhatsApp. Nothing starts, and nothing is charged, until you approve it.')}
${buildCard(d)}
${rows([...(d.ref ? [['Reference', d.ref] as [string, string]] : []), ['Bike', d.bike], ['Service', d.service], ['Area', d.area], ['Preferred time', d.whenText], ['Starting estimate', rupee(d.estimate) + ', excluding GST']])}
${heading('What happens next')}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 6px">
${step(1, 'Our expert calls or messages you to confirm what is needed, and whether it can be done at your door.')}
${step(2, 'You get an itemised quote on WhatsApp. It is quote first: parts are fitted and work starts only after you approve.')}
${step(3, 'You approve, and we lock your slot with a small fee. A Mechanix Pro-certified mechanic then comes to you.')}
${step(4, 'After the service you get a GST invoice, and our 30-day service warranty starts.')}
</table>
${heading('The slot fee, explained')}
${p(`${feeLine} It is adjusted in your final bill if you go ahead with the service.`)}
${heading('How your money is protected')}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 6px">
${tick('Cancel more than 2 hours before your slot and the fee is refunded in full.')}
${tick('You pay securely on Razorpay (UPI, cards, wallets, net banking). We never see your card details.')}
${tick('We never ask for your card number, PIN or OTP on chat, call or email.')}
${tick('Any extra work is shown to you first and starts only after your approval.')}
</table>
${heading('What you can count on')}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px">
${tick('Mechanix Pro-certified mechanics')}${tick('OEM and aftermarket parts, fitted after you approve')}${tick('30-day warranty on our service work')}${tick('OTP-safe handover: your bike leaves for a workshop only after you share a one-time code')}${tick('A GST invoice for every job')}
</table>
${p(`Questions? Message us on WhatsApp or call, any time. We are open 24/7. Full terms: <a href="${escapeHtml(d.siteUrl)}/refund-policy/" style="color:${NAVY}">refund policy</a>.`)}
${button('Chat on WhatsApp', d.whatsappUrl, WA, '#063B1C')}${button('Call us', 'tel:' + d.phoneTel, NAVY, '#ffffff')}`;
  const text = `Thanks, ${firstText(d.name)}. We got your request.\n\nOur expert will check what your bike needs and send you a quote on WhatsApp. Nothing starts, and nothing is charged, until you approve it.\n\nYour package for ${d.bike}${d.buildUrl ? `\nEdit your build: ${d.buildUrl}` : ''}\n\n${d.ref ? `Reference: ${d.ref}\n` : ''}Bike: ${d.bike}\nService: ${d.service}\nArea: ${d.area}\nPreferred time: ${d.whenText}\nStarting estimate: ${rupee(d.estimate)}, excluding GST\n\nWhat happens next\n1. Our expert calls or messages you to confirm what is needed.\n2. You get an itemised quote on WhatsApp. Quote first: work starts only after you approve.\n3. You approve, and we lock your slot with a small fee. A Mechanix Pro-certified mechanic then comes to you.\n4. After the service you get a GST invoice, and our 30-day service warranty starts.\n\nThe slot fee, explained\n${feeText} It is adjusted in your final bill if you go ahead with the service.\n\nHow your money is protected\n- Cancel more than 2 hours before your slot and the fee is refunded in full.\n- You pay securely on Razorpay. We never see your card details.\n- We never ask for your card number, PIN or OTP on chat, call or email.\n- Extra work is shown to you first and starts only after your approval.\n\nWhat you can count on: Mechanix Pro-certified mechanics, OEM and aftermarket parts, 30-day service warranty, OTP-safe handover, a GST invoice for every job.\n\nWhatsApp: ${d.whatsappUrl}\nCall: ${d.phoneDisplay}`;
  return { subject, html: layout({ preheader: 'Your quote comes on WhatsApp. Nothing starts until you approve it.', title: subject, body, site: d }), text };
}

export type PaymentLinkData = Site & { name: string; ref?: string | null; amount: number; payUrl: string };
export function paymentLinkEmail(d: PaymentLinkData): Mail {
  const subject = d.ref ? `Pay ${rupee(d.amount)} to confirm booking ${d.ref}` : `Pay ${rupee(d.amount)} to lock your slot`;
  const body = `${h1(`Your secure payment link, ${firstText(d.name)}.`)}
${p(`Please pay <b>${rupee(d.amount)}</b> for ${d.ref ? `booking <b>${escapeHtml(d.ref)}</b>` : 'your request'} to lock your slot. It is adjusted in your final bill if you go ahead with the service.`)}
${button('Pay securely', d.payUrl)}
${p('You can pay by UPI, card, wallet or net banking on Razorpay. We never ask for your card number, PIN or OTP on chat, call or email.')}
${button('Chat on WhatsApp', d.whatsappUrl, WA, '#063B1C')}${button('Call us', 'tel:' + d.phoneTel, NAVY, '#ffffff')}`;
  const text = `Your secure payment link, ${firstText(d.name)}.\n\nPlease pay ${rupee(d.amount)} for ${d.ref ? `booking ${d.ref}` : 'your request'} to lock your slot. It is adjusted in your final bill if you go ahead.\n\nPay securely: ${d.payUrl}\n\nWe never ask for your card number, PIN or OTP on chat, call or email.\n\nWhatsApp: ${d.whatsappUrl}\nCall: ${d.phoneDisplay}`;
  return { subject, html: layout({ preheader: d.ref ? `Pay ${rupee(d.amount)} for ${d.ref}` : `Pay ${rupee(d.amount)} to lock your slot`, title: subject, body, site: d }), text };
}

export type ConfirmedData = BookingData & { mechanicName?: string | null; amountDue?: number | null };
export function bookingConfirmed(d: ConfirmedData): Mail {
  const subject = `Your service is confirmed${d.ref ? ' ' + d.ref : ''}`;
  const pairs: Array<[string, string]> = [...(d.ref ? [['Reference', d.ref] as [string, string]] : []), ['Bike', d.bike], ['Service', d.service], ['When', d.whenText], ['Where', d.area]];
  if (d.mechanicName) pairs.push(['Your mechanic', d.mechanicName]);
  if (d.amountDue) pairs.push(['Amount due', rupee(d.amountDue)]);
  const body = `${h1(`You're all set, ${firstText(d.name)}.`)}
${p('Your slot is confirmed. Please keep your bike easy to reach and be available by phone around the time. Any extra work is shown to you first and starts only after your approval.')}
${buildCard({ bike: d.bike, service: d.service, buildUrl: d.buildUrl })}
${rows(pairs)}
${button('Chat on WhatsApp', d.whatsappUrl, WA, '#063B1C')}${button('Call us', 'tel:' + d.phoneTel, NAVY, '#ffffff')}`;
  const text = `You're all set, ${firstText(d.name)}.\n\nYour slot is confirmed. Any extra work is shown to you first and starts only after your approval.\n\nYour package for ${d.bike}${d.buildUrl ? `\nEdit your build: ${d.buildUrl}` : ''}\n\n${pairs.map(([k, v]) => `${k}: ${v}`).join('\n')}\n\nWhatsApp: ${d.whatsappUrl}\nCall: ${d.phoneDisplay}\n\nMechanix Pro, Bengaluru · ${d.email}`;
  return { subject, html: layout({ preheader: `Confirmed: ${d.whenText}`, title: subject, body, site: d }), text };
}

export function otpCode(d: Site & { code: string; minutes: number }): Mail {
  const subject = 'Your Mechanix Pro login code';
  const body = `${h1('Your login code')}
${p('Enter this code to sign in to the Mechanix Pro admin.')}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 22px"><tr><td bgcolor="#F2F4F8" style="padding:18px 28px;border-radius:14px;border:1px solid ${LINE};font:700 34px ${FONT};letter-spacing:10px;color:${NAVY}">${escapeHtml(d.code)}</td></tr></table>
${p(`This code works for ${d.minutes} minutes and only once.`)}
<p style="margin:0;font:14px/1.5 ${FONT};color:${MUTED}">If you did not request this code, ignore this email and nobody can sign in. Never share this code with anyone, including Mechanix Pro staff.</p>`;
  const text = `Your Mechanix Pro login code: ${d.code}\n\nThis code works for ${d.minutes} minutes and only once.\n\nIf you did not request this code, ignore this email. Never share this code with anyone.\n\nMechanix Pro, Bengaluru · ${d.email}`;
  return { subject, html: layout({ preheader: `Your login code is ${d.code}. It works for ${d.minutes} minutes.`, title: subject, body, site: d, links: false }), text };
}

export function passwordReset(d: Site & { link: string; minutes: number }): Mail {
  const subject = 'Reset your Mechanix Pro admin password';
  const body = `${h1('Reset your password')}
${p('We got a request to reset the password for your Mechanix Pro admin account. Tap the button to choose a new one.')}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 22px"><tr><td bgcolor="${EMBER}" style="border-radius:999px"><a href="${escapeHtml(d.link)}" style="display:inline-block;padding:14px 28px;font:700 16px ${FONT};color:#1F1206;text-decoration:none">Choose a new password</a></td></tr></table>
${p(`This link works for ${d.minutes} minutes and only once.`)}
<p style="margin:0;font:14px/1.5 ${FONT};color:${MUTED}">If you did not ask for this, ignore this email and your password stays as it is. Never share this link with anyone, including Mechanix Pro staff.</p>`;
  const text = `Reset your Mechanix Pro admin password\n\nOpen this link to choose a new password (it works for ${d.minutes} minutes and only once):\n${d.link}\n\nIf you did not ask for this, ignore this email. Never share this link with anyone.\n\nMechanix Pro, Bengaluru · ${d.email}`;
  return { subject, html: layout({ preheader: `Choose a new password. The link works for ${d.minutes} minutes.`, title: subject, body, site: d, links: false }), text };
}

export type MarketingData = Site & { subject: string; preheader: string; headline: string; body: string; ctaText: string; ctaUrl: string; unsubscribeUrl: string };
export function marketing(d: MarketingData): Mail {
  const paras = String(d.body || '').split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean);
  const body = `${h1(d.headline)}
${paras.map((x) => p(escapeHtml(x).replace(/\n/g, '<br>'))).join('\n')}
${d.ctaText && d.ctaUrl ? `<div style="margin:24px 0 4px">${button(d.ctaText, d.ctaUrl)}</div>` : ''}`;
  const note = `You are receiving this because you asked for offers from Mechanix Pro. <a href="${escapeHtml(d.unsubscribeUrl)}" style="color:${MUTED};text-decoration:underline">Unsubscribe</a> any time.`;
  const text = `${d.headline}\n\n${paras.join('\n\n')}\n\n${d.ctaText && d.ctaUrl ? `${d.ctaText}: ${d.ctaUrl}\n\n` : ''}You are receiving this because you asked for offers from Mechanix Pro. Unsubscribe: ${d.unsubscribeUrl}\n\nMechanix Pro, Bengaluru · ${d.email}`;
  return { subject: d.subject, html: layout({ preheader: d.preheader, title: d.subject, body, site: d, footerNote: note }), text };
}

export type ServiceDueData = Site & { name: string; bike: string; lastService?: string | null; buildUrl: string; unsubscribeUrl: string };
export function serviceDue(d: ServiceDueData): Mail {
  const subject = 'Time for your next bike service';
  const body = `${h1(`Hi ${firstText(d.name)}, ${d.bike} may be due a service.`)}
${p(`It has been a while since${d.lastService ? ` your ${escapeHtml(d.lastService)}` : ' your last Mechanix Pro service'}. A regular service keeps your bike safe, smooth and cheaper to run. You asked us to remind you, so here we are.`)}
${buildCard({ bike: d.bike, service: d.lastService || 'Your last package', buildUrl: d.buildUrl })}
${p('Open your build, change anything you like, and send it on WhatsApp. You get a quote first and nothing starts until you approve it.')}
${button('Book the next service', d.buildUrl)}${button('Chat on WhatsApp', d.whatsappUrl, WA, '#063B1C')}`;
  const note = `You are receiving this because you asked us to remind you when your next service is due. <a href="${escapeHtml(d.unsubscribeUrl)}" style="color:${MUTED};text-decoration:underline">Unsubscribe</a> any time.`;
  const text = `Hi ${firstText(d.name)}, ${d.bike} may be due a service.\n\nIt has been a while since ${d.lastService ? `your ${d.lastService}` : 'your last Mechanix Pro service'}. You asked us to remind you.\n\nBook the next service: ${d.buildUrl}\nWhatsApp: ${d.whatsappUrl}\n\nYou asked us to remind you when your next service is due. Unsubscribe: ${d.unsubscribeUrl}\n\nMechanix Pro, Bengaluru · ${d.email}`;
  return { subject, html: layout({ preheader: 'Your reminder from Mechanix Pro. Quote first, work after your OK.', title: subject, body, site: d, footerNote: note }), text };
}

const inr2 = (n: number) => '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export type InvoiceMailData = Site & { invoice: Invoice; company: { legalName: string; addressLines: string[]; city: string; state: string; pincode: string; gstin: string } };
export function invoiceEmail(d: InvoiceMailData): Mail {
  const v = d.invoice, c = d.company;
  const subject = `Your Mechanix Pro invoice ${v.number}`;
  const addr = [...c.addressLines, [c.city, c.state, c.pincode].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const line = (k: string, val: string, bold = false) => `<tr><td style="padding:8px 0;font:${bold ? '700 16px' : '14px'} ${FONT};color:${bold ? INK : MUTED}">${escapeHtml(k)}</td><td align="right" style="padding:8px 0;font:${bold ? '700 16px' : '600 15px'} ${FONT};color:${INK}">${val}</td></tr>`;
  const items = v.lines.map((l, i) => `<tr><td style="padding:12px 0;border-bottom:1px solid ${LINE};font:15px ${FONT};color:${INK}">${i + 1}. ${escapeHtml(l.name)}${l.code ? ` <span style="color:${MUTED};font-size:12px">(${escapeHtml(l.code)})</span>` : ''}</td><td align="right" style="padding:12px 0;border-bottom:1px solid ${LINE};font:600 15px ${FONT};color:${INK}">${inr2(l.amount)}</td></tr>`).join('')
    + (v.couponDiscount ? `<tr><td style="padding:12px 0;border-bottom:1px solid ${LINE};font:15px ${FONT};color:${INK}">Coupon discount</td><td align="right" style="padding:12px 0;border-bottom:1px solid ${LINE};font:600 15px ${FONT};color:${INK}">− ${inr2(v.couponDiscount)}</td></tr>` : '')
    + (v.extraDiscount ? `<tr><td style="padding:12px 0;border-bottom:1px solid ${LINE};font:15px ${FONT};color:${INK}">Special discount${v.extraNote ? ` (${escapeHtml(v.extraNote)})` : ''}</td><td align="right" style="padding:12px 0;border-bottom:1px solid ${LINE};font:600 15px ${FONT};color:${INK}">− ${inr2(v.extraDiscount)}</td></tr>` : '');
  const body = `${h1('Your invoice')}
${p(`Hi ${first(v.customer.name)}, here is the invoice for booking <b>${escapeHtml(v.ref)}</b>. Invoice <b>${escapeHtml(v.number)}</b>, dated ${escapeHtml(v.dateLabel)}.`)}
${v.vehicle?.reg ? p(`Vehicle <b>${escapeHtml(v.vehicle.reg)}</b>${v.vehicle.label ? ` (${escapeHtml(v.vehicle.label)})` : ''}.`) : ''}
${v.customer.company || v.customer.gstin ? p(`Billed to <b>${escapeHtml(v.customer.company || v.customer.name)}</b>${v.customer.gstin ? `, GSTIN ${escapeHtml(v.customer.gstin)}` : ''}.`) : ''}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 6px"><tr><td style="font:600 12px ${FONT};letter-spacing:1px;text-transform:uppercase;color:${MUTED};padding-bottom:6px;border-bottom:2px solid ${EMBER}">Item</td><td align="right" style="font:600 12px ${FONT};letter-spacing:1px;text-transform:uppercase;color:${MUTED};padding-bottom:6px;border-bottom:2px solid ${EMBER}">Amount (${v.basis === 'excl' ? 'excl.' : 'incl.'} GST)</td></tr>${items}</table>
<table role="presentation" width="60%" align="right" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 18px">${line('Taxable value', inr2(v.taxable))}${v.gstRate ? line(`CGST @ ${v.gstRate / 2}%`, inr2(v.cgst)) + line(`SGST @ ${v.gstRate / 2}%`, inr2(v.sgst)) : ''}${line('Total', inr2(v.total), true)}${v.paid ? line('Paid so far', inr2(v.paid)) + line('Balance due', inr2(v.balance), true) : ''}${v.refund ? line('Refund due to you', inr2(v.refund), true) : ''}</table>
<div style="clear:both"></div>
<p style="margin:18px 0 6px;font:13px/1.55 ${FONT};color:${MUTED}">Issued by <b>${escapeHtml(c.legalName)}</b> (trading as Mechanix Pro), ${escapeHtml(addr)}. GSTIN ${escapeHtml(c.gstin)}. ${!v.gstRate ? 'No GST is charged on this invoice.' : v.basis === 'excl' ? `Amounts are before GST. GST is added at ${v.gstRate}% and shown in the totals.` : `Prices include ${v.gstRate}% GST.`} Parts are OEM or aftermarket, as labelled on the invoice, and carry a limited warranty on the terms of the part's manufacturer or supplier. Work is done by Mechanix Pro certified mechanics and every service carries a 30-day service warranty.</p>
${button('Chat on WhatsApp', d.whatsappUrl, WA, '#063B1C')}${button('Call us', 'tel:' + d.phoneTel, NAVY, '#ffffff')}`;
  const text = `Your invoice ${v.number} (${v.dateLabel}) for booking ${v.ref}\n\n${v.lines.map((l, i) => `${i + 1}. ${l.name}${l.code ? ` (${l.code})` : ''}: ${inr2(l.amount)}`).join('\n')}${v.couponDiscount ? `\nCoupon discount: -${inr2(v.couponDiscount)}` : ''}${v.extraDiscount ? `\nSpecial discount${v.extraNote ? ` (${v.extraNote})` : ''}: -${inr2(v.extraDiscount)}` : ''}\n\nTaxable value: ${inr2(v.taxable)}${v.gstRate ? `\nCGST @ ${v.gstRate / 2}%: ${inr2(v.cgst)}\nSGST @ ${v.gstRate / 2}%: ${inr2(v.sgst)}` : ''}\nTotal: ${inr2(v.total)}${v.paid ? `\nPaid so far: ${inr2(v.paid)}\nBalance due: ${inr2(v.balance)}` : ''}${v.refund ? `\nRefund due to you: ${inr2(v.refund)}` : ''}\n\nIssued by ${c.legalName} (Mechanix Pro), ${addr}. GSTIN ${c.gstin}. ${!v.gstRate ? 'No GST is charged on this invoice.' : v.basis === 'excl' ? `Amounts are before GST. GST is added at ${v.gstRate}% and shown in the totals.` : `Prices include ${v.gstRate}% GST.`}\n\nWhatsApp: ${d.whatsappUrl}\nCall: ${d.phoneDisplay}`;
  return { subject, html: layout({ preheader: `Invoice ${v.number}: total ${inr2(v.total)}`, title: subject, body, site: d }), text };
}

export type PickupData = Site & { name: string; ref?: string | null; bike: string; reg?: string | null; service: string; mechanicName?: string | null };
/** Sent when the team collects the customer's vehicle for service. */
export function vehiclePickedUp(d: PickupData): Mail {
  const subject = `Your ${d.bike} has been picked up${d.ref ? ' ' + d.ref : ''}`;
  const pairs: Array<[string, string]> = [...(d.ref ? [['Reference', d.ref] as [string, string]] : []), ['Vehicle', d.bike + (d.reg ? ` (${d.reg})` : '')], ['Service', d.service]];
  if (d.mechanicName) pairs.push(['Your mechanic', d.mechanicName]);
  const body = `${h1(`We have your ${escapeHtml(d.bike)}, ${firstText(d.name)}.`)}
${p('Your vehicle has been picked up by the Mechanix Pro team and is on its way for service. We will share an update and the quote for any extra work before we start it. Nothing extra is done without your approval.')}
${rows(pairs)}
${button('Chat on WhatsApp', d.whatsappUrl, WA, '#063B1C')}${button('Call us', 'tel:' + d.phoneTel, NAVY, '#ffffff')}`;
  const text = `We have your ${d.bike}, ${firstText(d.name)}.\n\nYour vehicle has been picked up by the Mechanix Pro team and is on its way for service. We will share an update and the quote for any extra work before we start it.\n\n${d.ref ? `Reference: ${d.ref}\n` : ''}Vehicle: ${d.bike}${d.reg ? ' (' + d.reg + ')' : ''}\nService: ${d.service}${d.mechanicName ? '\nYour mechanic: ' + d.mechanicName : ''}\n\nWhatsApp: ${d.whatsappUrl}\nCall: ${d.phoneDisplay}`;
  return { subject, html: layout({ preheader: d.ref ? `Picked up for service: ${d.ref}` : 'Picked up for service', title: subject, body, site: d }), text };
}

// Sent once payment of the confirmation fee is verified. Carries the address we captured, the slot, the fee and what it is adjusted against, the secret tracking link and the customer's door code.
export type PaidConfirmationData = Site & {
  name: string; ref?: string | null; vehicle: 'bike' | 'car'; vehicleName: string; service: string; address: string; whenText: string;
  amount: number; gstBase: number; gst: number; trackUrl: string; code?: string | null;
};
export const DOOR_CODE_LINE = 'Give this code to the mechanic when they arrive. Do not share it before.';
export function paidConfirmation(d: PaidConfirmationData): Mail {
  const subject = `Your slot is confirmed${d.ref ? ' ' + d.ref : ''}`;
  const money = (n: number) => '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pairs: Array<[string, string]> = [...(d.ref ? [['Booking ID', d.ref] as [string, string]] : []), [d.vehicle === 'car' ? 'Car' : 'Bike', d.vehicleName], ['Service', d.service], ['Address', d.address], ['Slot', d.whenText],
    ['Paid', `${rupee(d.amount)} (${money(d.gstBase)} + ${money(d.gst)} GST)`], ['Adjusted against', 'your final bill']];
  const codeBlock = d.code ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 10px"><tr><td bgcolor="#F2F4F8" style="padding:16px 26px;border-radius:14px;border:1px solid ${LINE};font:700 34px ${FONT};letter-spacing:10px;color:${NAVY}">${escapeHtml(d.code)}</td></tr></table>
<p style="margin:0 0 18px;font:700 15px/1.5 ${FONT};color:${INK}">${DOOR_CODE_LINE}</p>` : '';
  const body = `${h1(`Your slot is confirmed, ${firstText(d.name)}.`)}
${p(`We got your confirmation fee. Your mechanic will come to the address below. You see an itemised quote first, and nothing starts without your OK and your code.`)}
${rows(pairs)}
${heading('Your code')}${codeBlock || p('Your code is on your tracking page.')}
${button('Track your booking', d.trackUrl, EMBER, '#1F1206')}${button('Chat on WhatsApp', d.whatsappUrl, WA, '#063B1C')}
<p style="margin:18px 0 0;font:13px/1.5 ${FONT};color:${MUTED}">This tracking link is private to you. Do not forward this email: it holds your code.</p>`;
  const text = `Your slot is confirmed, ${firstText(d.name)}.\n\n${pairs.map(([k, v]) => `${k}: ${v}`).join('\n')}\n\n${d.code ? `Your code: ${d.code}\n${DOOR_CODE_LINE}\n\n` : ''}Track your booking: ${d.trackUrl}\n\nYou see an itemised quote first. Nothing starts without your OK and your code. The fee is adjusted against your final bill.\n\nMechanix Pro, Bengaluru · ${d.email}`;
  return { subject, html: layout({ preheader: `Confirmed: ${d.whenText}`, title: subject, body, site: d }), text };
}

// Receipt for the confirmation fee (an advance). Same layout and company block as the invoice email; GST shown separately; says it is adjusted in the final bill.
export type FeeReceiptData = Site & { name: string; ref?: string | null; number: string; dateLabel: string; amount: number; gstBase: number; gst: number; vehicleName: string; service: string; company: InvoiceMailData['company'] };
export function feeReceipt(d: FeeReceiptData): Mail {
  const c = d.company, addr = [...c.addressLines, [c.city, c.state, c.pincode].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const inr = (n: number) => '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const cgst = Math.round((d.gst / 2) * 100) / 100, sgst = Math.round((d.gst - cgst) * 100) / 100;
  const subject = `Receipt for your confirmation fee${d.ref ? ' ' + d.ref : ''}`;
  const line = (k: string, v: string, bold = false) => `<tr><td style="padding:8px 0;font:${bold ? '700 16px' : '14px'} ${FONT};color:${bold ? INK : MUTED}">${escapeHtml(k)}</td><td align="right" style="padding:8px 0;font:${bold ? '700 16px' : '600 15px'} ${FONT};color:${INK}">${escapeHtml(v)}</td></tr>`;
  const body = `${h1('Receipt for your confirmation fee')}
${p(`Hi ${first(d.name)}, we received your confirmation fee${d.ref ? ' for booking <b>' + escapeHtml(d.ref) + '</b>' : ''}. Receipt <b>${escapeHtml(d.number)}</b>, dated ${escapeHtml(d.dateLabel)}.`)}
${p(`${escapeHtml(d.vehicleName)} · ${escapeHtml(d.service)}`)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:2px solid ${EMBER};margin:6px 0 18px">${line('Confirmation fee (taxable value)', inr(d.gstBase))}${line('CGST @ 9%', inr(cgst))}${line('SGST @ 9%', inr(sgst))}${line('Total paid', inr(d.amount), true)}</table>
<p style="margin:0 0 16px;font:700 15px/1.5 ${FONT};color:${INK}">This fee is adjusted in your final bill.</p>
<p style="margin:18px 0 6px;font:13px/1.55 ${FONT};color:${MUTED}">Issued by <b>${escapeHtml(c.legalName)}</b> (trading as Mechanix Pro), ${escapeHtml(addr)}. GSTIN ${escapeHtml(c.gstin)}. The amount includes 18% GST. This is a receipt for an advance; your tax invoice follows when the job is done.</p>
${button('Chat on WhatsApp', d.whatsappUrl, WA, '#063B1C')}`;
  const text = `Receipt for your confirmation fee ${d.number} (${d.dateLabel})\n\nConfirmation fee (taxable value): ${inr(d.gstBase)}\nCGST @ 9%: ${inr(cgst)}\nSGST @ 9%: ${inr(sgst)}\nTotal paid: ${inr(d.amount)}\n\nThis fee is adjusted in your final bill.\n\nIssued by ${c.legalName} (trading as Mechanix Pro), ${addr}. GSTIN ${c.gstin}.`;
  return { subject, html: layout({ preheader: `Receipt ${d.number}: ${inr(d.amount)} paid`, title: subject, body, site: d }), text };
}

// The itemised quote the customer approves on the tracking page. GST shown separately, the confirmation fee shown as already paid, the balance, and the estimated delivery.
/** Genuine Parts Promise: a part line says Genuine or Equivalent. */
const partTypeSuffix = (l: { kind: string; part_type?: string }) => (l.kind === 'parts' && l.part_type === 'genuine' ? ', Genuine' : l.kind === 'parts' && l.part_type === 'equivalent' ? ', Equivalent' : '');
export type QuoteMailData = Site & { name: string; ref?: string | null; version: number; lines: { kind: string; name: string; amount: number; part_type?: string }[]; subtotal: number; gst: number; total: number; feeCredit: number; balance: number; etaText: string; trackUrl: string; revised?: boolean };
export function quoteMail(d: QuoteMailData): Mail {
  const inr = (n: number) => '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const subject = `${d.revised ? 'Revised quote' : 'Your quote'}${d.ref ? ' ' + d.ref : ''}: approve to start the work`;
  const KIND: Record<string, string> = { parts: 'Parts', labour: 'Labour', other: 'Other' };
  const items = d.lines.map((l) => `<tr><td style="padding:10px 0;border-bottom:1px solid ${LINE};font:15px ${FONT};color:${INK}">${escapeHtml(l.name)} <span style="color:${MUTED};font-size:12px">${escapeHtml((KIND[l.kind] ?? l.kind) + partTypeSuffix(l))}</span></td><td align="right" style="padding:10px 0;border-bottom:1px solid ${LINE};font:600 15px ${FONT};color:${INK}">${inr(l.amount)}</td></tr>`).join('');
  const sum = (k: string, v: string, bold = false) => `<tr><td style="padding:6px 0;font:${bold ? '700 16px' : '14px'} ${FONT};color:${bold ? INK : MUTED}">${escapeHtml(k)}</td><td align="right" style="padding:6px 0;font:${bold ? '700 16px' : '600 15px'} ${FONT};color:${INK}">${escapeHtml(v)}</td></tr>`;
  const body = `${h1(d.revised ? 'Your revised quote' : 'Your quote')}
${p(`Hi ${first(d.name)}, the mechanic has checked your vehicle. ${d.revised ? 'Extra work was found, so this quote replaces the earlier one.' : ''} Nothing starts until you approve.`)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:2px solid ${EMBER};margin:6px 0 14px">${items}</table>
<table role="presentation" width="70%" align="right" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px">${sum('Subtotal (before GST)', inr(d.subtotal))}${sum('GST @ 18%', inr(d.gst))}${sum('Total', inr(d.total), true)}${d.feeCredit ? sum('Confirmation fee already paid', '− ' + inr(d.feeCredit)) : ''}${sum('Balance to pay', inr(d.balance), true)}</table>
<div style="clear:both"></div>
${p(`<b>Estimated delivery:</b> ${escapeHtml(d.etaText)}`)}
${button('Review and approve', d.trackUrl, EMBER, '#1F1206')}
<p style="margin:14px 0 0;font:13px/1.5 ${FONT};color:${MUTED}">You can also decline on that page. This link is private to you.</p>`;
  const text = `${d.revised ? 'Revised quote' : 'Your quote'}${d.ref ? ' ' + d.ref : ''}\n\n${d.lines.map((l) => `${l.name} (${(KIND[l.kind] ?? l.kind) + partTypeSuffix(l)}): ${inr(l.amount)}`).join('\n')}\n\nSubtotal (before GST): ${inr(d.subtotal)}\nGST @ 18%: ${inr(d.gst)}\nTotal: ${inr(d.total)}\n${d.feeCredit ? `Confirmation fee already paid: -${inr(d.feeCredit)}\n` : ''}Balance to pay: ${inr(d.balance)}\n\nEstimated delivery: ${d.etaText}\n\nReview and approve: ${d.trackUrl}\nNothing starts until you approve.`;
  return { subject, html: layout({ preheader: `Total ${inr(d.total)}. Estimated delivery: ${d.etaText}`, title: subject, body, site: d }), text };
}
// Short email when the delivery estimate changes.
export function etaChanged(d: Site & { name: string; ref?: string | null; etaText: string; trackUrl: string }): Mail {
  const subject = `New delivery estimate${d.ref ? ' for ' + d.ref : ''}`;
  const body = `${h1('Delivery estimate updated')}${p(`Hi ${first(d.name)}, your estimated delivery is now <b>${escapeHtml(d.etaText)}</b>. Sorry for the change.`)}${button('Track your booking', d.trackUrl, EMBER, '#1F1206')}`;
  return { subject, html: layout({ preheader: `Estimated delivery: ${d.etaText}`, title: subject, body, site: d }), text: `Hi ${firstText(d.name)}, your estimated delivery is now ${d.etaText}.\nTrack: ${d.trackUrl}` };
}

export function mechanicOnTheWay(d: Site & { name: string; ref?: string | null; mechanicFirst?: string | null; trackUrl: string }): Mail {
  const who = d.mechanicFirst ? escapeHtml(d.mechanicFirst) : 'Your mechanic';
  const subject = `Your mechanic is on the way${d.ref ? ' ' + d.ref : ''}`;
  const body = `${h1('Your mechanic is on the way')}${p(`Hi ${first(d.name)}, <b>${who}</b> has left for your address. Please keep your code ready: you give it to the mechanic when they arrive, before any work starts.`)}${button('Track live', d.trackUrl, EMBER, '#1F1206')}<p style="margin:18px 0 0;font:13px/1.5 ${FONT};color:${MUTED}">The live distance on the page is an estimate. This link is private to you.</p>`;
  return { subject, html: layout({ preheader: 'Track your mechanic live', title: subject, body, site: d }), text: `Hi ${firstText(d.name)}, ${d.mechanicFirst ?? 'your mechanic'} is on the way to your address. Keep your code ready.\nTrack live: ${d.trackUrl}\n\nThe live distance is an estimate.` };
}

// Lifecycle emails: the vehicle is ready or delivered, and the quote approval was received. Short, plain, end with the booking ID.
export function deliveryUpdate(d: Site & { name: string; ref?: string | null; stage: 'ready' | 'delivered'; vehicleName: string; trackUrl: string }): Mail {
  const ready = d.stage === 'ready', id = d.ref ? ` Booking ${d.ref}.` : '';
  const subject = ready ? `Your ${d.vehicleName} is ready${d.ref ? ' ' + d.ref : ''}` : `Your ${d.vehicleName} was delivered${d.ref ? ' ' + d.ref : ''}`;
  const line = ready ? `your <b>${escapeHtml(d.vehicleName)}</b> is ready for delivery. We will hand it over as planned.` : `your <b>${escapeHtml(d.vehicleName)}</b> has been delivered. Thank you for choosing Mechanix Pro.`;
  const body = `${h1(ready ? 'Ready for delivery' : 'Delivered')}${p(`Hi ${first(d.name)}, ${line}${escapeHtml(id)}`)}${button('Open your booking', d.trackUrl, EMBER, '#1F1206')}`;
  return { subject, html: layout({ preheader: ready ? 'Your vehicle is ready' : 'Your vehicle was delivered', title: subject, body, site: d }), text: `Hi ${firstText(d.name)}, ${ready ? `your ${d.vehicleName} is ready for delivery. We will hand it over as planned.` : `your ${d.vehicleName} has been delivered. Thank you for choosing Mechanix Pro.`}${id}\n${d.trackUrl}` };
}
export function approvalReceived(d: Site & { name: string; ref?: string | null; by: 'customer' | 'admin'; trackUrl: string }): Mail {
  const subject = `Quote approved${d.ref ? ' ' + d.ref : ''}: the work can start`, id = d.ref ? ` Booking ${d.ref}.` : '';
  const line = d.by === 'admin' ? 'our team noted your approval of the quote.' : 'we got your approval of the quote.';
  const body = `${h1('Quote approved')}${p(`Hi ${first(d.name)}, ${line} The work can start now.${escapeHtml(id)}`)}${button('Track your booking', d.trackUrl, EMBER, '#1F1206')}`;
  return { subject, html: layout({ preheader: 'The work can start now', title: subject, body, site: d }), text: `Hi ${firstText(d.name)}, ${line} The work can start now.${id}\n${d.trackUrl}` };
}
