// POST /functions/v1/kyc-admin  { action: 'link' | 'view' | 'delete', ... } — owner and admin only (verified through the database functions, which check the role).
// link:  makes a private onboarding link for a garage or mechanic and returns it ONCE with a ready WhatsApp message (only a hash is stored).
// view:  returns a signed URL that lasts 60 seconds for one KYC document and logs who opened it.
// delete: removes an applicant's documents (database rows and storage files) and logs it.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { adminDb, env, json, corsHeaders } from '../_shared/util.ts';
import { isKind } from '../_shared/partner-kyc.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405);
  const userClient = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }, auth: { persistSession: false } });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json(req, { error: 'Sign in again' }, 401);

  const b = await req.json().catch(() => ({}));
  const action = String(b?.action ?? '');
  const db = adminDb();

  // Every action first proves the caller is an owner or admin by calling a database function that checks the role as that user.
  const adminOk = async (kind: string, id: string) => {
    const r = await userClient.rpc('kyc_review_detail', { p_kind: kind, p_id: id });
    return !r.error;
  };

  if (action === 'link') {
    const kind = String(b?.kind ?? ''), id = String(b?.id ?? '');
    if (!isKind(kind) || !UUID.test(id)) return json(req, { error: 'Choose a garage or mechanic.' }, 400);
    if (!(await adminOk(kind, id))) return json(req, { error: 'Only the owner or an admin can do this.' }, 403);
    const { data: tok, error } = await db.rpc('kyc_link_create', { p_kind: kind, p_id: id });
    if (error || !tok) { console.error('kyc-admin link', error?.code); return json(req, { error: 'Could not make the link. Try again.' }, 500); }
    const url = `${env('SITE_URL', 'https://mechanixpro.in')}/onboard/?t=${tok}`;
    const name = kind === 'garage'
      ? (await db.from('garages').select('name,owner_name,mobile').eq('id', id).maybeSingle()).data
      : (await db.from('mechanics').select('name,phone').eq('id', id).maybeSingle()).data;
    const first = String((name as any)?.owner_name ?? (name as any)?.name ?? '').split(' ')[0] || 'there';
    const phone = String((name as any)?.mobile ?? (name as any)?.phone ?? '').replace(/\D/g, '').slice(-10);
    const message = `Hi ${first}, welcome to Mechanix Pro. Please finish your onboarding here: ${url}\nYou will need your Aadhaar and PAN, photos of the garage and the signed agreement. The link is private and works for 14 days.`;
    return json(req, { ok: true, url, message, wa: phone ? `https://wa.me/91${phone}?text=${encodeURIComponent(message)}` : null });
  }

  if (action === 'view') {
    const docId = String(b?.doc ?? '');
    if (!UUID.test(docId)) return json(req, { error: 'Choose a document.' }, 400);
    const { data: d } = await db.from('partner_docs').select('id,partner_kind,partner_id,path').eq('id', docId).maybeSingle();
    if (!d) return json(req, { error: 'Document not found.' }, 404);
    if (!(await adminOk(d.partner_kind, d.partner_id))) return json(req, { error: 'Only the owner or an admin can do this.' }, 403);
    const { data, error } = await db.storage.from('kyc').createSignedUrl(d.path, 60);
    if (error || !data) { console.error('kyc-admin view', error?.message); return json(req, { error: 'Could not open the document.' }, 500); }
    await db.from('partner_onboarding_log').insert({ who: user.id, action: 'doc_viewed', partner_kind: d.partner_kind, partner_id: d.partner_id, doc_id: d.id });
    return json(req, { ok: true, url: data.signedUrl, expires_in: 60 });
  }

  if (action === 'delete') {
    const kind = String(b?.kind ?? ''), id = String(b?.id ?? '');
    if (!isKind(kind) || !UUID.test(id)) return json(req, { error: 'Choose a garage or mechanic.' }, 400);
    const r = await userClient.rpc('kyc_delete_docs', { p_kind: kind, p_id: id });
    if (r.error) return json(req, { error: r.error.message.includes('not allowed') ? 'Only the owner or an admin can do this.' : 'Could not delete.' }, r.error.message.includes('not allowed') ? 403 : 500);
    const paths: string[] = (r.data as any)?.paths ?? [];
    if (paths.length) await db.storage.from('kyc').remove(paths);
    return json(req, { ok: true, removed: paths.length });
  }

  return json(req, { error: 'Unknown action' }, 400);
});
