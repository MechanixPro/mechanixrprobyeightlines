// A returning customer is a phone number with an earlier completed job. Everyone else is new and pays the smaller slot fee.
// deno-lint-ignore no-explicit-any
export async function isReturningCustomer(db: any, lead: { id: string; phone: string }): Promise<boolean> {
  const { count } = await db.from('leads').select('id', { count: 'exact', head: true }).eq('phone', lead.phone).eq('status', 'completed').neq('id', lead.id);
  return (count ?? 0) > 0;
}
