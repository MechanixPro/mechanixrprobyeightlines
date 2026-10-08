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
<tr><td bgcolor="#ffffff" style="padding:22px 32px;border-bottom:4px solid ${EMBER}"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="vertical-align:middle"><img src="${escapeHtml(site.siteUrl)}/assets/img/email-logo.png" width="40" height="42" alt="Mechanix Pro" style="display:block;border:0"></td><td style="padding-left:12px;vertical-align:middle"><img src="${escapeHtml(site.siteUrl)}/assets/img/email-wordmark.png" width="170" height="15" alt="MECHANIX PRO" style="display:block;border:0"></td></tr></table></td></tr>
<tr><td style="padding:32px">${o.body}</td></tr>
<tr><td style="padding:20px 32px 28px;border-top:1px solid ${LINE};background:#FAFBFD"><p style="margin:0 0 6px;font:13px/1.5 ${FONT};color:${MUTED}">Mechanix Pro · Doorstep bike service, Bengaluru</p><p style="margin:0 0 6px;font:12px/1.5 ${FONT};color:${MUTED}">${escapeHtml(companyLine())} · GSTIN ${escapeHtml(COMPANY.gstin)}</p><p style="margin:0;font:13px/1.5 ${FONT};color:${MUTED}">${contact}</p>${o.footerNote ? `<p style="margin:12px 0 0;font:12px/1.5 ${FONT};color:${MUTED}">${o.footerNote}</p>` : ''}</td></tr>
</table></td></tr></table></body></html>`;
}
// The customer's own build, shown back to them: their bike's name, the package and the price. Edit link opens the booking form with it filled in.
function buildCard(d: { bike: string; service: string; estimate?: number | null; buildUrl?: string | null }): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 22px"><tr><td bgcolor="${NAVY}" style="border-radius:18px;padding:20px 22px">
<p style="margin:0 0 4px;font:600 12px ${FONT};letter-spacing:1.2px;text-transform:uppercase;color:#FFC38A">Your package for</p>
<p style="margin:0 0 10px;font:700 22px/1.25 ${FONT};color:#ffffff">${escapeHtml(d.bike)}</p>
<p style="margin:0;font:15px/1.5 ${FONT};color:#D5DDF0">${escapeHtml(d.service)}${d.estimate ? ` &nbsp;·&nbsp; from <b style="color:#ffffff">${rupee(d.estimate)}</b>, GST included` : ''}</p>
${d.buildUrl ? `<p style="margin:14px 0 0"><a href="${escapeHtml(d.buildUrl)}" style="font:700 14px ${FONT};color:#FFC38A;text-decoration:underline">Edit your build</a></p>` : ''}
</td></tr></table>`;
}
const first = (name: string) => escapeHtml(String(name || 'there').trim().split(/\s+/)[0] || 'there');
const firstText = (name: string) => String(name || 'there').trim().split(/\s+/)[0] || 'there';

export type BookingData = Site & { checkupFee?: number | null; nick?: string | null; buildUrl?: string | null; name: string; ref: string; bike: string; service: string; area: string; whenText: string; estimate: number };

export function bookingReceived(d: BookingData): Mail {
  const subject = `We got your request ${d.ref}`;
  const body = `${h1(`Thanks, ${firstText(d.name)}. We got your request.`)}
${p('Our expert will check what your bike needs and send you a quote on WhatsApp. Nothing starts, and nothing is charged, until you approve it.')}
${buildCard(d)}
${rows([['Reference', d.ref], ['Bike', d.bike], ['Service', d.service], ['Area', d.area], ['Preferred time', d.whenText], ['Starting estimate', rupee(d.estimate) + ', GST included']])}
<p style="margin:0 0 10px;font:700 16px ${FONT};color:${INK}">What happens next</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px">
<tr><td style="padding:4px 12px 4px 0;font:700 15px ${FONT};color:${EMBER};vertical-align:top">1</td><td style="padding:4px 0;font:15px/1.5 ${FONT};color:${INK}">Our expert calls or messages you to confirm what is needed, and whether it can be done at your door.</td></tr>
<tr><td style="padding:4px 12px 4px 0;font:700 15px ${FONT};color:${EMBER};vertical-align:top">2</td><td style="padding:4px 0;font:15px/1.5 ${FONT};color:${INK}">You get an itemised quote on WhatsApp. Parts are fitted only after you approve.</td></tr>
<tr><td style="padding:4px 12px 4px 0;font:700 15px ${FONT};color:${EMBER};vertical-align:top">3</td><td style="padding:4px 0;font:15px/1.5 ${FONT};color:${INK}">Approve the quote${d.checkupFee ? ` and pay the ${rupee(d.checkupFee)} checkup and quote fee to confirm your booking. It is adjusted in your final bill if you go ahead with the service` : ''}. A Mechanix Pro-certified mechanic then comes to you, with OEM-certified parts.</td></tr></table>
${button('Chat on WhatsApp', d.whatsappUrl, WA, '#063B1C')}${button('Call us', 'tel:' + d.phoneTel, NAVY, '#ffffff')}`;
  const text = `Thanks, ${firstText(d.name)}. We got your request.\n\nOur expert will check what your bike needs and send you a quote on WhatsApp. Nothing starts, and nothing is charged, until you approve it.\n\nYour package for ${d.bike}${d.buildUrl ? `\nEdit your build: ${d.buildUrl}` : ''}\n\nReference: ${d.ref}\nBike: ${d.bike}\nService: ${d.service}\nArea: ${d.area}\nPreferred time: ${d.whenText}\nStarting estimate: ${rupee(d.estimate)}, GST included\n\nWhat happens next\n1. Our expert calls or messages you to confirm what is needed.\n2. You get an itemised quote on WhatsApp. Parts are fitted only after you approve.\n3. Approve the quote${d.checkupFee ? ` and pay the ${rupee(d.checkupFee)} checkup and quote fee to confirm your booking (adjusted in your final bill if you go ahead)` : ''}. A Mechanix Pro-certified mechanic then comes to you, with OEM-certified parts.\n\nWhatsApp: ${d.whatsappUrl}\nCall: ${d.phoneDisplay}\n\nMechanix Pro, Bengaluru · ${d.email}`;
  return { subject, html: layout({ preheader: 'Your quote comes on WhatsApp. Nothing starts until you approve it.', title: subject, body, site: d }), text };
}

export type ConfirmedData = BookingData & { mechanicName?: string | null; amountDue?: number | null };
export function bookingConfirmed(d: ConfirmedData): Mail {
  const subject = `Your service is confirmed ${d.ref}`;
  const pairs: Array<[string, string]> = [['Reference', d.ref], ['Bike', d.bike], ['Service', d.service], ['When', d.whenText], ['Where', d.area]];
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

const inr2 = (n: number) => '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export type InvoiceMailData = Site & { invoice: Invoice; company: { legalName: string; addressLines: string[]; city: string; state: string; pincode: string; gstin: string } };
export function invoiceEmail(d: InvoiceMailData): Mail {
  const v = d.invoice, c = d.company;
  const subject = `Your Mechanix Pro invoice ${v.number}`;
  const addr = [...c.addressLines, [c.city, c.state, c.pincode].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const line = (k: string, val: string, bold = false) => `<tr><td style="padding:8px 0;font:${bold ? '700 16px' : '14px'} ${FONT};color:${bold ? INK : MUTED}">${escapeHtml(k)}</td><td align="right" style="padding:8px 0;font:${bold ? '700 16px' : '600 15px'} ${FONT};color:${INK}">${val}</td></tr>`;
  const items = v.lines.map((l) => `<tr><td style="padding:12px 0;border-bottom:1px solid ${LINE};font:15px ${FONT};color:${INK}">${escapeHtml(l.name)}</td><td align="right" style="padding:12px 0;border-bottom:1px solid ${LINE};font:600 15px ${FONT};color:${INK}">${inr2(l.amount)}</td></tr>`).join('')
    + (v.couponDiscount ? `<tr><td style="padding:12px 0;border-bottom:1px solid ${LINE};font:15px ${FONT};color:${INK}">Coupon discount</td><td align="right" style="padding:12px 0;border-bottom:1px solid ${LINE};font:600 15px ${FONT};color:${INK}">− ${inr2(v.couponDiscount)}</td></tr>` : '')
    + (v.extraDiscount ? `<tr><td style="padding:12px 0;border-bottom:1px solid ${LINE};font:15px ${FONT};color:${INK}">Special discount${v.extraNote ? ` (${escapeHtml(v.extraNote)})` : ''}</td><td align="right" style="padding:12px 0;border-bottom:1px solid ${LINE};font:600 15px ${FONT};color:${INK}">− ${inr2(v.extraDiscount)}</td></tr>` : '');
  const body = `${h1('Your invoice')}
${p(`Hi ${first(v.customer.name)}, here is the invoice for booking <b>${escapeHtml(v.ref)}</b>. Invoice <b>${escapeHtml(v.number)}</b>, dated ${escapeHtml(v.dateLabel)}.`)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 6px"><tr><td style="font:600 12px ${FONT};letter-spacing:1px;text-transform:uppercase;color:${MUTED};padding-bottom:6px;border-bottom:2px solid ${EMBER}">Item</td><td align="right" style="font:600 12px ${FONT};letter-spacing:1px;text-transform:uppercase;color:${MUTED};padding-bottom:6px;border-bottom:2px solid ${EMBER}">Amount (incl. GST)</td></tr>${items}</table>
<table role="presentation" width="60%" align="right" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 18px">${line('Taxable value', inr2(v.taxable))}${line('CGST @ 9%', inr2(v.cgst))}${line('SGST @ 9%', inr2(v.sgst))}${line('Total', inr2(v.total), true)}${v.paid ? line('Paid so far', inr2(v.paid)) + line('Balance due', inr2(v.balance), true) : ''}${v.refund ? line('Refund due to you', inr2(v.refund), true) : ''}</table>
<div style="clear:both"></div>
<p style="margin:18px 0 6px;font:13px/1.55 ${FONT};color:${MUTED}">Issued by <b>${escapeHtml(c.legalName)}</b> (trading as Mechanix Pro), ${escapeHtml(addr)}. GSTIN ${escapeHtml(c.gstin)}. Prices include 18% GST. Parts are OEM certified, work is done by Mechanix Pro certified mechanics, and every service carries a 30-day warranty.</p>
${button('Chat on WhatsApp', d.whatsappUrl, WA, '#063B1C')}${button('Call us', 'tel:' + d.phoneTel, NAVY, '#ffffff')}`;
  const text = `Your invoice ${v.number} (${v.dateLabel}) for booking ${v.ref}\n\n${v.lines.map((l) => `${l.name}: ${inr2(l.amount)}`).join('\n')}${v.couponDiscount ? `\nCoupon discount: -${inr2(v.couponDiscount)}` : ''}${v.extraDiscount ? `\nSpecial discount${v.extraNote ? ` (${v.extraNote})` : ''}: -${inr2(v.extraDiscount)}` : ''}\n\nTaxable value: ${inr2(v.taxable)}\nCGST @ 9%: ${inr2(v.cgst)}\nSGST @ 9%: ${inr2(v.sgst)}\nTotal: ${inr2(v.total)}${v.paid ? `\nPaid so far: ${inr2(v.paid)}\nBalance due: ${inr2(v.balance)}` : ''}${v.refund ? `\nRefund due to you: ${inr2(v.refund)}` : ''}\n\nIssued by ${c.legalName} (Mechanix Pro), ${addr}. GSTIN ${c.gstin}. Prices include 18% GST.\n\nWhatsApp: ${d.whatsappUrl}\nCall: ${d.phoneDisplay}`;
  return { subject, html: layout({ preheader: `Invoice ${v.number}: total ${inr2(v.total)}`, title: subject, body, site: d }), text };
}
