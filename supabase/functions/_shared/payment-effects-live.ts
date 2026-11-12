// The real messaging steps for payment-effects.ts (Deno only).
import { rupee } from './util.ts';
import { sendSmart, TPL } from './whatsapp.ts';
import { afterConfirmationPaid } from './after-payment.ts';
import type { Deps } from './payment-effects.ts';

export const liveDeps: Deps = {
  async paidMessage(db, lead, bid, amount) {
    try { await sendSmart(db, lead, `Payment of ${rupee(amount)} received for ${bid ? 'booking ' + bid : 'your request'}. Your slot is confirmed. We will share your mechanic's details before the visit. Thank you!`, { name: TPL.paid(), params: [String(Math.round(amount)), bid ?? 'request'] }, 'system'); } catch (e) { console.error('whatsapp confirm failed', (e as Error).message); }
  },
  afterPaid: (db, leadId) => afterConfirmationPaid(db, leadId),
};
