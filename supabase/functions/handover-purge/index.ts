// POST /functions/v1/handover-purge  { months?, min_age_days?, dry_run? }
// Deletes handover photos older than the keep period (12 months by default) and uploads that never became part of a verified handover,
// through the Storage API (Supabase refuses direct deletes from storage tables). The rows are cleared only after the files are gone.
// Secured like desk-automation: x-desk-cron with DESK_CRON_SECRET. Not scheduled yet: run it by hand, or from pg_cron when the owner wants it.
import { adminDb, env, json, safeEqual } from '../_shared/util.ts';

const BATCH = 100;

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405);
  const secret = env('DESK_CRON_SECRET');
  if (!secret || !safeEqual(req.headers.get('x-desk-cron') ?? '', secret)) return json(req, { error: 'Forbidden' }, 403);
  const body = await req.json().catch(() => ({}));
  const months = Number.isInteger(body?.months) && body.months >= 1 ? body.months : null;
  const minAgeDays = Number.isInteger(body?.min_age_days) && body.min_age_days >= 1 ? body.min_age_days : 2;
  const db = adminDb();

  const [{ data: expired, error: e1 }, { data: orphans, error: e2 }] = await Promise.all([
    db.rpc('handover_expired_photos', { p_months: months }),
    db.rpc('handover_orphan_photos', { p_min_age: `${minAgeDays} days` }),
  ]);
  if (e1 || e2) { console.error('handover-purge lists', e1 ?? e2); return json(req, { error: 'Could not read the lists' }, 500); }
  const expiredRows = (expired ?? []) as { handover_id: string; path: string }[];
  const orphanRows = (orphans ?? []) as { path: string }[];
  const paths = [...new Set([...expiredRows.map((r) => r.path), ...orphanRows.map((r) => r.path)])];
  if (body?.dry_run === true) {
    const lm = Number.isInteger(body?.live_months) && body.live_months >= 1 ? body.live_months : 3;
    const { count } = await db.from('live_updates').select('id', { count: 'exact', head: true }).lt('created_at', new Date(Date.now() - lm * 30 * 864e5).toISOString());
    return json(req, { dry_run: true, expired: expiredRows.length, orphans: orphanRows.length, live_due: count ?? 0 });
  }

  let removed = 0;
  for (let i = 0; i < paths.length; i += BATCH) {
    const { error } = await db.storage.from('handover').remove(paths.slice(i, i + BATCH));
    if (error) { console.error('handover-purge remove', error); return json(req, { error: 'Could not delete some photos', removed }, 500); }
    removed += Math.min(BATCH, paths.length - i);
  }
  const ids = [...new Set(expiredRows.map((r) => r.handover_id))];
  if (ids.length) {
    const { error } = await db.from('handovers').update({ photo_paths: [] }).in('id', ids);
    if (error) { console.error('handover-purge rows', error); return json(req, { error: 'Photos deleted but the records were not cleared', removed }, 500); }
  }
  // Mechanix Live photos and clips are only needed for the Redo (30 days) and Shield (48 hours) windows, so they go after 3 months (live_months to change). Files first, then the rows.
  const liveMonths = Number.isInteger(body?.live_months) && body.live_months >= 1 ? body.live_months : 3;
  const liveCut = new Date(Date.now() - liveMonths * 30 * 864e5).toISOString();
  const { data: liveOld, error: e3 } = await db.from('live_updates').select('id,path').lt('created_at', liveCut).limit(1000);
  if (e3) { console.error('handover-purge live list', e3); return json(req, { error: 'Could not read the live updates list', removed }, 500); }
  let liveRemoved = 0;
  const liveRows = (liveOld ?? []) as { id: string; path: string }[];
  for (let i = 0; i < liveRows.length; i += BATCH) {
    const part = liveRows.slice(i, i + BATCH);
    const { error } = await db.storage.from('live-updates').remove(part.map((r) => r.path));
    if (error) { console.error('handover-purge live remove', error); return json(req, { error: 'Could not delete some live updates', removed, liveRemoved }, 500); }
    const { error: de } = await db.from('live_updates').delete().in('id', part.map((r) => r.id));
    if (de) { console.error('handover-purge live rows', de); return json(req, { error: 'Live files deleted but the records were not cleared', removed, liveRemoved }, 500); }
    liveRemoved += part.length;
  }
  await db.from('audit_log').insert({ action: 'handover_photos_purged', details: { expired: expiredRows.length, orphans: orphanRows.length, removed, live_removed: liveRemoved } });
  return json(req, { ok: true, expired: expiredRows.length, orphans: orphanRows.length, removed, live_removed: liveRemoved });
});
