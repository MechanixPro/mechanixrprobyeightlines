// Validation for creating a CRM team member. Pure so it can be tested without a server.
export const CRM_ROLES = ['sales', 'support', 'supervisor'] as const;
export type CrmRole = (typeof CRM_ROLES)[number];

export function cleanCrmUser(b: Record<string, unknown>): { ok: true; value: { name: string; email: string; role: CrmRole } } | { ok: false; error: string } {
  const name = String(b.name ?? '').trim().replace(/\s+/g, ' ');
  const email = String(b.email ?? '').trim().toLowerCase();
  const role = String(b.role ?? '') as CrmRole;
  if (name.length < 2 || name.length > 60) return { ok: false, error: 'Enter the person’s name' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 120) return { ok: false, error: 'Enter a valid email address' };
  if (!CRM_ROLES.includes(role)) return { ok: false, error: 'Choose sales, support or supervisor' };
  return { ok: true, value: { name, email, role } };
}
