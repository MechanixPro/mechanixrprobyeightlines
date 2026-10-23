// GET /functions/v1/public-services  -> the Mechanix Pro bike service list with live prices, for partner sites such as Axlio.
// Public and read-only, like the price list on the website. It holds no secret and exposes no customer data.
import { adminDb } from '../_shared/util.ts';
import { buildPublicServices } from '../_shared/public-services.ts';

const H = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'content-type', 'Cache-Control': 'public, max-age=300', 'Content-Type': 'application/json; charset=utf-8' };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: H });
  if (req.method !== 'GET') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: H });
  const { data, error } = await adminDb().from('services').select('id,price,active').in('id', ['basic', 'general', 'full', 'repair', 'sos', 'wash', 'chain', 'brake', 'tyre', 'battery']);
  if (error) return new Response(JSON.stringify({ error: 'Unavailable' }), { status: 503, headers: H });
  const src = new URL(req.url).searchParams.get('source') ?? 'axlio';
  return new Response(JSON.stringify(buildPublicServices(data ?? [], /^[a-z0-9-]{1,24}$/.test(src) ? src : 'axlio')), { headers: H });
});
