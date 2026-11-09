// Mechanix Live: photos and short clips shared by the mechanic or partner garage while a job is on. Pure checks plus two storage steps shared by tech-job and garage-app.
export const LIVE_TYPES: Record<string, { kind: 'photo' | 'clip'; ext: string }> = {
  'image/jpeg': { kind: 'photo', ext: 'jpg' }, 'image/png': { kind: 'photo', ext: 'png' }, 'image/webp': { kind: 'photo', ext: 'webp' },
  'video/mp4': { kind: 'clip', ext: 'mp4' }, 'video/quicktime': { kind: 'clip', ext: 'mov' }, 'video/webm': { kind: 'clip', ext: 'webm' },
};
export const LIVE_MAX_PER_REQUEST = 3;
const PATH = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp|mp4|mov|webm)$/;

/** The upload request: 1 to 3 files of one kind, each an allowed type. */
export function cleanLiveUpload(b: any): { ok: true; value: { kind: 'photo' | 'clip'; exts: string[] } } | { ok: false; error: string } {
  const types = Array.isArray(b?.types) ? b.types.map((t: unknown) => String(t).split(';')[0].trim().toLowerCase()) : [];
  if (!types.length || types.length > LIVE_MAX_PER_REQUEST) return { ok: false, error: `Send 1 to ${LIVE_MAX_PER_REQUEST} files at a time.` };
  if (!types.every((t: string) => LIVE_TYPES[t])) return { ok: false, error: 'Use a photo (JPEG, PNG, WebP) or a short video (MP4, MOV, WebM).' };
  const kinds = new Set(types.map((t: string) => LIVE_TYPES[t].kind));
  if (kinds.size !== 1) return { ok: false, error: 'Send photos or clips, not both in one go.' };
  return { ok: true, value: { kind: [...kinds][0], exts: types.map((t: string) => LIVE_TYPES[t].ext) } };
}

/** The finished uploads: each path must sit in this job's folder and look like one we issued. */
export function cleanLiveItems(b: any, leadId: string): { ok: true; value: { path: string; kind: 'photo' | 'clip' }[] } | { ok: false; error: string } {
  const raw = Array.isArray(b?.paths) ? b.paths.map((p: unknown) => String(p)) : [];
  if (!raw.length || raw.length > LIVE_MAX_PER_REQUEST) return { ok: false, error: 'Nothing to share.' };
  const out: { path: string; kind: 'photo' | 'clip' }[] = [];
  for (const p of raw) {
    if (!PATH.test(p) || !p.startsWith(leadId + '/')) return { ok: false, error: 'A file did not upload. Try again.' };
    const ext = p.split('.').pop() as string;
    out.push({ path: p, kind: ['mp4', 'mov', 'webm'].includes(ext) ? 'clip' : 'photo' });
  }
  return { ok: true, value: out };
}

type Db = { storage: any; rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: any; error: any }> };
/** Signed upload URLs for the files, in the job's folder. */
export async function liveUploadUrls(db: Db, leadId: string, body: any): Promise<{ status: number; body: any }> {
  const v = cleanLiveUpload(body);
  if (!v.ok) return { status: 400, body: { error: v.error } };
  const uploads: { path: string; url: string }[] = [];
  for (const ext of v.value.exts) {
    const path = `${leadId}/${crypto.randomUUID()}.${ext}`;
    const { data, error } = await db.storage.from('live-updates').createSignedUploadUrl(path);
    if (error || !data) { console.error('live upload url', error); return { status: 500, body: { error: 'Could not save. Please try again.' } }; }
    uploads.push({ path, url: data.signedUrl });
  }
  return { status: 200, body: { uploads, kind: v.value.kind } };
}
/** Record the finished uploads after checking the files are really there. */
export async function liveAdd(db: Db, leadId: string, by: 'mechanic' | 'garage', byId: string | null, body: any): Promise<{ status: number; body: any }> {
  const v = cleanLiveItems(body, leadId);
  if (!v.ok) return { status: 400, body: { error: v.error } };
  const { data: files } = await db.storage.from('live-updates').list(leadId, { limit: 200 });
  const there = new Set((files ?? []).map((f: { name: string }) => `${leadId}/${f.name}`));
  if (!v.value.every((i) => there.has(i.path))) return { status: 400, body: { error: 'A file did not upload. Try again.' } };
  for (const i of v.value) {
    const { data, error } = await db.rpc('live_update_add', { p_lead: leadId, p_kind: i.kind, p_path: i.path, p_by: by, p_by_id: byId });
    if (error) { console.error('live add', error.code); return { status: 500, body: { error: 'Could not save. Please try again.' } }; }
    if (data && data.ok === false) return { status: 409, body: { error: data.error ?? 'Could not share this.' } };
  }
  return { status: 200, body: { ok: true, count: v.value.length } };
}
