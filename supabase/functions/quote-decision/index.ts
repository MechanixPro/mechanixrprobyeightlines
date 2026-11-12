// POST /functions/v1/quote-decision  { t, version, decision: 'approve' | 'decline' | 'changes', reason?, source?: 'link' | 'track' }   (source 'track' = the tracking page, anything else = the private link in the email)
// Public: the customer taps Approve or Decline on the tracking page. The secret tracking token (from the confirmation email) is the only key.
// The database records it once (idempotent), with the time; the team is told. A repeat tap returns the first answer.
import { adminDb, env, json, corsHeaders, sha256Hex } from '../_shared/util.ts';
import { notifyTeamDecision, sendApprovalNotice } from '../_shared/after-payment.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405);
  const origin = req.headers.get('origin') ?? '';
  if (origin && corsHeaders(req)['Access-Control-Allow-Origin'] !== origin) return json(req, { error: 'Not allowed' }, 403);
  const b = await req.json().catch(() => ({}));
  const t = String(b?.t ?? ''), version = Number(b?.version), decision = String(b?.decision ?? '');
  if (!/^[0-9a-f]{32}$/.test(t) || !Number.isInteger(version) || version < 1 || !['approve', 'decline', 'changes'].includes(decision)) return json(req, { error: 'This link is not valid.' }, 400);
  const db = adminDb();
  const ip = req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '';
  const ipHash = await sha256Hex((ip || 'unknown') + env('IP_SALT', 'mxp'));
  const { count } = await db.from('track_attempts').select('id', { count: 'exact', head: true }).eq('ip_hash', ipHash).gte('created_at', new Date(Date.now() - 10 * 60_000).toISOString());
  if ((count ?? 0) >= 20) return json(req, { error: 'Too many tries. Please wait a few minutes.' }, 429);
  await db.from('track_attempts').insert({ ip_hash: ipHash });

  const { data, error } = await db.rpc('quote_decide', { p_token: t, p_version: version, p_decision: decision, p_reason: String(b?.reason ?? '').slice(0, decision === 'changes' ? 500 : 200) || null, p_source: b?.source === 'track' ? 'track' : 'link' });
  if (error) { console.error('quote-decision', error); return json(req, { error: 'Could not save. Please try again.' }, 500); }
  if (!data?.ok) return json(req, { error: data?.error ?? 'Could not save.', superseded: !!data?.superseded }, data?.superseded ? 409 : 400);
  if (!data.already) {
    const { data: sec } = await db.from('booking_secrets').select('lead_id').eq('track_token', t).maybeSingle();
    if (sec) await notifyTeamDecision(db, sec.lead_id, version, decision === 'approve' ? 'approved' : decision === 'changes' ? 'changes requested on' : 'declined');   // logged and failure-isolated; never blocks the answer
    if (sec && decision === 'approve') await sendApprovalNotice(db, sec.lead_id);   // the customer and the assigned garage are told too, once per quote version (same path as an admin approval)
  }
  return json(req, { ok: true, status: data.status, version: data.version, already: !!data.already });
});
