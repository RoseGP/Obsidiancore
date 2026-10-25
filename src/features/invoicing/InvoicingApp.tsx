/**
 * Invoicing module entry point. Mount anywhere; it is self-contained and
 * scoped (`.inv`) so it does not inherit or leak the host app's styles.
 */
import React, { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import './invoicing.css';
import { BillingProvider, useBilling } from './state/BillingStore';
import { NavigationProvider, QuickActionsContext, useNav, type Route } from './state/navigation';
import type { BillingRepository } from './services/repository';
import { AppShell } from './layout/AppShell';
import { ClientDialog } from './components/ClientDialog';
import { PaymentDialog } from './components/PaymentDialog';
import { DashboardPage } from './pages/DashboardPage';
import { InvoicesPage } from './pages/InvoicesPage';
import { InvoiceEditorPage } from './pages/InvoiceEditorPage';
import { InvoiceViewPage } from './pages/InvoiceViewPage';
import { ClientsPage } from './pages/ClientsPage';
import { BudgetingPage, ReportsPage, TransactionsPage, WalletPage } from './pages/FinancePages';
import { SettingsPage } from './pages/SettingsPage';
import { ConfirmDialog, ToastProvider } from './ui/overlays';
import { Button, EmptyState, Skeleton, ThemeContext } from './ui/primitives';
import type { Client } from './domain/types';
import { useTheme } from '../../context/ThemeContext';

export interface InvoicingAppProps {
  /** Opens the host app's payment provider settings (Stripe/Square). */
  onOpenPaymentProviders?: () => void;
  initialRoute?: Route;
  /** Inject a repository (tests/storybook); defaults to backend-or-prototype. */
  repository?: BillingRepository;
  className?: string;
  style?: React.CSSProperties;
}

function LoadingShell() {
  return (
    <div className="flex h-full min-h-[640px] w-full overflow-hidden rounded-2xl" style={{ border: '1px solid var(--inv-border)' }} aria-busy="true" aria-label="Loading billing">
      <div className="hidden w-[248px] flex-none space-y-3 p-5 sm:block" style={{ background: 'var(--inv-surface)', borderRight: '1px solid var(--inv-border)' }}>
        {Array.from({ length: 9 }).map((_, i) => <Skeleton key={i} style={{ height: 30 }} />)}
      </div>
      <div className="flex-1 space-y-4 p-6">
        <Skeleton style={{ height: 40, width: 260 }} />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} style={{ height: 112 }} />)}</div>
        <Skeleton style={{ height: 300 }} />
      </div>
    </div>
  );
}

function Routes({ onOpenPaymentProviders }: { onOpenPaymentProviders?: () => void }) {
  const { route } = useNav();
  switch (route.name) {
    case 'dashboard': return <DashboardPage />;
    case 'invoices': return <InvoicesPage initialStatus={route.status} />;
    case 'invoice-new':
    case 'invoice-edit': return <InvoiceEditorPage route={route} />;
    case 'invoice-view': return <InvoiceViewPage key={route.id} id={route.id} />;
    case 'clients': return <ClientsPage focusClientId={route.clientId} />;
    case 'transactions': return <TransactionsPage />;
    case 'wallet': return <WalletPage onOpenPaymentProviders={onOpenPaymentProviders} />;
    case 'budgeting': return <BudgetingPage />;
    case 'reports': return <ReportsPage />;
    case 'settings': return <SettingsPage />;
    default: return null;
  }
}

function Ready({ theme, toggleTheme, onOpenPaymentProviders }: { theme: 'light' | 'dark'; toggleTheme: () => void; onOpenPaymentProviders?: () => void }) {
  const nav = useNav();
  const [clientDlg, setClientDlg] = useState<{ open: boolean; clientId?: string; onCreated?: (c: Client) => void }>({ open: false });
  const [payDlg, setPayDlg] = useState<{ open: boolean; invoiceId?: string }>({ open: false });

  return (
    <QuickActionsContext.Provider value={{
      openClientDialog: (o) => setClientDlg({ open: true, clientId: o?.clientId, onCreated: o?.onCreated }),
      openPaymentDialog: (o) => setPayDlg({ open: true, invoiceId: o?.invoiceId }),
    }}>
      <AppShell theme={theme} onToggleTheme={toggleTheme}>
        <Routes onOpenPaymentProviders={onOpenPaymentProviders} />
      </AppShell>
      <ClientDialog open={clientDlg.open} clientId={clientDlg.clientId} onClose={() => setClientDlg({ open: false })}
        onSaved={(c) => { if (!clientDlg.clientId) clientDlg.onCreated?.(c); }} />
      <PaymentDialog open={payDlg.open} invoiceId={payDlg.invoiceId} onClose={() => setPayDlg({ open: false })} />
      <ConfirmDialog open={!!nav.pendingLeave} onClose={nav.cancelLeave} onConfirm={nav.confirmLeave} tone="danger"
        title="Leave without saving?" confirmLabel="Discard changes"
        body="You have unsaved changes on this page. They’ll be lost if you leave now." />
    </QuickActionsContext.Provider>
  );
}

function Gate(props: { theme: 'light' | 'dark'; toggleTheme: () => void; onOpenPaymentProviders?: () => void }) {
  const { status, error, reload } = useBilling();
  if (status === 'loading') return <LoadingShell />;
  if (status === 'error') {
    return (
      <div className="flex min-h-[480px] items-center justify-center rounded-2xl" style={{ border: '1px solid var(--inv-border)', background: 'var(--inv-surface)' }}>
        <EmptyState title="Billing couldn’t be loaded" body={error ?? 'Check your connection and try again.'}
          action={<Button variant="primary" icon={<RefreshCw size={15} />} onClick={reload}>Try again</Button>} />
      </div>
    );
  }
  return <Ready {...props} />;
}

export default function InvoicingApp({ onOpenPaymentProviders, initialRoute, repository, className, style }: InvoicingAppProps) {
  // Follows the app-wide theme (System / Light / Dark in the top bar); the module's toggle changes it too.
  const appTheme = useTheme();
  const theme = appTheme.resolved;
  const toggleTheme = appTheme.toggle;

  return (
    <ThemeContext.Provider value={theme}>
      <div className={`inv @container/app ${className ?? ''}`} data-theme={theme} style={{ height: 'calc(100vh - 140px)', minHeight: 640, borderRadius: 16, ...style }}>
        <ToastProvider>
          <BillingProvider repository={repository}>
            <NavigationProvider initial={initialRoute}>
              <Gate theme={theme} toggleTheme={toggleTheme} onOpenPaymentProviders={onOpenPaymentProviders} />
            </NavigationProvider>
          </BillingProvider>
        </ToastProvider>
      </div>
    </ThemeContext.Provider>
  );
}
