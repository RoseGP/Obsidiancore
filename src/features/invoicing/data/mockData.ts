/**
 * Prototype-only mock data. Generated relative to today so that statuses
 * (overdue, partially paid…) stay meaningful whenever the prototype runs.
 * Never used when the billing backend is connected.
 */
import { addDays, todayISO } from '../domain/status';
import type {
  BillingSnapshot, BusinessSettings, Client, Invoice, LineItem, Payment, PaymentMethod,
} from '../domain/types';
import { billToFromClient } from '../domain/factories';
import { calculateInvoice } from '../domain/calc';
import { minorToDecimalString } from '../domain/money';

// Deterministic pseudo-random so the demo looks the same on every load.
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

export const MOCK_SETTINGS: BusinessSettings = {
  issuer: {
    name: 'Obsidian Digital Ltd',
    email: 'billing@obsidian.studio',
    phone: '+1 (415) 555-0142',
    website: 'obsidian.studio',
    address: {
      line1: '548 Market Street', line2: 'Suite 2100', city: 'San Francisco', state: 'CA',
      postalCode: '94104', country: 'United States',
    },
    taxIdLabel: 'EIN',
    taxId: '84-2917365',
    logoDataUrl: '',
  },
  invoicePrefix: 'INV-',
  defaultCurrency: 'USD',
  defaultTermsDays: 30,
  defaultTaxRate: '8.625',
  paymentInstructions:
    'Bank transfer to Obsidian Digital Ltd\nFirst Republic Bank · Account 4402 1193 07 · Routing 321081669\nPlease include the invoice number as the payment reference.',
  defaultNotes: 'Thank you for your business. Questions about this invoice? Reply to this email or call us.',
  signature: { enabled: false, name: 'Kamisato Aya', title: 'Finance Manager', imageDataUrl: '' },
};

const C = (
  id: string, name: string, company: string, email: string, phone: string,
  line1: string, city: string, state: string, postalCode: string, country: string,
  taxIdLabel: string, taxId: string, archived = false,
): Client => ({
  id, name, company, email, phone,
  address: { line1, line2: '', city, state, postalCode, country },
  taxIdLabel, taxId, notes: '', archived,
  createdAt: '2025-06-02T09:00:00.000Z', updatedAt: '2025-06-02T09:00:00.000Z',
});

export const MOCK_CLIENTS: Client[] = [
  C('cl_alpha', 'Sarah Jenkins', 'Alpha Tech Cloud Inc.', 'sarah.j@alpha-tech.cloud', '+1 (555) 234-5678', '200 Congress Ave', 'Austin', 'TX', '78701', 'United States', 'EIN', '47-1938204'),
  C('cl_vortex', 'Marcus Chen', 'Vortex Engineering', 'm.chen@vortex-io.co', '+1 (555) 876-5432', '1 Kendall Sq, Bldg 300', 'Cambridge', 'MA', '02139', 'United States', 'EIN', '82-5531907'),
  C('cl_quantum', 'Elena Rostova', 'Quantum Finance Group', 'elena.rostova@quantum-fin.eu', '+31 20 890 1234', 'Herengracht 450', 'Amsterdam', '', '1017 CA', 'Netherlands', 'VAT', 'NL859301245B01'),
  C('cl_harbor', 'Daniel Okafor', 'Harbor & Pine Architects', 'dokafor@harborpine.com', '+1 (206) 555-0187', '1201 Western Ave', 'Seattle', 'WA', '98101', 'United States', 'EIN', '91-2044718'),
  C('cl_meridian', 'Priya Raman', 'Meridian Health Partners', 'p.raman@meridianhp.org', '+1 (312) 555-0123', '330 N Wabash Ave', 'Chicago', 'IL', '60611', 'United States', 'EIN', '36-4471290'),
  C('cl_lumen', 'Tomás Herrera', 'Lumen Retail Co.', 'tomas@lumenretail.com', '+1 (305) 555-0199', '801 Brickell Ave', 'Miami', 'FL', '33131', 'United States', 'EIN', '65-1188420'),
  C('cl_kestrel', 'Hannah Becker', 'Kestrel Logistics GmbH', 'h.becker@kestrel-log.de', '+49 30 5557 3321', 'Friedrichstraße 68', 'Berlin', '', '10117', 'Germany', 'VAT', 'DE318845902'),
  C('cl_bright', 'Grace Mensah', 'Bright Path Learning', 'grace@brightpath.edu', '+1 (617) 555-0164', '75 Arlington St', 'Boston', 'MA', '02116', 'United States', 'EIN', '04-3399128', true),
];

const SERVICES: { name: string; description: string; price: string; unit: string[] }[] = [
  { name: 'Product design sprint', description: 'Discovery workshops, user flows and high-fidelity prototypes', price: '4800.00', unit: ['1'] },
  { name: 'Frontend engineering', description: 'React component development, billed hourly', price: '145.00', unit: ['24', '32', '40', '18.5'] },
  { name: 'Backend API development', description: 'Node.js services, integrations and test coverage', price: '160.00', unit: ['20', '36', '12'] },
  { name: 'Cloud hosting & monitoring', description: 'Managed infrastructure, uptime monitoring, monthly', price: '850.00', unit: ['1'] },
  { name: 'UX research interviews', description: 'Recruiting, moderation and synthesis report', price: '375.00', unit: ['6', '8'] },
  { name: 'Brand identity refresh', description: 'Logo system, color palette and typography guidelines', price: '6200.00', unit: ['1'] },
  { name: 'Support retainer', description: 'Priority support with 4-hour response SLA', price: '1200.00', unit: ['1'] },
  { name: 'Data migration', description: 'Schema mapping and verified record transfer', price: '2650.00', unit: ['1'] },
];

function buildItems(rand: () => number, taxRate: string): LineItem[] {
  const count = 1 + Math.floor(rand() * 3);
  const picks = new Set<number>();
  while (picks.size < count) picks.add(Math.floor(rand() * SERVICES.length));
  return [...picks].map((idx, i) => {
    const s = SERVICES[idx];
    return {
      id: `li_seed_${idx}_${i}_${Math.floor(rand() * 1e6)}`,
      name: s.name,
      description: s.description,
      quantity: s.unit[Math.floor(rand() * s.unit.length)],
      unitPrice: s.price,
      taxRate: idx === 3 || idx === 6 ? '0' : taxRate,
    };
  });
}

export function generateMockSnapshot(): BillingSnapshot {
  const rand = rng(20260415);
  const today = todayISO();
  const activeClients = MOCK_CLIENTS.filter((c) => !c.archived);
  const invoices: Invoice[] = [];
  const payments: Payment[] = [];
  const methods: PaymentMethod[] = ['bank_transfer', 'bank_transfer', 'card', 'check', 'bank_transfer'];

  const TOTAL = 38;
  for (let k = 0; k < TOTAL; k++) {
    // Spread issue dates over ~13 months, newest last.
    const daysAgo = Math.round((TOTAL - 1 - k) * 7 + rand() * 3);
    const issueDate = addDays(today, -daysAgo);
    const terms = [15, 30, 30, 45][Math.floor(rand() * 4)];
    const dueDate = addDays(issueDate, terms);
    const client = k < 3 ? MOCK_CLIENTS[7] : activeClients[Math.floor(rand() * activeClients.length)];
    const intl = client.address.country !== 'United States';
    const currency = 'USD';
    const taxRate = intl ? '0' : MOCK_SETTINGS.defaultTaxRate;
    const number = `INV-${String(1001 + k).padStart(4, '0')}`;
    const id = `inv_seed_${k}`;
    const created = `${issueDate}T15:20:00.000Z`;

    // Lifecycle mix: the newest few are drafts, a couple void.
    let lifecycle: Invoice['lifecycle'] = 'sent';
    if (k === TOTAL - 1 || k === TOTAL - 3) lifecycle = 'draft';
    else if (k === 9 || k === 22) lifecycle = 'void';
    else if (rand() > 0.55) lifecycle = 'viewed';

    const inv: Invoice = {
      id, number, kind: k % 11 === 4 ? 'split' : 'standard', lifecycle,
      clientId: client.id,
      billTo: billToFromClient(client),
      issuer: MOCK_SETTINGS.issuer,
      issueDate, dueDate, currency,
      items: buildItems(rand, taxRate),
      discount: rand() > 0.8 ? { type: 'percent', value: '10' } : { type: 'percent', value: '' },
      fees: [],
      installments: [],
      recurring: null,
      paymentInstructions: MOCK_SETTINGS.paymentInstructions,
      notes: MOCK_SETTINGS.defaultNotes,
      signature: { ...MOCK_SETTINGS.signature, enabled: false },
      deliveries: [],
      activity: [{ id: `act_seed_${k}`, at: created, type: 'created', message: 'Invoice created' }],
      createdAt: created, updatedAt: created,
      sentAt: lifecycle === 'draft' ? null : created,
      viewedAt: lifecycle === 'viewed' ? `${addDays(issueDate, 1)}T10:05:00.000Z` : null,
      voidedAt: lifecycle === 'void' ? `${addDays(issueDate, 3)}T10:00:00.000Z` : null,
      version: 1,
    };
    if (inv.kind === 'split') {
      inv.installments = [
        { id: `ins_${k}_a`, label: 'Deposit', percent: '40', dueDate: issueDate },
        { id: `ins_${k}_b`, label: 'Balance on delivery', percent: '60', dueDate },
      ];
    }
    invoices.push(inv);

    // Payments: older invoices mostly paid; recent ones open; some partial.
    if (lifecycle === 'sent' || lifecycle === 'viewed') {
      const age = daysAgo;
      const roll = rand();
      const totals = calculateInvoice(inv);
      const totalStr = totals.total;
      let fraction = 0;
      if (age > 130) fraction = roll > 0.08 ? 1 : 0.5;
      else if (age > 45) fraction = roll > 0.35 ? 1 : roll > 0.18 ? 0.4 : 0;
      else fraction = roll > 0.7 ? 1 : roll > 0.45 ? 0.3 : 0;
      if (fraction > 0) {
        const paidMinor = fraction === 1 ? totalStr : (totalStr * BigInt(Math.round(fraction * 100))) / 100n;
        const payDate = addDays(issueDate, Math.min(age, Math.round(terms * (0.4 + rand() * 0.9))));
        payments.push({
          id: `pay_seed_${k}`,
          receiptNumber: `RCT-${String(5001 + payments.length)}`,
          invoiceId: id,
          amount: minorStr(paidMinor),
          currency,
          date: payDate > today ? today : payDate,
          method: methods[Math.floor(rand() * methods.length)],
          reference: `REF${Math.floor(100000 + rand() * 899999)}`,
          note: '',
          status: 'confirmed',
          source: 'manual',
          recordedBy: 'Kamisato Aya',
          createdAt: `${payDate}T17:00:00.000Z`,
        });
      }
    }
  }

  // Guarantee every status appears in the demo: one partial payment on a
  // not-yet-due invoice, and a viewed one.
  const notDue = invoices.filter((i) => (i.lifecycle === 'sent' || i.lifecycle === 'viewed') && i.dueDate >= today && !payments.some((p) => p.invoiceId === i.id));
  if (notDue[0]) {
    const t = calculateInvoice(notDue[0]).total;
    payments.push({
      id: 'pay_seed_partial', receiptNumber: `RCT-${String(5001 + payments.length)}`, invoiceId: notDue[0].id,
      amount: minorStr((t * 40n) / 100n), currency: 'USD', date: addDays(notDue[0].issueDate, 2) > today ? today : addDays(notDue[0].issueDate, 2),
      method: 'bank_transfer', reference: 'DEP-40PCT', note: 'Deposit', status: 'confirmed', source: 'manual',
      recordedBy: 'Kamisato Aya', createdAt: new Date().toISOString(),
    });
  }
  if (notDue[1]) { notDue[1].lifecycle = 'viewed'; notDue[1].viewedAt = `${notDue[1].issueDate}T16:40:00.000Z`; }

  // One pending check that has not cleared yet.
  const open = invoices.find((i, idx) => idx > 28 && i.lifecycle !== 'draft' && i.lifecycle !== 'void' && !payments.some((p) => p.invoiceId === i.id));
  if (open) {
    payments.push({
      id: 'pay_seed_pending', receiptNumber: `RCT-${String(5001 + payments.length)}`, invoiceId: open.id,
      amount: '500.00', currency: 'USD', date: addDays(today, -1), method: 'check', reference: 'CHK 10482',
      note: 'Check received, awaiting bank clearance', status: 'pending', source: 'manual',
      recordedBy: 'Kamisato Aya', createdAt: new Date().toISOString(),
    });
  }

  return { clients: MOCK_CLIENTS, invoices, payments, settings: MOCK_SETTINGS };
}

const minorStr = (m: bigint) => minorToDecimalString(m, 'USD');
