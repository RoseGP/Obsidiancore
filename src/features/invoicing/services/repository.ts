import type {
  BillingSnapshot, BusinessSettings, Client, CurrentUser, DeliveryAttempt, Invoice, Payment,
} from '../domain/types';
import type { FieldErrors } from '../domain/validation';

export class BillingError extends Error {
  constructor(
    message: string,
    public code: 'validation' | 'conflict' | 'not_found' | 'unauthorized' | 'forbidden'
      | 'not_configured' | 'network' | 'server',
    public fieldErrors: FieldErrors = {},
  ) {
    super(message);
  }
}

/**
 * Persistence boundary. The UI only talks to this interface; swapping the
 * prototype store for the real backend needs no UI changes.
 */
export interface BillingRepository {
  readonly mode: 'remote' | 'local';
  /** Human-readable reason when in local mode. */
  readonly modeReason: string;
  readonly user: CurrentUser;

  load(): Promise<BillingSnapshot>;
  saveInvoice(invoice: Invoice, opts: { idempotencyKey: string }): Promise<Invoice>;
  voidInvoice(id: string): Promise<Invoice>;
  markInvoiceSent(id: string): Promise<Invoice>;
  recordPayment(payment: Omit<Payment, 'id' | 'receiptNumber' | 'createdAt' | 'recordedBy' | 'source'>, opts: { idempotencyKey: string }): Promise<{ payment: Payment; invoice: Invoice }>;
  saveClient(client: Client): Promise<Client>;
  setClientArchived(id: string, archived: boolean): Promise<Client>;
  saveSettings(settings: BusinessSettings): Promise<BusinessSettings>;
  resetPrototypeData?(): Promise<BillingSnapshot>;
}
