// POST /functions/v1/wa-media { media_id } — the Crew desk's "Load" button: fetches ONE customer file from Meta on demand and hands the bytes to the signed-in user.
// Nothing is stored: not in the database, not in storage. verify_jwt is false; the desk user's JWT and the inbox permission are checked here and in crm_wa_media_ok.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { env, json, corsHeaders } from '../_shared/util.ts';
import { cloudReady, fetchMedia } from '../_shared/wa-graph.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405);
  const userClient = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }, auth: { persistSession: false } });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json(req, { error: 'Sign in again' }, 401);
  const b = await req.json().catch(() => ({}));
  const id = String(b.media_id ?? '');
  if (!/^[A-Za-z0-9_-]{5,100}$/.test(id)) return json(req, { error: 'Bad file id' }, 400);
  const { error: ce } = await userClient.rpc('crm_wa_media_ok', { p_media_id: id });   // only files that belong to a stored message, only for people who may open the inbox
  if (ce) return json(req, { error: ce.message }, ce.code === '42501' ? 403 : ce.code === 'P0002' ? 404 : 400);
  if (!cloudReady()) return json(req, { error: 'The WhatsApp Cloud number is not connected yet' }, 503);
  const f = await fetchMedia(id);
  if (!f.ok) return json(req, { error: f.error }, f.status);
  return new Response(f.bytes, { status: 200, headers: { ...corsHeaders(req), 'Content-Type': f.mime, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline' } });
});
