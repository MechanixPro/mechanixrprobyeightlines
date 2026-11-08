// Desk-automation step: give paid, confirmed bookings that nobody has picked up to a partner garage. Off unless Admin switches it on.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { getSetting } from './util.ts';
import { normalizeAuto, pickGarage, type AutoGarage } from './auto-garage.ts';

const OPEN_ST = ['sent', 'received', 'in_work', 'ready'];
const MIN = 60_000;

export async function autoAssignGarages(db: SupabaseClient): Promise<Record<string, number | boolean>> {
  const out = { enabled: false, checked: 0, assigned: 0, none: 0 };
  const s = normalizeAuto(await getSetting(db, 'auto_assign_garage', null));
  if (!s.enabled) return out;
  out.enabled = true;
  const ist = new Date(Date.now() + 330 * MIN).toISOString().slice(0, 10);
  const since = new Date(Date.now() - 3 * 86400_000).toISOString();
  const cutoff = new Date(Date.now() - 2 * MIN).toISOString();
  const { data: leads } = await db.from('leads').select('id,lat,lng,pincode,preferred_date,confirm_paid_at')
    .not('confirm_fee', 'is', null).not('confirm_paid_at', 'is', null).gt('confirm_paid_at', since).lte('confirm_paid_at', cutoff)
    .is('mechanic_id', null).is('deleted_at', null).in('status', ['paid', 'scheduled']).order('confirm_paid_at').limit(20);
  const todo = (leads ?? []).filter((l) => !l.preferred_date || String(l.preferred_date) >= ist);
  if (!todo.length) return out;
  const ids = todo.map((l) => l.id);
  const { data: held } = await db.from('garage_assignments').select('lead_id').in('lead_id', ids).in('status', OPEN_ST);
  const heldSet = new Set((held ?? []).map((r) => r.lead_id));
  const { data: done } = await db.from('audit_log').select('details').eq('action', 'garage_auto_assigned').gt('created_at', since).limit(500);
  const doneRefs = new Set((done ?? []).map((r) => String((r.details as Record<string, unknown>)?.lead ?? '')));
  const { data: lrefs } = await db.from('leads').select('id,ref').in('id', ids);
  const refOf = new Map((lrefs ?? []).map((r) => [r.id, r.ref]));
  const queue = todo.filter((l) => !heldSet.has(l.id) && !doneRefs.has(refOf.get(l.id) ?? '\0'));
  if (!queue.length) return out;
  const { data: gs } = await db.from('garages').select('id,name,pincode,lat,lng,shop_lat,shop_lng,is_open').is('deleted_at', null).in('status', ['live', 'pilot']).eq('ops_state', 'active').eq('is_open', true);
  if (!gs?.length) { out.checked = queue.length; out.none = queue.length; return out; }
  const { data: rows } = await db.from('garage_assignments').select('garage_id,status,assigned_at').in('garage_id', gs.map((g) => g.id)).order('assigned_at', { ascending: false }).limit(2000);
  const open = new Map<string, number>(), last = new Map<string, string>();
  for (const r of rows ?? []) { if (OPEN_ST.includes(r.status)) open.set(r.garage_id, (open.get(r.garage_id) ?? 0) + 1); if (!last.has(r.garage_id)) last.set(r.garage_id, r.assigned_at); }
  const cands: AutoGarage[] = gs.map((g) => ({ id: g.id, name: g.name, pincode: g.pincode, lat: g.shop_lat ?? g.lat, lng: g.shop_lng ?? g.lng, open_jobs: open.get(g.id) ?? 0, last_assigned_at: last.get(g.id) ?? null, available: true }));
  for (const l of queue) {
    out.checked++;
    const pick = pickGarage(l, cands, s);
    if (!pick) { out.none++; continue; }  // nobody qualifies: leave it; the existing unassigned-booking team alert covers it
    const { data: r, error } = await db.rpc('garage_auto_assign', { p_lead: l.id, p_garage: pick });
    if (!error && r?.assigned) { out.assigned++; const c = cands.find((x) => x.id === pick)!; c.open_jobs++; c.last_assigned_at = new Date().toISOString(); }
  }
  return out;
}
