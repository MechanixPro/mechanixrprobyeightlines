import { rpc, esc, head, empty, tag, modal, field, toast, supabase, confirmBox, clean } from '../ui.js';

const PAGE_LABEL = { dashboard: 'Dashboard', inbox: 'Inbox', leads: 'Leads', rsa: 'RSA Cases', tickets: 'Tickets', garage_visits: 'Garage Visits', garages: 'Garages', mechanics: 'Mechanics', knowledge: 'Knowledge', team: 'Team' };
const ACTION_LABEL = { view_all_leads: 'See all leads', assign_leads: 'Assign leads', take_leads: 'Take unassigned leads', add_leads: 'Add leads', edit_leads: 'Edit and log leads', delete_leads: 'Delete leads', create_bookings: 'Create bookings', edit_targets: 'Edit targets', manage_users: 'Manage Care Buddies',
  view_attribution: 'See lead sources', view_team_performance: 'See team performance', send_payment_link: 'Send payment links', create_coupons: 'Create coupons', edit_price_list: 'Edit price list', view_reports: 'View reports', export: 'Export data', close_chats: 'Close chats',
  create_tickets: 'Create tickets', resolve_tickets: 'Resolve tickets', view_legal_tickets: 'See legal tickets', manage_rsa: 'Manage RSA cases', schedule_visits: 'Schedule visits', manage_garages: 'Manage garages', view_garage_bank: 'See garage payout details', manage_mechanics: 'Manage mechanics', edit_knowledge: 'Edit knowledge', review_knowledge: 'Publish knowledge' };
const GROUPS = [['Leads and bookings', ['view_all_leads', 'take_leads', 'add_leads', 'edit_leads', 'assign_leads', 'delete_leads', 'create_bookings', 'close_chats', 'send_payment_link']],
  ['Support and roadside', ['create_tickets', 'resolve_tickets', 'view_legal_tickets', 'manage_rsa']], ['Garages and mechanics', ['schedule_visits', 'manage_garages', 'view_garage_bank', 'manage_mechanics']],
  ['Knowledge', ['edit_knowledge', 'review_knowledge']], ['Management', ['edit_targets', 'manage_users', 'view_attribution', 'view_team_performance', 'view_reports', 'export', 'create_coupons', 'edit_price_list']]];

export async function render(root, ctx) {
  const auto = ctx.can('manage_users') ? await rpc('crm_automation_status').catch(() => null) : null;
  const [users, dash] = await Promise.all([rpc('crm_users_list'), ctx.can('view_team_performance') || ctx.page('dashboard') ? rpc('crm_dashboard', {}).catch(() => null) : null]);
  const team = dash?.targets?.team;
  const canUsers = ctx.can('manage_users'), canTargets = ctx.can('edit_targets');
  root.innerHTML = `${head('Team', 'Everyone on the sales and support team is a Care Buddy. The permission boxes decide what each person can open and do.')}
    ${canTargets && team ? `<form id="teamTargets" class="card row wrap"><b>Team targets</b>${field('Per day', 'd', { type: 'number', min: 0, max: 5000, value: team.daily_target, half: true })}${field('Per month', 'm', { type: 'number', min: 0, max: 50000, value: team.monthly_target, half: true })}<button class="btn" type="submit">Save</button></form>` : ''}
    <div class="table-wrap"><table><thead><tr><th>Name</th><th>Role</th><th>Designation</th><th>Daily</th><th>Monthly</th><th>Permissions</th><th></th></tr></thead><tbody>
    ${users.map((u) => `<tr class="${u.active ? '' : 'off'}"><td><b>${esc(u.name)}</b></td><td>${esc(u.role)}</td><td>${esc(u.designation || '—')}</td>
      <td>${canTargets ? `<input class="tgt" type="number" min="0" max="100" value="${u.daily_target}" data-user="${u.user_id}" data-k="d" aria-label="Daily target for ${esc(u.name)}">` : u.daily_target}</td>
      <td>${canTargets ? `<input class="tgt" type="number" min="0" max="5000" value="${u.monthly_target}" data-user="${u.user_id}" data-k="m" aria-label="Monthly target for ${esc(u.name)}">` : u.monthly_target}</td>
      <td>${u.custom_permissions ? tag('Custom', 'soft') : 'Preset'}</td><td>${canUsers ? `<button class="btn sm" type="button" data-perm="${u.user_id}">Permissions</button> <button class="btn ghost sm" type="button" data-active="${u.user_id}" data-on="${u.active ? 0 : 1}">${u.active ? 'Switch off' : 'Switch on'}</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">No team members yet.</td></tr>'}</tbody></table></div>
    ${auto ? automationPanel(auto) : ''}
    ${ctx.me.role === 'supervisor' ? `<h3>WhatsApp (AiSensy)</h3><div class="card"><p class="small muted">The desk's own WhatsApp number. Check the connection, see whether the message templates are approved, then create the campaigns that send them.</p><div class="row wrap"><button class="btn" type="button" data-wa="status">Check connection</button><button class="btn" type="button" data-wa="templates">Template status</button><button class="btn primary" type="button" data-wa="create_campaigns">Create campaigns</button></div><pre class="wa-out" id="waOut" hidden></pre></div>` : ''}
    ${canUsers ? `<h3>Add a Care Buddy</h3><form id="userForm" class="user-form" novalidate><input name="name" placeholder="Full name" autocomplete="off" aria-label="Full name"><input name="email" type="email" placeholder="Work email" autocomplete="off" aria-label="Email"><select name="role" aria-label="Starting permissions"><option value="sales">Sales (starting permissions)</option><option value="support">Support (starting permissions)</option><option value="supervisor">Supervisor (everything)</option></select><button class="btn primary" type="submit">Add</button></form><p class="small muted">They sign in with a 6-digit code sent to that email. You can change any box afterwards.</p><p class="err" id="userErr" role="alert"></p>` : ''}`;
  root.querySelectorAll('[data-wa]').forEach((b) => b.addEventListener('click', async () => {
    const out = root.querySelector('#waOut'); out.hidden = false; out.textContent = 'Working…'; b.disabled = true;
    try {
      const fn = b.dataset.wa === 'status' ? 'aisensy-status' : 'aisensy-setup';
      const { data, error } = await supabase().functions.invoke(fn, { body: { action: b.dataset.wa } });
      if (error || data?.error) { let msg = data?.error; if (!msg && error?.context?.json) { try { msg = (await error.context.json()).error; } catch (x) { /* ignore */ } } throw new Error(msg || 'Could not reach the desk service.'); }
      out.textContent = waSummary(b.dataset.wa, data);
    } catch (x) { out.textContent = clean(x); } finally { b.disabled = false; }
  }));
  root.querySelectorAll('[data-sw]').forEach((c) => c.addEventListener('change', async () => { try { await rpc('crm_automation_set', { p_switch: c.dataset.sw, p_on: c.checked }); toast(c.checked ? 'Switched on.' : 'Switched off.'); } catch (x) { c.checked = !c.checked; toast(clean(x), true); } }));
  const tt = root.querySelector('#teamTargets');
  if (tt) tt.addEventListener('submit', async (e) => { e.preventDefault(); try { await rpc('crm_set_targets', { p_team_daily: Number(tt.d.value), p_team_monthly: Number(tt.m.value) }); toast('Team targets saved.'); } catch (x) { toast(clean(x), true); } });
  root.querySelectorAll('.tgt').forEach((i) => i.addEventListener('change', async () => {
    const row = i.closest('tr'), d = row.querySelector('[data-k=d]'), m = row.querySelector('[data-k=m]');
    try { await rpc('crm_set_targets', { p_user: i.dataset.user, p_user_daily: Number(d.value) || 0, p_user_monthly: Number(m.value) || 0 }); toast('Target saved.'); } catch (x) { toast(clean(x), true); }
  }));
  root.querySelectorAll('[data-perm]').forEach((b) => b.addEventListener('click', () => perms(users.find((u) => u.user_id === b.dataset.perm), ctx)));
  root.querySelectorAll('[data-active]').forEach((b) => b.addEventListener('click', async () => {
    const on = b.dataset.on === '1';
    if (!on && !(await confirmBox('Switch this person off? Their open leads go back to the unassigned queue.', 'Switch off', true))) return;
    try { await rpc('crm_set_user_active', { p_user: b.dataset.active, p_active: on }); toast('Updated.'); ctx.reload(); } catch (x) { toast(clean(x), true); }
  }));
  const uf = root.querySelector('#userForm');
  if (uf) uf.addEventListener('submit', async (e) => {
    e.preventDefault(); const err = root.querySelector('#userErr'); err.textContent = '';
    const { data, error } = await supabase().functions.invoke('crm-user', { body: { name: uf.name.value, email: uf.email.value, role: uf.role.value } });
    if (error || data?.error) { let msg = data?.error; if (!msg && error?.context?.json) { try { msg = (await error.context.json()).error; } catch (x) { /* ignore */ } } err.textContent = msg || 'Could not add that person.'; return; }
    toast('Added. They can sign in with a code sent to their email.'); ctx.reload();
  });
}

function perms(u, ctx) {
  const p = u.permissions || { pages: {}, actions: {} };
  const body = `<fieldset class="checks"><legend class="label">Pages this person can open</legend><div class="check-grid">${Object.keys(PAGE_LABEL).map((k) => `<label class="check"><input type="checkbox" name="page" value="${k}"${p.pages[k] ? ' checked' : ''}><span>${PAGE_LABEL[k]}</span></label>`).join('')}</div></fieldset>
    ${GROUPS.map(([t, keys]) => `<fieldset class="checks"><legend class="label">${t}</legend><div class="check-grid">${keys.map((k) => `<label class="check"><input type="checkbox" name="action" value="${k}"${p.actions[k] ? ' checked' : ''}><span>${ACTION_LABEL[k]}</span></label>`).join('')}</div></fieldset>`).join('')}
    ${field('Designation', 'designation', { type: 'select', blank: 'Keep as is', value: u.designation || '', options: [['sales', 'Sales'], ['support', 'Support']] })}`;
  const m = modal({ title: `Permissions for ${u.name}`, wide: true, intro: u.role === 'supervisor' ? 'Supervisors keep every permission by default.' : 'Tick what this person may open and do. The database enforces every box, not just the screen.', body,
    submit: 'Save permissions', onSubmit: async (f, d, close) => {
      const pages = Object.fromEntries(Object.keys(PAGE_LABEL).map((k) => [k, (d.page || []).includes(k)]));
      const actions = Object.fromEntries(Object.keys(ACTION_LABEL).map((k) => [k, (d.action || []).includes(k)]));
      await rpc('crm_set_permissions', { p_user: u.user_id, p_perms: { pages, actions }, p_designation: d.designation || null });
      close(); toast('Permissions saved. They apply the next time that person opens the desk.'); ctx.reload(); } });
  const reset = document.createElement('button'); reset.type = 'button'; reset.className = 'btn ghost'; reset.textContent = 'Reset to preset'; m.form.querySelector('.row.end').prepend(reset);
  reset.addEventListener('click', async () => { try { await rpc('crm_reset_permissions', { p_user: u.user_id }); m.close(); toast('Reset to the preset.'); ctx.reload(); } catch (x) { toast(clean(x), true); } });
}

function waSummary(kind, d) {
  const yes = (v) => (v ? 'yes' : 'NO');
  if (kind === 'status') {
    const s = d.secrets_set || {};
    return [`Campaign key set: ${yes(s.campaign_key)}`, `Project password set: ${yes(s.project_password)}`, `Project id set: ${yes(s.project_id)}`, `Flow secret set: ${yes(s.flow_secret)}`, `Webhook secret set: ${yes(s.webhook_shared_secret)}`,
      d.project ? `AiSensy project: ${d.project.status === 200 ? 'connected as ' + (d.project.name || 'project') : 'problem (' + d.project.status + ') ' + (d.project.note || '')}` : 'AiSensy project: not checked',
      d.webhooks ? `Native webhooks: ${d.webhooks.subscriptions ? d.webhooks.subscriptions.length + ' subscribed' : 'could not read'}` : ''].filter(Boolean).join('\n');
  }
  if (kind === 'templates') return (d.templates || []).filter((t) => /^mxp_desk_/.test(t.name)).map((t) => `${t.name}: ${t.status}`).join('\n') || 'No desk templates found.';
  if (kind === 'create_campaigns') return (d.results || []).map((r) => `${r.campaign}: ${r.skipped || (r.status === 200 ? 'created' : (r.response && r.response.message) || 'failed')}`).join('\n');
  return JSON.stringify(d, null, 2);
}

const ago = (iso) => { if (!iso) return 'never'; const m = Math.round((Date.now() - new Date(iso).getTime()) / 60e3); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.floor(m / 60) + ' h ago' : Math.floor(m / 1440) + ' d ago'; };
function automationPanel(a) {
  const sw = a.switches, hb = a.heartbeat || {}, auto = hb.automation, poll = hb.poll, cron = a.cron || [];
  const live = (iso, minutes) => iso && Date.now() - new Date(iso).getTime() < minutes * 60e3;
  const dot = (ok) => `<span class="dot ${ok ? 'ok' : 'bad'}" aria-hidden="true"></span>`;
  const camp = a.campaigns || {};
  const row = (k, t, hint) => `<label class="check auto-sw"><input type="checkbox" data-sw="${k}" ${sw[k] ? 'checked' : ''}><span><b>${t}</b><small>${hint}</small></span></label>`;
  return `<h3>Automation</h3><div class="card auto">
    <div class="auto-grid">${row('rating', 'Ask for a rating after each job', 'Two hours after a job is completed, once, 9 AM to 8 PM. Low ratings open a ticket and email the supervisors.')}
      ${row('sla', 'Alert when a customer waits', 'An email to the supervisors after 15 minutes without an answer, or a new lead with no owner.')}
      ${row('report', 'Daily report at 9:30 PM', 'Leads, bookings, ratings and each Care Buddy’s day, emailed to the supervisors.')}</div>
    <ul class="auto-status">
      <li>${dot(live(poll && poll.at, 20) || !cron.some((c) => c.name === 'desk-poll-replies'))} Customer replies checked ${poll ? ago(poll.at) : 'not yet'}${poll ? ` (${poll.checked} leads)` : ''}</li>
      <li>${dot(live(auto && auto.at, 10))} Automation last ran ${auto ? ago(auto.at) : 'not yet'}</li>
      <li>${dot(sw.campaigns_ready)} WhatsApp templates: ${Object.keys(camp).length ? Object.keys(camp).map((k) => k.replace('mxp_desk_', '') + (camp[k] ? ' ready' : ' waiting')).join(', ') : 'waiting for WhatsApp to approve them'}</li>
      <li>${dot(true)} Ratings in the last 30 days: ${a.ratings_30d.count}${a.ratings_30d.avg ? ' (average ' + a.ratings_30d.avg + ' of 5)' : ''}</li>
      <li>${dot(cron.length >= 3 && cron.every((c) => c.active))} Schedules: ${cron.map((c) => c.name.replace('desk-', '')).join(', ') || 'none'}</li></ul>
    ${(a.jobs || []).length ? `<p class="small muted">Recent: ${a.jobs.map((j) => `${j.job} ${ago(j.ran_at)}${j.ok ? '' : ' (problem)'}`).join(' · ')}</p>` : ''}</div>`;
}
