// Duplicates panel for the Customers page: customers who share one phone number, merge with a confirm, undo for admins.
// Screen code is shared with Crew (dupes-view.js). Money shows here because this is the Admin desk.
import { createDupes } from './dupes-view.js';

export function createDupesPanel({ rpc, toast }) {
  const view = createDupes({ rpc, toast, isAdmin: true, desk: 'admin' });
  return { mount: (el) => view.mount(el) };
}
