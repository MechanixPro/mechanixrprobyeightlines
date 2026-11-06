// "Garage app" screen: the shared partner-garage desk (crm/garage-desk.js). It is hidden from anyone without Manage garages (see screens() in crm/crm.js),
// and the database functions refuse them too.
export async function render(root, ctx) { await ctx.garageDesk.mount(root); }
