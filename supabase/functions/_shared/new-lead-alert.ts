// An email to the desk the moment a new lead arrives, so a Care Buddy can call within minutes.
// Goes to the addresses in the setting lead_alert_emails (a JSON list) plus everyone active on the desk. It can never block or fail a booking.
import { sendEmail } from './resend.ts';
import { teamEmails } from './desk-notify.ts';
import { getSetting } from './util.ts';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const FROM_DESK = 'Mechanix Pro Desk <no-reply@mechanixpro.in>';
const SOURCE: Record<string, string> = { website: 'Website', whatsapp: 'WhatsApp', phone: 'Phone call (IVR)', walk_in: 'Walk in' };

// A new lead has no booking ID yet, so the alert does not show one (ref is the private lookup key and is left out on purpose).
export type NewLead = { ref?: string; name: string; phone: string; source: string; area?: string | null; service?: string | null; note?: string | null };

export async function alertNewLead(db: any, l: NewLead, deskUrl = Deno.env.get('DESK_URL') ?? 'https://crew.mechanixpro.in/crm/'): Promise<number> {
  try {
    const extra = await getSetting<string[]>(db, 'lead_alert_emails', []);
    const to = [...new Set([...(Array.isArray(extra) ? extra : []), ...(await teamEmails(db))].map((e) => String(e).trim().toLowerCase()).filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)))];
    if (!to.length) return 0;
    const rows = [['Name', l.name], ['Phone', '+91 ' + l.phone], ['Source', SOURCE[l.source] || l.source], l.area ? ['Area', l.area] : null, l.service ? ['Service', l.service] : null, l.note ? ['Note', l.note] : null].filter(Boolean) as string[][];
    const html = `<p><b>New lead.</b> Call or message the customer now.</p><table cellpadding="6" style="border-collapse:collapse">${rows.map(([k, v]) => `<tr><td style="color:#555">${esc(k)}</td><td><b>${esc(v)}</b></td></tr>`).join('')}</table><p><a href="${esc(deskUrl)}">Open the desk</a> and take the lead.</p>`;
    const text = `New lead. Call or message the customer now.\n` + rows.map(([k, v]) => `${k}: ${v}`).join('\n') + `\nOpen the desk: ${deskUrl}`;
    let sent = 0;
    for (const addr of to) { const r = await sendEmail({ to: addr, subject: `New lead: ${l.name} (${SOURCE[l.source] || l.source})`, html, text, from: FROM_DESK, tags: { template: 'new_lead_alert' } }); if (r.ok) sent++; }
    return sent;
  } catch (e) { console.error('new lead alert failed', e); return 0; }
}
