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
  if (body?.dry_run === true) return json(req, { dry_run: true, expired: expiredRows.length, orphans: orphanRows.length });

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
  await db.from('audit_log').insert({ action: 'handover_photos_purged', details: { expired: expiredRows.length, orphans: orphanRows.length, removed } });
  return json(req, { ok: true, expired: expiredRows.length, orphans: orphanRows.length, removed });
});
