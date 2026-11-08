// POST /functions/v1/partner-onboard  { action, token, ... }  — the private /onboard/ page. Public (no sign-in), the long random link token is the key.
// Actions: me, upload_url, doc_done, submit. Documents go to the PRIVATE 'kyc' bucket by signed upload URLs. No token, file content or identity number is logged or returned.
import { adminDb, env, json, corsHeaders, sha256Hex } from '../_shared/util.ts';
import { isKind, checkUpload, docPath, pathOk, missing, canSubmit, countDocs, DOC_LABEL, MULTI, REQUIRED, type PartnerKind } from '../_shared/partner-kyc.ts';

const ACTIONS = ['me', 'upload_url', 'doc_done', 'submit'];
const BAD_LINK = 'This link has expired or is not valid. Ask Mechanix Pro for a new one.';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405);
  const origin = req.headers.get('origin') ?? '';
  if (origin && corsHeaders(req)['Access-Control-Allow-Origin'] !== origin) return json(req, { error: 'Not allowed' }, 403);

  const b = await req.json().catch(() => ({}));
  const action = String(b?.action ?? '');
  if (!ACTIONS.includes(action)) return json(req, { error: 'Unknown action' }, 400);
  const token = String(b?.token ?? '');
  if (!/^[a-f0-9]{64}$/.test(token)) return json(req, { error: BAD_LINK, code: 'link' }, 404);

  const db = adminDb();
  const tokenHash = await sha256Hex(token);
  // Light rate limit per link: the log doubles as the counter (60 calls per 10 minutes).
  const since = new Date(Date.now() - 10 * 60_000).toISOString();
  const { count } = await db.from('partner_onboarding_log').select('id', { count: 'exact', head: true }).eq('action', 'page_call:' + tokenHash.slice(0, 12)).gte('at', since);
  if ((count ?? 0) > 60) return json(req, { error: 'Too many tries. Wait a few minutes.' }, 429);
  await db.from('partner_onboarding_log').insert({ action: 'page_call:' + tokenHash.slice(0, 12) });

  const { data: link, error: lerr } = await db.rpc('kyc_link_check', { p_hash: tokenHash });
  if (lerr || !link || link.error || !isKind(link.kind)) return json(req, { error: BAD_LINK, code: 'link' }, 404);
  const kind = link.kind as PartnerKind, partnerId = String(link.id);

  const loadDocs = async () => (await db.from('partner_docs').select('id,doc_type,status,reject_reason,path').eq('partner_kind', kind).eq('partner_id', partnerId)).data ?? [];

  if (action === 'me') {
    const name = kind === 'garage'
      ? (await db.from('garages').select('name').eq('id', partnerId).maybeSingle()).data?.name
      : (await db.from('mechanics').select('name').eq('id', partnerId).maybeSingle()).data?.name;
    const docs = await loadDocs();
    const counts = countDocs(docs);
    const { data: k } = await db.from('partner_kyc').select('submitted_at,decision,decision_reason').eq('partner_kind', kind).eq('partner_id', partnerId).maybeSingle();
    return json(req, {
      ok: true, kind, name: name ?? '',
      submitted: !!k?.submitted_at && k?.decision !== 'rejected', decision: k?.decision ?? 'pending', decision_reason: k?.decision_reason ?? null,
      checklist: REQUIRED[kind].map((r) => ({ type: r.type, label: DOC_LABEL[r.type] ?? r.type, min: r.min, have: counts[r.type] ?? 0, rejected: docs.filter((d: any) => d.doc_type === r.type && d.status === 'rejected').map((d: any) => d.reject_reason ?? 'Please upload this again.').slice(0, 1) })),
      can_submit: canSubmit(kind, counts),
    });
  }

  const { data: kyc } = await db.from('partner_kyc').select('submitted_at,decision').eq('partner_kind', kind).eq('partner_id', partnerId).maybeSingle();
  if (kyc?.submitted_at && kyc.decision !== 'rejected') return json(req, { error: 'Your documents were already sent. We will contact you.' }, 409);

  if (action === 'upload_url') {
    const c = checkUpload(kind, b?.doc_type, b?.content_type, b?.size);
    if (!c.ok) return json(req, { error: c.error }, 400);
    const docType = String(b.doc_type);
    const have = (await loadDocs()).filter((d: any) => d.doc_type === docType && d.status !== 'rejected').length;
    if (MULTI[docType] && have >= MULTI[docType]) return json(req, { error: 'You have added the most photos allowed.' }, 400);
    const random = (crypto.randomUUID().replace(/-/g, '')).slice(0, 16);
    const path = docPath(kind, partnerId, docType, random, c.ext);
    const { data, error } = await db.storage.from('kyc').createSignedUploadUrl(path);
    if (error || !data) { console.error('partner-onboard upload_url', error?.message); return json(req, { error: 'Could not start the upload. Try again.' }, 500); }
    return json(req, { ok: true, url: data.signedUrl, path, token: data.token });
  }

  if (action === 'doc_done') {
    const docType = String(b?.doc_type ?? ''), path = b?.path;
    if (!pathOk(kind, partnerId, path) || !path.includes('/' + docType + '-')) return json(req, { error: 'That file is not valid. Upload it again.' }, 400);
    const { data: info } = await db.storage.from('kyc').list(`${kind}/${partnerId}`, { search: String(path).split('/').pop() });
    if (!info?.length) return json(req, { error: 'The upload did not finish. Try again.' }, 400);
    if (!MULTI[docType]) {
      const old = (await loadDocs()).filter((d: any) => d.doc_type === docType);
      if (old.length) { await db.storage.from('kyc').remove(old.map((d: any) => d.path)); await db.from('partner_docs').delete().in('id', old.map((d: any) => d.id)); }
    }
    const { error } = await db.from('partner_docs').insert({ partner_kind: kind, partner_id: partnerId, doc_type: docType, path });
    if (error) { console.error('partner-onboard doc_done', error.code); return json(req, { error: 'Could not save the document. Try again.' }, 500); }
    await db.from('partner_onboarding_log').insert({ action: 'doc_uploaded', partner_kind: kind, partner_id: partnerId });
    return json(req, { ok: true });
  }

  // submit
  const counts = countDocs(await loadDocs());
  if (!canSubmit(kind, counts)) return json(req, { error: 'Some documents are still missing.', missing: missing(kind, counts).map((m) => DOC_LABEL[m.type] ?? m.type) }, 400);
  const { error } = await db.rpc('kyc_submit', { p_kind: kind, p_id: partnerId });
  if (error) { console.error('partner-onboard submit', error.code); return json(req, { error: 'Could not send. Try again.' }, 500); }
  return json(req, { ok: true });
});
