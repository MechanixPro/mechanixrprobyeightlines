// Shared helpers for Mechanix Pro Edge Functions (Deno runtime on Supabase).
import { createClient, SupabaseClient } from 'npm:@supabase/supabase-js@2';

export const env = (k: string, fallback = ''): string => Deno.env.get(k) ?? fallback;

/** Service-role client. Bypasses RLS — only ever used inside Edge Functions, never in the browser. */
export function adminDb(): SupabaseClient {
  return createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
}

export function corsHeaders(req: Request): Record<string, string> {
  const allowed = env('ALLOWED_ORIGINS', 'https://mechanixpro.in,https://www.mechanixpro.in').split(',').map((s) => s.trim());
  const origin = req.headers.get('origin') ?? '';
  return {
    'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : allowed[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

export function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(req), 'Content-Type': 'application/json' } });
}

const enc = new TextEncoder();
const toHex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

export async function sha256Hex(s: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', enc.encode(s)));
}
export async function hmacSha256Hex(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return toHex(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}
/** Constant-time string comparison for signatures. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export const rupee = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');
export const last10 = (p: string) => String(p ?? '').replace(/\D/g, '').slice(-10);

/** Current hour in India (IST, UTC+5:30). */
export function istHour(d = new Date()): number {
  return new Date(d.getTime() + 330 * 60_000).getUTCHours();
}
/** Push a time out of quiet hours (default 21:00–09:00 IST) to 09:05 IST. */
export function respectQuietHours(at: Date, startH = 21, endH = 9): Date {
  const h = istHour(at);
  if (h >= endH && h < startH) return at;
  const ist = new Date(at.getTime() + 330 * 60_000);
  if (h >= startH) ist.setUTCDate(ist.getUTCDate() + 1);
  ist.setUTCHours(endH, 5, 0, 0);
  return new Date(ist.getTime() - 330 * 60_000);
}

export async function getSetting<T>(db: SupabaseClient, key: string, fallback: T): Promise<T> {
  const { data } = await db.from('settings').select('value').eq('key', key).maybeSingle();
  return (data?.value ?? fallback) as T;
}

/** Recompute a booking estimate on the server from the database price list (never trust browser totals). */
export async function priceBooking(db: SupabaseClient, serviceId: string, addons: string[], bigBike: boolean) {
  const ids = [serviceId, ...addons, 'bigbike'];
  const { data, error } = await db.from('services').select('id,kind,name,price').in('id', ids).eq('active', true);
  if (error) throw error;
  const svc = data?.find((r) => r.id === serviceId && r.kind === 'service');
  if (!svc) return null;
  // The big-bike surcharge is a fee row in the same table as the prices, so one edit in the admin changes it everywhere.
  const bigFee = data?.find((r) => r.id === 'bigbike' && r.kind === 'fee');
  const surcharge = bigBike && ['basic', 'general', 'full'].includes(serviceId) ? Number(bigFee?.price ?? 300) : 0;
  const validAddons = (data ?? []).filter((r) => r.kind === 'addon' && addons.includes(r.id));
  const total = svc.price + surcharge + validAddons.reduce((s, r) => s + r.price, 0);
  return { service: svc, addons: validAddons, total };
}
