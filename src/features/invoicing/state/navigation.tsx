import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import type { Client, InvoiceKind } from '../domain/types';

export type Route =
  | { name: 'dashboard' }
  | { name: 'transactions' }
  | { name: 'wallet' }
  | { name: 'invoices'; status?: string }
  | { name: 'invoice-new'; kind?: InvoiceKind; clientId?: string; duplicateOf?: string }
  | { name: 'invoice-edit'; id: string }
  | { name: 'invoice-view'; id: string }
  | { name: 'clients'; clientId?: string }
  | { name: 'budgeting' }
  | { name: 'reports' }
  | { name: 'settings' };

export type SectionName = 'dashboard' | 'transactions' | 'wallet' | 'invoices' | 'clients' | 'budgeting' | 'reports' | 'settings';

export function sectionOf(r: Route): SectionName {
  if (r.name.startsWith('invoice')) return 'invoices';
  return r.name as SectionName;
}

interface NavContextValue {
  route: Route;
  navigate: (to: Route) => void;
  /** Editors register a check; navigation asks for confirmation when it returns true. */
  setLeaveGuard: (guard: (() => boolean) | null) => void;
  pendingLeave: Route | null;
  confirmLeave: () => void;
  cancelLeave: () => void;
}

const NavContext = createContext<NavContextValue | null>(null);

export function NavigationProvider({ children, initial = { name: 'dashboard' } }: { children: React.ReactNode; initial?: Route }) {
  const [route, setRoute] = useState<Route>(initial);
  const [pendingLeave, setPendingLeave] = useState<Route | null>(null);
  const guard = useRef<(() => boolean) | null>(null);

  const go = useCallback((to: Route) => {
    setRoute(to);
    requestAnimationFrame(() => document.getElementById('inv-main')?.scrollTo({ top: 0 }));
  }, []);

  const navigate = useCallback((to: Route) => {
    if (guard.current?.()) { setPendingLeave(to); return; }
    go(to);
  }, [go]);

  const value: NavContextValue = {
    route,
    navigate,
    setLeaveGuard: (g) => { guard.current = g; },
    pendingLeave,
    confirmLeave: () => { const to = pendingLeave; guard.current = null; setPendingLeave(null); if (to) go(to); },
    cancelLeave: () => setPendingLeave(null),
  };
  return <NavContext.Provider value={value}>{children}</NavContext.Provider>;
}

export function useNav() {
  const ctx = useContext(NavContext);
  if (!ctx) throw new Error('useNav must be used inside <NavigationProvider>');
  return ctx;
}

// ---------- Global quick-action dialogs ----------

interface QuickActions {
  openClientDialog: (opts?: { clientId?: string; onCreated?: (client: Client) => void }) => void;
  openPaymentDialog: (opts?: { invoiceId?: string }) => void;
}

export const QuickActionsContext = createContext<QuickActions>({
  openClientDialog: () => {},
  openPaymentDialog: () => {},
});
export const useQuickActions = () => useContext(QuickActionsContext);
