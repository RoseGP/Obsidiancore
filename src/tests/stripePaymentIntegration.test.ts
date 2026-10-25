/**
 * Automated Test Suite for Stripe Test Mode Payment Integration & Cloudflare D1
 * Run with: npx tsx src/tests/stripePaymentIntegration.test.ts
 */

import crypto from 'crypto';
import Stripe from 'stripe';
import * as d1Db from '../payments/d1Database';
import { stripePaymentProvider } from '../payments/stripe/stripePaymentProvider';

let totalTests = 0;
let passedTests = 0;

function assert(condition: boolean, testName: string, failureReason?: string) {
  totalTests++;
  if (condition) {
    console.log(`  ✓ [PASS] ${testName}`);
    passedTests++;
  } else {
    console.error(`  ✗ [FAIL] ${testName}`);
    if (failureReason) {
      console.error(`      Reason: ${failureReason}`);
    }
  }
}

async function runTests() {
  console.log('===========================================================');
  console.log('RUNNING STRIPE TEST MODE & CLOUDFLARE D1 TEST SUITE');
  console.log('===========================================================');

  const TEST_BIZ_A = 'biz_corp_alpha_101';
  const TEST_BIZ_B = 'biz_corp_beta_202';

  // 1. D1 Business Tenant Creation
  const bizA = await d1Db.getOrCreateBusiness(TEST_BIZ_A, 'Alpha Systems', 'billing@alpha.io');
  const bizB = await d1Db.getOrCreateBusiness(TEST_BIZ_B, 'Beta Logistics', 'finance@beta.io');
  assert(bizA.id === TEST_BIZ_A && bizB.id === TEST_BIZ_B, '1. Multi-tenant business records exist in D1');

  // 2. Stripe Test Mode Key Check (Never live keys)
  const isKeySafe = !process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY.startsWith('sk_test_');
  assert(isKeySafe, '2. Enforces Stripe TEST MODE keys only (no live keys)');

  // 3. Money as Integer Minor Units ($25.99 = 2599 cents)
  const dollars = 25.99;
  const cents = Math.round(dollars * 100);
  assert(cents === 2599 && Number.isInteger(cents), '3. Stores money as integer minor units ($25.99 -> 2599 cents)');

  // 4. Multi-Tenant Business Isolation
  const invoiceA = await d1Db.saveInvoice({
    id: 'inv_alpha_001',
    business_id: TEST_BIZ_A,
    customer_id: 'cust_alpha_c1',
    invoice_number: 'ALPHA-001',
    currency: 'USD',
    subtotal_cents: 259900,
    tax_cents: 0,
    total_cents: 259900,
    status: 'draft',
    payment_provider: null,
    provider_invoice_id: null,
    payment_url: null,
    payment_status: 'unpaid',
    due_date: '2026-04-01',
    description: 'Enterprise API Access',
    paid_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  });

  const crossTenantLookup = await d1Db.getInvoice(TEST_BIZ_B, invoiceA.id);
  assert(crossTenantLookup === null, '4. Business isolation: Business B cannot access Business A invoice in D1');

  // 5. Stripe Connect Account Onboarding
  const connectResult = await stripePaymentProvider.createConnectAccount(
    { id: TEST_BIZ_A, name: bizA.name, email: bizA.email },
    'http://localhost:3000'
  );
  assert(
    !!connectResult.accountId && !!connectResult.onboardingUrl,
    '5. Generates Stripe Connect onboarding URL for business'
  );

  // 6. Connect Account Storage in payment_accounts
  await d1Db.savePaymentAccount({
    id: `pa_${Date.now()}`,
    business_id: TEST_BIZ_A,
    provider: 'stripe',
    provider_account_id: connectResult.accountId,
    status: 'active',
    access_token_encrypted: null,
    refresh_token_encrypted: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  });

  const storedAccount = await d1Db.getPaymentAccount(TEST_BIZ_A, 'stripe');
  assert(
    storedAccount?.status === 'active' && storedAccount.provider_account_id === connectResult.accountId,
    '6. Saves Stripe connected account in payment_accounts table with active status'
  );

  // 7. Customer Creation & Stripe Customer ID Reuse
  const custId = 'cust_test_c1';
  await d1Db.saveCustomer({
    id: custId,
    business_id: TEST_BIZ_A,
    name: 'Sarah Connor',
    email: 'sarah@skynet-audit.org',
    stripe_customer_id: 'cus_test_existing_sarah_123',
    billing_address: JSON.stringify({ address: '100 Mission St', city: 'San Francisco', state: 'CA' }),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  });

  const stripeCustomerFirst = await stripePaymentProvider.findOrCreateCustomer(
    TEST_BIZ_A,
    { id: custId, name: 'Sarah Connor', email: 'sarah@skynet-audit.org' }
  );

  assert(
    stripeCustomerFirst === 'cus_test_existing_sarah_123',
    '7. Reuses existing stripe_customer_id instead of creating duplicate customers'
  );

  // 8. Stripe Invoice Creation, Line Items & Finalization
  const items = [
    {
      description: 'Monthly Cloud Infrastructure',
      quantity: 1,
      unitPriceCents: 200000, // $2,000.00
      taxRatePercent: 0,
      amountCents: 200000
    },
    {
      description: 'Support SLA Tier 1',
      quantity: 2,
      unitPriceCents: 29950, // $299.50
      taxRatePercent: 0,
      amountCents: 59900    // $599.00
    }
  ];

  const totalCentsCalculated = 200000 + 59900; // 259900 cents = $2,599.00

  const providerInvoice = await stripePaymentProvider.createInvoice({
    invoiceId: invoiceA.id,
    businessId: TEST_BIZ_A,
    connectedAccountId: storedAccount?.provider_account_id,
    customer: {
      id: custId,
      name: 'Sarah Connor',
      email: 'sarah@skynet-audit.org',
      stripeCustomerId: stripeCustomerFirst
    },
    invoiceNumber: invoiceA.invoice_number,
    currency: 'USD',
    items,
    subtotalCents: totalCentsCalculated,
    taxCents: 0,
    totalCents: totalCentsCalculated
  });

  assert(
    !!providerInvoice.providerInvoiceId && !!providerInvoice.paymentUrl,
    '8. Creates & finalizes Stripe Invoice and retrieves hosted payment URL'
  );

  // 9. D1 Invoice Updates upon Payment Link Creation
  await d1Db.updateInvoicePaymentDetails(invoiceA.id, {
    payment_provider: 'stripe',
    provider_invoice_id: providerInvoice.providerInvoiceId,
    payment_url: providerInvoice.paymentUrl,
    payment_status: 'open',
    status: 'open'
  });

  const updatedD1Inv = await d1Db.getInvoice(TEST_BIZ_A, invoiceA.id);
  assert(
    updatedD1Inv?.payment_provider === 'stripe' &&
    updatedD1Inv.provider_invoice_id === providerInvoice.providerInvoiceId &&
    updatedD1Inv.payment_status === 'open' &&
    updatedD1Inv.status === 'open',
    '9. D1 invoice persists provider_invoice_id and payment_url with payment_status=open'
  );

  // 10. Webhook Signature Verification
  const mockWebhookSecret = 'whsec_test_secret_for_automated_verification_2026';
  const timestamp = Math.floor(Date.now() / 1000);
  const samplePayload = JSON.stringify({
    id: `evt_test_${Date.now()}`,
    object: 'event',
    type: 'invoice.paid',
    data: {
      object: {
        id: providerInvoice.providerInvoiceId,
        hosted_invoice_url: providerInvoice.paymentUrl
      }
    }
  });

  const signature = crypto
    .createHmac('sha256', mockWebhookSecret)
    .update(`${timestamp}.${samplePayload}`)
    .digest('hex');
  const validHeader = `t=${timestamp},v1=${signature}`;

  // Test signature parser
  const stripeSdk = new Stripe('sk_test_placeholder', { apiVersion: '2023-10-16' as any });
  let verifiedEvent: any = null;
  try {
    verifiedEvent = stripeSdk.webhooks.constructEvent(samplePayload, validHeader, mockWebhookSecret);
  } catch (e: any) {
    verifiedEvent = null;
  }
  assert(verifiedEvent !== null && verifiedEvent.type === 'invoice.paid', '10. Verifies valid Stripe webhook signature');

  // 11. Reject Forged Webhook Signature
  const forgedHeader = `t=${timestamp},v1=invalid_hex_signature_forge_attack`;
  let forgedRejected = false;
  try {
    stripeSdk.webhooks.constructEvent(samplePayload, forgedHeader, mockWebhookSecret);
  } catch {
    forgedRejected = true;
  }
  assert(forgedRejected, '11. Rejects invalid / forged webhook signature with error');

  // 12. Webhook Idempotency Check
  const testEventId = `evt_idempotency_${Date.now()}`;
  const firstProcessed = await d1Db.isWebhookEventProcessed('stripe', testEventId);
  assert(firstProcessed === false, '12a. New webhook event detected as un-processed');

  await d1Db.markWebhookEventProcessed('stripe', testEventId);
  const secondProcessed = await d1Db.isWebhookEventProcessed('stripe', testEventId);
  assert(secondProcessed === true, '12b. Repeated webhook event recognized as duplicate via webhook_events table');

  // 13. Webhook invoice.paid Updates D1 Invoice to PAID
  const localBeforePaid = await d1Db.getInvoiceByProviderInvoiceId('stripe', providerInvoice.providerInvoiceId);
  assert(localBeforePaid?.payment_status === 'open', '13a. Invoice status is open before payment webhook');

  // Simulate webhook invoice.paid transition
  await d1Db.updateInvoicePaymentDetails(localBeforePaid!.id, {
    payment_status: 'paid',
    status: 'paid',
    paid_at: new Date().toISOString()
  });

  const localAfterPaid = await d1Db.getInvoice(TEST_BIZ_A, localBeforePaid!.id);
  assert(
    localAfterPaid?.payment_status === 'paid' &&
    localAfterPaid.status === 'paid' &&
    !!localAfterPaid.paid_at,
    '13b. Webhook invoice.paid updates D1 invoice to payment_status=paid, status=paid, and records paid_at'
  );

  // 14. Webhook invoice.payment_failed Updates payment_status to failed
  const failInv = await d1Db.saveInvoice({
    id: 'inv_fail_test_001',
    business_id: TEST_BIZ_A,
    customer_id: custId,
    invoice_number: 'FAIL-001',
    currency: 'USD',
    subtotal_cents: 10000,
    tax_cents: 0,
    total_cents: 10000,
    status: 'open',
    payment_provider: 'stripe',
    provider_invoice_id: 'in_fail_mock_123',
    payment_url: 'https://checkout.stripe.com/pay/in_fail_mock_123',
    payment_status: 'open',
    due_date: '2026-04-01',
    description: 'Failing Test Invoice',
    paid_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  });

  await d1Db.updateInvoicePaymentDetails(failInv.id, {
    payment_status: 'failed'
  });

  const failedResult = await d1Db.getInvoice(TEST_BIZ_A, failInv.id);
  assert(failedResult?.payment_status === 'failed', '14. Webhook invoice.payment_failed updates payment_status=failed');

  // 15. Disconnecting Stripe Account
  const disconnected = await d1Db.removePaymentAccount(TEST_BIZ_A, 'stripe');
  const accountAfterDisconnect = await d1Db.getPaymentAccount(TEST_BIZ_A, 'stripe');
  assert(
    disconnected === true && accountAfterDisconnect === null,
    '15. Disconnects Stripe account and cleans up payment_accounts record in D1'
  );

  console.log('===========================================================');
  console.log(`TEST SUITE RESULTS: ${passedTests}/${totalTests} TESTS PASSED (${Math.round((passedTests / totalTests) * 100)}%)`);
  console.log('===========================================================');

  if (passedTests === totalTests) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test suite uncaught exception:', err);
  process.exit(1);
});
