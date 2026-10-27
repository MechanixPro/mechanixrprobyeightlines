// GET /functions/v1/warranty-verify?c=MPW-XXXXXX — public. Confirms a warranty card is genuine and returns the details a customer may see
// (first name and last initial, masked vehicle number, service, dates, terms) plus a QR code (SVG) that points back to the card page.
import qrcode from 'npm:qrcode-generator@1.4.4';
import { adminDb, json, corsHeaders } from '../_shared/util.ts';
import { validCode, maskReg, shortName, warrantyStatus, WARRANTY_TERMS } from '../_shared/warranty-rules.ts';
import { cardUrl } from '../_shared/warranty.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'GET') return json(req, { error: 'Method not allowed' }, 405);
  const code = String(new URL(req.url).searchParams.get('c') ?? '').toUpperCase().trim();
  if (!validCode(code)) return json(req, { valid: false, error: 'That card number does not look right' }, 400);
  const { data: c } = await adminDb().from('warranty_cards').select('code,customer_name,vehicle_reg,bike_label,service_name,done_on,valid_until,days').eq('code', code).maybeSingle();
  if (!c) return json(req, { valid: false, error: 'No warranty card found with that number' }, 404);
  const qr = qrcode(0, 'M'); qr.addData(cardUrl(c.code)); qr.make();
  return json(req, { valid: true, code: c.code, status: warrantyStatus(c.valid_until), customer: shortName(c.customer_name), vehicle: maskReg(c.vehicle_reg), bike: c.bike_label, service: c.service_name, done_on: c.done_on, valid_until: c.valid_until, days: c.days, terms: WARRANTY_TERMS, qr_svg: qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true }) });
});
