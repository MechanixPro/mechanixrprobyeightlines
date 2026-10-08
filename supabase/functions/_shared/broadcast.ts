// Validation for offer emails, and who is allowed to receive them.
export type Broadcast = { subject: string; preheader: string; headline: string; body: string; ctaText: string; ctaUrl: string };
const clean = (v: unknown, max: number) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max + 1);

export function cleanBroadcast(b: Record<string, unknown>): { ok: true; value: Broadcast } | { ok: false; error: string } {
  const subject = clean(b.subject, 120), headline = clean(b.headline, 120), body = clean(b.body, 2000);
  const ctaText = clean(b.ctaText, 40), ctaUrl = clean(b.ctaUrl, 300);
  if (!subject) return { ok: false, error: 'Add a subject.' };
  if (!headline) return { ok: false, error: 'Add a headline.' };
  if (!body) return { ok: false, error: 'Write the message.' };
  if (subject.length > 120) return { ok: false, error: 'The subject is too long (120 characters at most).' };
  if (headline.length > 120) return { ok: false, error: 'The headline is too long (120 characters at most).' };
  if (body.length > 2000) return { ok: false, error: 'The message is too long (2,000 characters at most).' };
  if (ctaText.length > 40) return { ok: false, error: 'The button text is too long (40 characters at most).' };
  if (!!ctaText !== !!ctaUrl) return { ok: false, error: 'Fill both the button text and its link, or leave both empty.' };
  if (ctaUrl && !/^https:\/\/[^\s<>"]+$/.test(ctaUrl)) return { ok: false, error: 'The button link must start with https://' };
  const preheader = clean(b.preheader, 140) || headline;
  return { ok: true, value: { subject, preheader: preheader.slice(0, 140), headline, body, ctaText, ctaUrl } };
}

export type Recipient = { email?: string | null; email_marketing_consent?: boolean | null; email_unsubscribed_at?: string | null; blocked?: boolean | null };
export const isEligible = (c: Recipient) => !!c.email && c.email_marketing_consent === true && !c.email_unsubscribed_at && !c.blocked;
