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

export interface SendRequest {
  to: string;
  cc: string;
  subject: string;
  message: string;
  /** Base64 PDF generated from the same renderer as the preview. */
  pdfBase64: string;
  pdfFilename: string;
}

export interface SendResult {
  invoice: Invoice;
  delivery: DeliveryAttempt;
}

/**
 * Persistence boundary. The UI only talks to this interface; swapping the
 * prototype store for the real backend needs no UI changes.
 */
export interface BillingRepository {
  readonly mode: 'remote' | 'local';
  /** Human-readable reason when in local mode. */
  readonly modeReason: string;
  /** Whether outbound email is configured on the server. */
  readonly emailConfigured: boolean;
  readonly user: CurrentUser;

  load(): Promise<BillingSnapshot>;
  saveInvoice(invoice: Invoice, opts: { idempotencyKey: string }): Promise<Invoice>;
  voidInvoice(id: string): Promise<Invoice>;
  markInvoiceSent(id: string): Promise<Invoice>;
  sendInvoice(id: string, req: SendRequest, opts: { idempotencyKey: string }): Promise<SendResult>;
  recordPayment(payment: Omit<Payment, 'id' | 'receiptNumber' | 'createdAt' | 'recordedBy' | 'source'>, opts: { idempotencyKey: string }): Promise<{ payment: Payment; invoice: Invoice }>;
  saveClient(client: Client): Promise<Client>;
  setClientArchived(id: string, archived: boolean): Promise<Client>;
  saveSettings(settings: BusinessSettings): Promise<BusinessSettings>;
  resetPrototypeData?(): Promise<BillingSnapshot>;
}
