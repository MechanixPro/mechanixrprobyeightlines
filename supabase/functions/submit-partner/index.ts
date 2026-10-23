// POST /functions/v1/submit-partner  { kind, name?, owner_name, mobile, address, pincode?, categories[], bays?, note?, consent }
// Public, for the "Join us" page. The application lands in the Care Buddy desk as a garage at the "applied" step, and the owners get an email.
import { adminDb, env, json, corsHeaders, sha256Hex } from '../_shared/util.ts';
import { cleanPartner, PARTNER_KINDS } from '../_shared/partner.ts';
import { sendEmail } from '../_shared/resend.ts';
import { supervisorEmails } from '../_shared/desk-notify.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405);
  const origin = req.headers.get('origin') ?? '';
  if (origin && corsHeaders(req)['Access-Control-Allow-Origin'] !== origin) return json(req, { error: 'Not allowed' }, 403);

  const b = await req.json().catch(() => ({}));
  const ip = req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '';
  const tsSecret = env('TURNSTILE_SECRET');
  if (tsSecret) {
    const form = new FormData();
    form.append('secret', tsSecret); form.append('response', String(b.turnstile_token ?? '').slice(0, 2048)); if (ip) form.append('remoteip', ip);
    const v = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form }).then((r) => r.json()).catch(() => ({ success: false }));
    if (!v.success) return json(req, { error: 'Security check failed' }, 403);
  }
  const v = cleanPartner(b);
  if (!v.ok) return json(req, { error: v.error }, 400);
  const p = v.value;

  const db = adminDb();
  const ipHash = await sha256Hex((ip || 'unknown') + env('IP_SALT', 'mxp'));
  // 3 applications per visitor per day is plenty. The audit log doubles as the counter.
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const { count } = await db.from('audit_log').select('id', { count: 'exact', head: true }).eq('action', 'partner_apply').eq('details->>ip', ipHash).gte('created_at', since);
  if ((count ?? 0) >= 3) return json(req, { error: 'Too many requests. Please try again later.' }, 429);

  const kindLabel = PARTNER_KINDS.find((k) => k.id === p.kind)?.label ?? p.kind;
  const { data: row, error } = await db.from('garages').insert({
    name: p.name, owner_name: p.owner_name, mobile: p.mobile, address: p.address, pincode: p.pincode, categories: p.categories, bays: p.bays, status: 'applied',
    notes: `Applied on the website as: ${kindLabel}.${p.note ? ' ' + p.note : ''}`.slice(0, 1000),
  }).select('code').single();
  if (error) {
    if ((error as { code?: string }).code === '23505') return json(req, { ok: true, duplicate: true });
    console.error('partner insert failed', error.message); return json(req, { error: 'Could not save. Please message us on WhatsApp.' }, 500);
  }
  await db.from('audit_log').insert({ actor: null, action: 'partner_apply', details: { ip: ipHash, code: row?.code, kind: p.kind } });

  // Tell the owners. A failed email never fails the application.
  try {
    const to = await supervisorEmails(db);
    const body = `New ${kindLabel.toLowerCase()} application ${row?.code}\n\nName: ${p.name}\nContact: ${p.owner_name}, ${p.mobile}\nArea: ${p.address}${p.pincode ? ' ' + p.pincode : ''}\nWorks on: ${p.categories.join(', ')}${p.bays ? `\nBays: ${p.bays}` : ''}${p.note ? `\nNote: ${p.note}` : ''}\n\nOpen the Care Buddy desk, Garages, to take it forward.`;
    for (const t of to) await sendEmail({ to: t, subject: `New partner application: ${p.name}`, text: body, html: `<pre style="font:14px/1.5 system-ui">${body.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] as string))}</pre>` });
  } catch { /* ignore */ }
  return json(req, { ok: true });
});
