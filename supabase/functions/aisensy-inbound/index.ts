// POST /functions/v1/aisensy-inbound — called by an AiSensy chatbot flow step ("API / webhook") for every customer message on the desk number.
// Secured by x-aisensy-secret (AISENSY_WEBHOOK_SECRET). Use this when the project has no native webhook access.
import { adminDb, env, json, safeEqual } from '../_shared/util.ts';
import { cleanAisensyInbound } from '../_shared/aisensy.ts';
import { ingestInbound } from '../_shared/inbound.ts';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405);
  const secret = env('AISENSY_WEBHOOK_SECRET');
  if (!secret || !safeEqual(req.headers.get('x-aisensy-secret') ?? '', secret)) return json(req, { error: 'Forbidden' }, 403);
  const v = cleanAisensyInbound(await req.json().catch(() => ({})));
  if (!v.ok) return json(req, { error: 'Invalid ' + v.error }, 400);
  const r = await ingestInbound(adminDb(), v.value);
  return r.ok ? json(req, r) : json(req, { error: r.error }, 500);
});
