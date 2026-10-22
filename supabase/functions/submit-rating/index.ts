// POST /functions/v1/submit-rating  { ref, k, rating, comment? } — a customer rates a completed job from the link we sent. Public, but the link signature (k) must match.
// A rating of 3 or less opens a ticket for the Care Buddy and tells the supervisors by email.
import { adminDb, env, json, corsHeaders } from '../_shared/util.ts';
import { cleanRating, ratingTokenOk } from '../_shared/rating.ts';
import { sendEmail } from '../_shared/resend.ts';
import { supervisorEmails } from '../_shared/desk-notify.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405);
  const v = cleanRating(await req.json().catch(() => ({})));
  if (!v.ok) return json(req, { error: v.error }, 400);
  const x = v.value;
  if (!(await ratingTokenOk(env('RATING_SECRET'), x.ref, x.k))) return json(req, { error: 'This rating link is not valid.' }, 403);
  const db = adminDb();
  const { data: lead } = await db.from('leads').select('id,ref,name,crm_owner,status').eq('ref', x.ref).is('deleted_at', null).maybeSingle();
  if (!lead || lead.status !== 'completed') return json(req, { error: 'You can rate a booking after the job is done.' }, 400);

  const { data: old } = await db.from('lead_ratings').select('rating,created_at').eq('lead_id', lead.id).maybeSingle();
  if (old && Date.now() - Date.parse(old.created_at) > 24 * 3600_000) return json(req, { ok: true, already: true, rating: old.rating });
  const { error } = await db.from('lead_ratings').upsert({ lead_id: lead.id, rating: x.rating, comment: x.comment, updated_at: new Date().toISOString() }, { onConflict: 'lead_id' });
  if (error) { console.error('rating', error); return json(req, { error: 'Could not save your rating. Please try again.' }, 500); }
  await db.from('crm_activities').insert({ lead_id: lead.id, actor: null, kind: 'note', body: `Customer rated the service ${x.rating} out of 5${x.comment ? ': ' + x.comment.slice(0, 200) : ''}` }).then(() => {}, () => {});

  if (x.rating <= 3 && !old) {
    try {
      await db.from('crm_tickets').insert({ category: 'booking_issue', priority: x.rating <= 2 ? 'critical' : 'high', title: `Low rating (${x.rating}/5) for ${lead.ref}`, body: x.comment ?? 'The customer gave a low rating with no comment. Call them.', lead_id: lead.id, owner: lead.crm_owner });
      const to = await supervisorEmails(db);
      const text = `${lead.name} rated booking ${lead.ref} ${x.rating} out of 5.${x.comment ? '\n\nThey wrote: ' + x.comment : ''}\n\nA ticket is open in the desk. Please call the customer today.`;
      for (const addr of to) await sendEmail({ to: addr, subject: `Low rating (${x.rating}/5) for ${lead.ref}`, html: `<p>${text.replace(/\n/g, '<br>').replace(/</g, '&lt;')}</p>`, text, tags: { template: 'low_rating' } });
    } catch (e) { console.error('low rating follow-up', e); }
  }
  return json(req, { ok: true, rating: x.rating });
});
