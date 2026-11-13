// A returning customer is a phone number with an earlier completed job. Everyone else is new and pays the smaller slot fee.
// deno-lint-ignore no-explicit-any
export async function isReturningCustomer(db: any, lead: { id: string; phone: string }): Promise<boolean> {
  const { count } = await db.from('leads').select('id', { count: 'exact', head: true }).eq('phone', lead.phone).eq('status', 'completed').neq('id', lead.id);
  return (count ?? 0) > 0;
}

/** Find the customer for a phone number, or create one. A public form can never change who an existing customer is: the saved name stays, and the email is filled only when none is saved yet. */
// deno-lint-ignore no-explicit-any
export async function findOrCreateCustomer(db: any, c: { phone: string; name: string; email?: string | null }): Promise<{ data: { id: string; blocked: boolean | null } | null; error: unknown }> {
  const pick = () => db.from('customers').select('id,blocked,email').eq('phone', c.phone).maybeSingle();
  let { data, error } = await pick();
  if (error) return { data: null, error };
  if (!data) {
    const ins = await db.from('customers').insert({ phone: c.phone, name: c.name, ...(c.email ? { email: c.email } : {}) }).select('id,blocked,email').single();
    if (!ins.error) return { data: ins.data, error: null };
    if (ins.error.code !== '23505') return { data: null, error: ins.error };   // someone created it a moment ago: read it
    ({ data, error } = await pick());
    if (error || !data) return { data: null, error: error ?? new Error('customer not found') };
  }
  if (!data.email && c.email) await db.from('customers').update({ email: c.email }).eq('id', data.id);
  return { data, error: null };
}
