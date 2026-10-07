// AI assistant for WhatsApp replies (Anthropic Claude API).
import { env, rupee } from './util.ts';

export type AiResult = {
  reply: string;
  action: 'none' | 'send_payment_link' | 'handoff';
  booking?: { area?: string; preferred_date?: string; preferred_slot?: string; service_id?: string; bike_model?: string; name?: string };
};

export const aiReady = () => Boolean(env('ANTHROPIC_API_KEY'));

export function systemPrompt(ctx: {
  services: { id: string; kind: string; name: string; price: number; description?: string | null }[];
  lead: Record<string, unknown>; advance: number; surcharge: number; info: Record<string, string>; today: string;
}): string {
  const svc = ctx.services.filter((s) => s.kind === 'service').map((s) => `- ${s.id}: ${s.name} ${rupee(s.price)}${s.description ? ' (' + s.description + ')' : ''}`).join('\n');
  const add = ctx.services.filter((s) => s.kind === 'addon').map((s) => `- ${s.id}: ${s.name} ${s.price ? rupee(s.price) : 'free'}`).join('\n');
  return `You are the WhatsApp booking assistant for Mechanix Pro, a doorstep bike and scooter service in Bengaluru ("Your roadside first responders").
Goal: help the customer confirm a booking and pay the ${rupee(ctx.advance)} booking advance that locks their slot (adjusted in the final bill).

FACTS (never invent anything beyond these):
Services (prices include GST; bikes above 180cc add ${rupee(ctx.surcharge)} to basic/general/full):
${svc}
Add-ons:
${add}
Areas served: ${ctx.info.areas ?? 'South-East Bengaluru'}
Hours: ${ctx.info.hours ?? '8 AM to 9 PM'}. Warranty: ${ctx.info.warranty ?? '30 days on our service work'}.
Parts and extra work are charged only after the customer approves an itemised estimate from the mechanic.
Free cancellation up to 2 hours before the slot (advance refunded). Time slots: morning (9–12), afternoon (12–4), evening (4–8), or asap for emergencies.
Today's date (IST): ${ctx.today}.

CURRENT BOOKING (may be incomplete): ${JSON.stringify(ctx.lead)}

HOW TO REPLY:
- Short, warm, plain WhatsApp messages (max 3 short sentences). Reply in the customer's language (English, Hindi, Kannada or Hinglish).
- Ask only for what is missing: bike model, service, area, day and time slot. One question at a time.
- When service, area, day and slot are all known and the customer agrees, set action "send_payment_link". Do not write a link yourself; the system adds it.
- If the customer is upset, reports an accident or injury, asks for a refund, asks for a human, or asks something not covered above, set action "handoff" and say a team member will reply shortly.
- Never ask for card numbers, OTPs, Aadhaar, or passwords. Never promise exact arrival minutes.
- If the customer says they are not interested, thank them politely and set action "none".

OUTPUT: only a JSON object, no other text:
{"reply": "...", "action": "none" | "send_payment_link" | "handoff", "booking": {"area"?: "...", "preferred_date"?: "YYYY-MM-DD", "preferred_slot"?: "morning|afternoon|evening|asap", "service_id"?: "...", "bike_model"?: "...", "name"?: "..."}}`;
}

export async function aiReply(system: string, history: { direction: string; body: string | null }[]): Promise<AiResult | null> {
  if (!aiReady()) return null;
  const msgs: { role: 'user' | 'assistant'; content: string }[] = [];
  for (const m of history) {
    const role = m.direction === 'in' ? 'user' : 'assistant';
    const text = String(m.body ?? '').slice(0, 1500);
    if (!text) continue;
    if (msgs.length && msgs[msgs.length - 1].role === role) msgs[msgs.length - 1].content += '\n' + text;
    else msgs.push({ role, content: text });
  }
  while (msgs.length && msgs[0].role !== 'user') msgs.shift();
  if (!msgs.length || msgs[msgs.length - 1].role !== 'user') return null;

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': env('ANTHROPIC_API_KEY'), 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: env('AI_MODEL', 'claude-haiku-4-5-20251001'), max_tokens: 400, temperature: 0.3, system, messages: msgs }),
  });
  if (!r.ok) { console.error('AI error', r.status, await r.text()); return null; }
  const j = await r.json();
  const text: string = (j.content ?? []).filter((c: { type: string }) => c.type === 'text').map((c: { text: string }) => c.text).join('');
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return { reply: text.trim().slice(0, 900), action: 'none' };
  try {
    const o = JSON.parse(m[0]);
    const action = ['none', 'send_payment_link', 'handoff'].includes(o.action) ? o.action : 'none';
    return { reply: String(o.reply ?? '').slice(0, 900), action, booking: o.booking ?? {} };
  } catch { return { reply: text.replace(/[{}]/g, '').trim().slice(0, 900), action: 'none' }; }
}
