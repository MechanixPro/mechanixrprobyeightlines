// POST /functions/v1/submit-rating  { ref, k, rating, comment? } or { t, rating, comment? } — a customer rates a completed job. Public. Proof is either the signed link (ref + k) or the private tracking token (t, from the tracking page).
// A rating of 3 or less opens a ticket for the Care Buddy and tells the supervisors by email.
import { adminDb, env, json, corsHeaders } from '../_shared/util.ts';
import { cleanRating, cleanRatingBody, ratingTokenOk } from '../_shared/rating.ts';
import { sendEmail } from '../_shared/resend.ts';
import { supervisorEmails } from '../_shared/desk-notify.ts';
import { refFilter, leadLabel } from '../_shared/booking-id.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405);
  const raw = await req.json().catch(() => ({}));
  const db = adminDb();
  const tt = String(raw?.t ?? '').toLowerCase();
  let x: { ref: string; k: string; rating: number; comment: string | null }, lead: any;
  if (tt) {
    // The tracking page: the private link proves it is this customer's booking. Same rating and comment rules as the signed link.
    const r = cleanRatingBody(raw);
    if (!r.ok) return json(req, { error: r.error }, 400);
    if (!/^[0-9a-f]{32}$/.test(tt)) return json(req, { error: 'This link is not valid.' }, 403);
    const { data: sec } = await db.from('booking_secrets').select('lead_id').eq('track_token', tt).maybeSingle();
    if (!sec) return json(req, { error: 'This link is not valid.' }, 403);
    ({ data: lead } = await db.from('leads').select('id,ref,booking_id,name,crm_owner,status').eq('id', sec.lead_id).is('deleted_at', null).maybeSingle());
    x = { ref: lead?.ref ?? '', k: '', rating: r.value.rating, comment: r.value.comment };
  } else {
    const v = cleanRating(raw);
    if (!v.ok) return json(req, { error: v.error }, 400);
    x = v.value;
    if (!(await ratingTokenOk(env('RATING_SECRET'), x.ref, x.k))) return json(req, { error: 'This rating link is not valid.' }, 403);
    ({ data: lead } = await db.from('leads').select('id,ref,booking_id,name,crm_owner,status').or(refFilter(x.ref)).is('deleted_at', null).maybeSingle());
  }
  if (!lead || lead.status !== 'completed') return json(req, { error: 'You can rate a booking after the job is done.' }, 400);

  const { data: old } = await db.from('lead_ratings').select('rating,created_at').eq('lead_id', lead.id).maybeSingle();
  if (old && Date.now() - Date.parse(old.created_at) > 24 * 3600_000) return json(req, { ok: true, already: true, rating: old.rating });
  const { error } = await db.from('lead_ratings').upsert({ lead_id: lead.id, rating: x.rating, comment: x.comment, updated_at: new Date().toISOString() }, { onConflict: 'lead_id' });
  if (error) { console.error('rating', error); return json(req, { error: 'Could not save your rating. Please try again.' }, 500); }
  await db.from('crm_activities').insert({ lead_id: lead.id, actor: null, kind: 'note', body: `Customer rated the service ${x.rating} out of 5${x.comment ? ': ' + x.comment.slice(0, 200) : ''}` }).then(() => {}, () => {});

  if (x.rating <= 3 && !old) {
    try {
      await db.from('crm_tickets').insert({ category: 'booking_issue', priority: x.rating <= 2 ? 'critical' : 'high', title: `Low rating (${x.rating}/5) for ${leadLabel(lead)}`, body: x.comment ?? 'The customer gave a low rating with no comment. Call them.', lead_id: lead.id, owner: lead.crm_owner });
      const to = await supervisorEmails(db);
      const text = `${lead.name} rated ${lead.booking_id ? 'booking ' + lead.booking_id : 'a job'} ${x.rating} out of 5.${x.comment ? '\n\nThey wrote: ' + x.comment : ''}\n\nA ticket is open in the desk. Please call the customer today.`;
      for (const addr of to) await sendEmail({ to: addr, subject: `Low rating (${x.rating}/5) for ${leadLabel(lead)}`, html: `<p>${text.replace(/\n/g, '<br>').replace(/</g, '&lt;')}</p>`, text, tags: { template: 'low_rating' } });
    } catch (e) { console.error('low rating follow-up', e); }
  }
  return json(req, { ok: true, rating: x.rating });
});
