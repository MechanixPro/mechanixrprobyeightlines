// Who hears about desk alerts and reports: the owner logins and the active supervisors.
export async function supervisorEmails(db: any): Promise<string[]> {
  const ids = new Set<string>();
  const [{ data: admins }, { data: sups }] = await Promise.all([db.from('admins').select('user_id'), db.from('crm_users').select('user_id').eq('role', 'supervisor').eq('active', true)]);
  for (const a of [...(admins ?? []), ...(sups ?? [])]) ids.add(a.user_id);
  const out = new Set<string>();
  for (const id of ids) { try { const { data } = await db.auth.admin.getUserById(id); const e = data?.user?.email; if (e && !/@example\.invalid$/.test(e)) out.add(e.toLowerCase()); } catch { /* skip */ } }
  return [...out];
}

/** Everyone on the desk: the owner logins and every active Care Buddy and supervisor. */
export async function teamEmails(db: any): Promise<string[]> {
  const ids = new Set<string>();
  const [{ data: admins }, { data: crew }] = await Promise.all([db.from('admins').select('user_id'), db.from('crm_users').select('user_id').eq('active', true)]);
  for (const a of [...(admins ?? []), ...(crew ?? [])]) ids.add(a.user_id);
  const out = new Set<string>();
  for (const id of ids) { try { const { data } = await db.auth.admin.getUserById(id); const e = data?.user?.email; if (e && !/@example\.invalid$/.test(e)) out.add(e.toLowerCase()); } catch { /* skip */ } }
  return [...out];
}
