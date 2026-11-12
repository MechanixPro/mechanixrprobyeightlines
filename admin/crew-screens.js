// Crew Desk screens inside the Admin: Call now, Follow-ups, Playbooks, Web leads, RSA Cases, Tickets, Garage Visits, Knowledge, Team.
// The pages are the SAME files Crew uses (copied to /crew/ by scripts/build_admin.sh) and every call still goes through the database's own permission checks.
// Crew styles are scoped under .crewhost (generated at build time) so they cannot change how the rest of the Admin looks.
export const CREW_TABS = ['callnow', 'followups', 'playbooks', 'webleads', 'rsa', 'tickets', 'visits', 'knowledge', 'team'];
export const isCrewTab = (t) => CREW_TABS.includes(t);
export const crewView = (title) => `<div class="view-head"><div><h1>${title}</h1></div></div><div class="crewhost" id="crewRoot" aria-live="polite"><p class="muted">Loading…</p></div>`;

let loaded = null;
/** deps: { sb, me, openLead(id) }. Loads the Crew page once, then draws it; the page calls ctx.reload() to draw itself again. */
export async function mountCrew(tab, root, deps) {
  if (!isCrewTab(tab) || !root) return;
  try {
    loaded = loaded || { ui: await import('/crew/ui.js') };
    loaded.ui.setClient(deps.sb);
    const mod = await import(`/crew/pages/${tab}.js`);
    let me = deps.me || {}; try { const m = await loaded.ui.rpc('crm_me'); if (m) me = { ...me, ...m }; } catch (e) { /* keep the Admin's own details */ }
    const ctx = {
      me, can: () => true, page: () => true,
      reload: () => mountCrew(tab, root, deps), go: () => {},
      openLead: (id) => deps.openLead && deps.openLead(id),
      users: async () => { try { return await loaded.ui.rpc('crm_users_list'); } catch (e) { return []; } },
      showPlaybook: async (id) => { const k = await import('/crew/pages/knowledge.js'); return k.showPlaybook && k.showPlaybook(id); },
    };
    const holder = document.createElement('div'); holder.style.display = 'contents';
    await mod.render(holder, ctx); root.replaceChildren(holder);
  } catch (e) {
    console.error('crew screen', tab, e);
    root.innerHTML = '<div class="empty"><p><b>This screen could not be shown.</b></p><p class="muted small">' + String((e && e.message) || e).replace(/[<>&]/g, '') + '</p><button class="btn btn-ghost" type="button" id="crewRetry">Try again</button></div>';
    const b = root.querySelector('#crewRetry'); if (b) b.addEventListener('click', () => mountCrew(tab, root, deps));
  }
}
