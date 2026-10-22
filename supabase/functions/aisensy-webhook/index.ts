// POST /functions/v1/aisensy-webhook — AiSensy's native project webhook (Custom App). Verifies X-AiSensy-Signature (HMAC SHA-256 of the body with the app's shared secret, AISENSY_SHARED_SECRET).
// Handles message.sender.user (a customer wrote to the desk number). Answers 2xx for topics it does not use, so AiSensy does not disable the subscription.
import { adminDb, env, hmacSha256Hex, safeEqual } from '../_shared/util.ts';
import { inboundFromNotification } from '../_shared/aisensy.ts';
import { ingestInbound } from '../_shared/inbound.ts';

const reply = (b: unknown = { ok: true }, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);
  const secret = env('AISENSY_SHARED_SECRET');
  const raw = await req.text();
  const sig = (req.headers.get('x-aisensy-signature') ?? '').toLowerCase();
  let body: any; try { body = JSON.parse(raw); } catch { return reply({ error: 'Bad JSON' }, 400); }
  // AiSensy signs the JSON of the notification; accept the raw body or the same body re-serialised.
  const good = secret && sig && (safeEqual(sig, await hmacSha256Hex(secret, raw)) || safeEqual(sig, await hmacSha256Hex(secret, JSON.stringify(body))));
  if (!good) return reply({ error: 'Bad signature' }, 401);
  try {
    const m = inboundFromNotification(body);
    if (m) await ingestInbound(adminDb(), m);
  } catch (e) { console.error('aisensy-webhook', e); }
  return reply();
});
