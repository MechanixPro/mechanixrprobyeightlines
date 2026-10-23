// POST /functions/v1/desk-daily-report — run once a day (9:30 PM IST) by a database schedule. Secured by x-desk-cron (DESK_CRON_SECRET).
// Emails the owner and supervisors a plain summary of the day: leads by source, bookings, completions, ratings, who is still waiting, and each Care Buddy's day.
import { adminDb, env, json, safeEqual, getSetting } from '../_shared/util.ts';
import { sendEmail } from '../_shared/resend.ts';
import { supervisorEmails } from '../_shared/desk-notify.ts';

// The desk address. Set the DESK_URL secret to switch to the custom domain (https://crew.mechanixpro.in/crm/) once its DNS record is live.
const DESK_URL = Deno.env.get('DESK_URL') ?? 'https://mechanixpro-crm.pages.dev/crm/';
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

Deno.serve(async (req) => {
  try { return await handle(req); } catch (e) { console.error('daily report', e); return json(req, { ok: false, error: String((e as Error).message ?? e) }, 500); }
});

async function handle(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405);
  const secret = env('DESK_CRON_SECRET');
  if (!secret || !safeEqual(req.headers.get('x-desk-cron') ?? '', secret)) return json(req, { error: 'Forbidden' }, 403);
  const db = adminDb();
  if (!(await getSetting(db, 'desk_daily_report', true))) return json(req, { ok: true, skipped: 'switched off' });

  const istNow = new Date(Date.now() + 330 * 60_000);
  const day0 = new Date(Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate()) - 330 * 60_000).toISOString();
  const label = istNow.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  const count = async (q: any) => (await q).count ?? 0;
  const head = { count: 'exact' as const, head: true };

  const [{ data: created }, booked, completed, lost, tickets, ratings, users, acts, won] = await Promise.all([
    db.from('leads').select('source,utm').is('deleted_at', null).gte('created_at', day0),
    count(db.from('leads').select('id', head).is('deleted_at', null).gte('crm_won_at', day0)),
    count(db.from('leads').select('id', head).is('deleted_at', null).gte('completed_at', day0)),
    count(db.from('leads').select('id', head).is('deleted_at', null).eq('status', 'lost').gte('updated_at', day0)),
    count(db.from('crm_tickets').select('id', head).neq('status', 'resolved')),
    db.from('lead_ratings').select('rating').gte('created_at', day0),
    db.from('crm_users').select('user_id,name').eq('active', true),
    db.from('crm_activities').select('actor,kind').gte('created_at', day0).in('kind', ['call', 'whatsapp']),
    db.from('leads').select('crm_owner').is('deleted_at', null).gte('crm_won_at', day0)]);

  const bySource: Record<string, number> = {};
  for (const l of created ?? []) { const k = String((l.utm as any)?.utm_source || l.source || 'unknown'); bySource[k] = (bySource[k] ?? 0) + 1; }
  const rs = (ratings.data ?? []).map((r: any) => r.rating as number);
  const avg = rs.length ? (rs.reduce((a, b) => a + b, 0) / rs.length).toFixed(1) : null;
  const agents = (users.data ?? []).map((u: any) => ({ name: u.name, contacts: (acts.data ?? []).filter((a: any) => a.actor === u.user_id).length, booked: ((won as any)?.data ?? []).filter((w: any) => w.crm_owner === u.user_id).length }));
  const since = Date.now();
  const { data: waitCand } = await db.from('leads').select('id,last_customer_msg_at,wa_last_message_at').is('deleted_at', null).in('status', ['new', 'contacted', 'quoted', 'payment_sent']).eq('opted_out', false).gt('last_customer_msg_at', new Date(since - 3 * 86400_000).toISOString());
  const waiting = (waitCand ?? []).filter((l: any) => !l.wa_last_message_at || Date.parse(l.last_customer_msg_at) >= Date.parse(l.wa_last_message_at) - 90_000).length;

  const total = (created ?? []).length;
  const lines = [`New leads: ${total}`, ...Object.entries(bySource).sort((a, b) => b[1] - a[1]).map(([k, n]) => `  ${k}: ${n}`), `Bookings made: ${booked}`, `Jobs completed: ${completed}`, `Lost: ${lost}`,
    `Ratings today: ${rs.length}${avg ? ` (average ${avg} out of 5)` : ''}`, `Customers still waiting for a reply: ${waiting}`, `Open tickets: ${tickets}`, '', 'Care Buddies:', ...agents.map((a) => `  ${a.name}: ${a.contacts} contacts, ${a.booked} bookings`)];
  const text = `Mechanix Pro desk, ${label}\n\n${lines.join('\n')}\n\nOpen the desk: ${DESK_URL}`;
  const html = `<h2 style="margin:0 0 8px">Mechanix Pro desk</h2><p style="margin:0 0 14px;color:#555">${esc(label)}</p>
    <table cellpadding="6" style="border-collapse:collapse;font-size:15px"><tr><td>New leads</td><td align="right"><b>${total}</b></td></tr>${Object.entries(bySource).sort((a, b) => b[1] - a[1]).map(([k, n]) => `<tr><td style="color:#555;padding-left:18px">${esc(k)}</td><td align="right">${n}</td></tr>`).join('')}
    <tr><td>Bookings made</td><td align="right"><b>${booked}</b></td></tr><tr><td>Jobs completed</td><td align="right"><b>${completed}</b></td></tr><tr><td>Lost</td><td align="right">${lost}</td></tr>
    <tr><td>Ratings today</td><td align="right">${rs.length}${avg ? ` · ${avg}/5` : ''}</td></tr><tr><td>Customers still waiting for a reply</td><td align="right"><b${waiting ? ' style="color:#B3261E"' : ''}>${waiting}</b></td></tr><tr><td>Open tickets</td><td align="right">${tickets}</td></tr></table>
    ${agents.length ? `<h3 style="margin:18px 0 6px">Care Buddies</h3><table cellpadding="6" style="border-collapse:collapse;font-size:15px">${agents.map((a) => `<tr><td>${esc(a.name)}</td><td align="right">${a.contacts} contacts</td><td align="right"><b>${a.booked}</b> bookings</td></tr>`).join('')}</table>` : ''}
    <p style="margin-top:18px"><a href="${DESK_URL}">Open the desk</a></p>`;
  const to = await supervisorEmails(db); let emailed = 0;
  for (const addr of to) { const r = await sendEmail({ to: addr, subject: `Desk report, ${istNow.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' })}: ${booked} bookings, ${total} new leads`, html, text, tags: { template: 'desk_daily' } }); if (r.ok) emailed++; }
  await db.from('crm_automation_log').insert({ job: 'daily-report', ok: emailed > 0 || to.length === 0, summary: { emailed, recipients: to.length, leads: total, booked, completed } }).then(() => {}, () => {});
  return json(req, { ok: true, emailed, recipients: to.length, leads: total, booked, completed });
}
