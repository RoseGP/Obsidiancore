/**
 * "CRM records changed" signal. Screens that add or change leads, contacts, companies or tasks call
 * notifyCrmChanged(); anything that keeps its own copy (the app-level contact list used by search and the
 * dashboard, the Tasks views) listens with onCrmChanged() and reloads from the server.
 */
export type CrmChangeKind = 'lead' | 'contact' | 'company' | 'task' | 'deal';
const EVENT = 'obsidian:crm-changed';

export function notifyCrmChanged(kind: CrmChangeKind) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { kind } }));
}

export function onCrmChanged(fn: (kind: CrmChangeKind) => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const h = (e: Event) => fn(((e as CustomEvent).detail?.kind || 'lead') as CrmChangeKind);
  window.addEventListener(EVENT, h);
  return () => window.removeEventListener(EVENT, h);
}
