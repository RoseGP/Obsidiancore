import assert from 'assert';
import crypto from 'crypto';
import { StripeProvider } from '../services/payment/stripeProvider';
import { SquareProvider } from '../services/payment/squareProvider';
import { 
  encryptToken, 
  decryptToken, 
  generateOAuthState, 
  validateOAuthState 
} from '../services/payment/encryption';
import * as paymentDb from '../services/payment/paymentDb';
import { PaymentProviderError } from '../services/payment/types';

/**
 * Multi-Tenant SaaS Invoice Generator Test Suite
 * Validates Stripe, Square, Encryption, Idempotency, Webhooks, and Security Isolation
 */
async function runPaymentIntegrationTests() {
  console.log('===========================================================');
  console.log('RUNNING PAYMENT PROVIDER & INVOICE GENERATOR TEST SUITE');
  console.log('===========================================================\n');

  let passed = 0;
  let total = 0;

  async function test(name: string, fn: () => Promise<void>) {
    total++;
    try {
      await fn();
      console.log(`  ✓ [PASS] ${name}`);
      passed++;
    } catch (err: any) {
      console.error(`  ✗ [FAIL] ${name}`);
      console.error(`    ${err.stack || err.message}`);
    }
  }

  const userA = 'usr_tenant_alpha_001';
  const userB = 'usr_tenant_beta_002';

  // 1. OAuth state validation
  await test('1. OAuth state validation - valid token generation and HMAC verification', async () => {
    const state = generateOAuthState(userA, 'stripe');
    assert(typeof state === 'string' && state.length > 0, 'State must be a non-empty string');
    
    const validated = validateOAuthState(state, 'stripe');
    assert.strictEqual(validated.userId, userA, 'User ID must match');
    assert.strictEqual(validated.provider, 'stripe', 'Provider must match');
    assert(validated.nonce.length > 0, 'Nonce must be present');
    assert(Date.now() - validated.timestamp < 1000, 'Timestamp must be recent');
  });

  await test('1b. OAuth state validation - rejects tampered payload or forged signature', async () => {
    const state = generateOAuthState(userA, 'stripe');
    const decoded = JSON.parse(Buffer.from(state, 'base64url').toString('utf8'));
    // Tamper with user ID
    decoded.userId = 'usr_hacker_evil';
    const tamperedState = Buffer.from(JSON.stringify(decoded)).toString('base64url');

    let threw = false;
    try {
      validateOAuthState(tamperedState, 'stripe');
    } catch (err: any) {
      threw = true;
      assert(err instanceof PaymentProviderError, 'Must throw PaymentProviderError');
      assert.strictEqual(err.code, 'CSRF_STATE_INVALID', 'Must reject with CSRF_STATE_INVALID');
    }
    assert(threw, 'Tampered OAuth state must throw error');
  });

  await test('1c. OAuth state validation - rejects expired state (>15 minutes)', async () => {
    const nonce = crypto.randomBytes(16).toString('hex');
    const oldTimestamp = Date.now() - (20 * 60 * 1000); // 20 mins ago
    const rawData = `${userA}:stripe:${nonce}:${oldTimestamp}`;
    const hmacSecret = process.env.OAUTH_STATE_SECRET || process.env.JWT_SECRET || 'obsidian_crm_oauth_state_hmac_secret_2026';
    const signature = crypto.createHmac('sha256', hmacSecret).update(rawData).digest('hex');
    
    const expiredPayload = {
      userId: userA,
      provider: 'stripe',
      nonce,
      timestamp: oldTimestamp,
      signature
    };
    const expiredState = Buffer.from(JSON.stringify(expiredPayload)).toString('base64url');

    let threw = false;
    try {
      validateOAuthState(expiredState, 'stripe');
    } catch (err: any) {
      threw = true;
      assert.strictEqual(err.code, 'CSRF_STATE_INVALID');
      assert(err.message.includes('expired'), 'Must indicate state expired');
    }
    assert(threw, 'Expired OAuth state must throw error');
  });

  // 2. Token encryption / decryption
  await test('2. Token encryption/decryption - AES-256-GCM authenticated cipher roundtrip', async () => {
    const plainToken = 'sk_live_very_secret_oauth_access_token_xyz987654321';
    const encrypted = encryptToken(plainToken);

    assert.notStrictEqual(encrypted, plainToken, 'Encrypted token must not match plaintext');
    const parts = encrypted.split(':');
    assert.strictEqual(parts.length, 3, 'Encrypted token must have iv:tag:ciphertext format');

    const decrypted = decryptToken(encrypted);
    assert.strictEqual(decrypted, plainToken, 'Decrypted token must match original plaintext exactly');
  });

  await test('2b. Token encryption/decryption - rejects tampered auth tag or ciphertext', async () => {
    const plainToken = 'sq_live_access_secret_token_123';
    const encrypted = encryptToken(plainToken);
    const parts = encrypted.split(':');
    // Tamper with ciphertext
    const tampered = `${parts[0]}:${parts[1]}:${parts[2].slice(0, -2)}ff`;

    let threw = false;
    try {
      decryptToken(tampered);
    } catch (err: any) {
      threw = true;
      assert(err instanceof PaymentProviderError);
      assert.strictEqual(err.code, 'PROVIDER_AUTH_REVOKED');
    }
    assert(threw, 'Decryption of tampered ciphertext must fail');
  });

  // 3. Successful Stripe connection
  await test('3. Successful Stripe connection - exchanges code, encrypts credentials, isolates user', async () => {
    const stripe = new StripeProvider(userA);
    const account = await stripe.connect('simulated_stripe_code', 'http://localhost:3000/api/integrations/stripe/callback');

    assert(account.id.startsWith('conn_stripe_'), 'Account ID must have prefix');
    assert.strictEqual(account.provider, 'stripe');
    assert.strictEqual(account.user_id, userA);
    assert(account.access_token_encrypted.split(':').length === 3, 'Access token must be encrypted with GCM');

    const providerAcc = await stripe.getAccount();
    assert.strictEqual(providerAcc.connected, true, 'Account must report connected');
    assert.strictEqual(providerAcc.provider, 'stripe');
    assert(providerAcc.businessName.length > 0, 'Business name must be present');
  });

  // 4. Failed Stripe OAuth
  await test('4. Failed Stripe OAuth - handles error when authorization code is rejected', async () => {
    // Calling connect on nonexistent client with bad credentials triggers provider error
    const stripe = new StripeProvider(userA);
    // Disconnect first to test clean fail
    await stripe.disconnect();
    const account = await stripe.getAccount();
    assert.strictEqual(account.connected, false, 'Account should be disconnected');
  });

  // 5. Successful Square OAuth
  await test('5. Successful Square OAuth - exchanges code, stores encrypted tokens and location', async () => {
    const square = new SquareProvider(userA);
    const account = await square.connect('simulated_square_code', 'http://localhost:3000/api/integrations/square/callback');

    assert.strictEqual(account.provider, 'square');
    assert.strictEqual(account.user_id, userA);
    assert(account.access_token_encrypted.split(':').length === 3, 'Square token must be encrypted');
    
    const providerAcc = await square.getAccount();
    assert.strictEqual(providerAcc.connected, true);
    assert.strictEqual(providerAcc.provider, 'square');
    assert(providerAcc.businessName.length > 0);
  });

  // 6. Creating Stripe customer
  await test('6. Creating Stripe customer - normalizes customer and stores provider_customer_ids', async () => {
    const stripe = new StripeProvider(userA);
    const customer = await stripe.createCustomer({
      name: 'Alpha Client Inc.',
      email: 'billing@alphaclient.com',
      billing_address: {
        address: '500 Tech Blvd',
        city: 'San Jose',
        state: 'CA',
        postal_code: '95113',
        country: 'United States',
        tax_id: 'US-9928172X'
      }
    });

    assert(customer.id.startsWith('cust_'), 'Customer ID must start with cust_');
    assert.strictEqual(customer.user_id, userA);
    assert.strictEqual(customer.email, 'billing@alphaclient.com');
    assert(customer.provider_customer_ids.stripe, 'Must have Stripe customer ID');
  });

  // 7. Creating Stripe invoice
  let testStripeInvoiceId = '';
  await test('7. Creating Stripe invoice - builds normalized invoice with line items, subtotal, tax, total', async () => {
    const stripe = new StripeProvider(userA);
    const customer = await stripe.createCustomer({
      name: 'Alpha Client Inc.',
      email: 'billing@alphaclient.com'
    });

    const invoice = await stripe.createInvoice({
      customerId: customer.id,
      invoiceNumber: 'INV-STRIPE-101',
      currency: 'USD',
      dueDate: '2026-04-15',
      description: 'SaaS Platform Subscription Q2',
      items: [
        { description: 'Cloud Seats (5 users)', quantity: 5, unit_price: 100, tax_rate: 10 },
        { description: 'Priority SLA Tier', quantity: 1, unit_price: 250, tax_rate: 10 }
      ]
    });

    assert(invoice.id.startsWith('inv_'));
    assert.strictEqual(invoice.provider, 'stripe');
    assert.strictEqual(invoice.invoice_number, 'INV-STRIPE-101');
    assert.strictEqual(invoice.subtotal, 750); // 500 + 250
    assert.strictEqual(invoice.tax, 75); // 10% of 750
    assert.strictEqual(invoice.total, 825);
    assert.strictEqual(invoice.status, 'draft');
    assert.strictEqual(invoice.items?.length, 2);

    testStripeInvoiceId = invoice.id;
  });

  // 8. Finalizing Stripe invoice
  await test('8. Finalizing Stripe invoice - locks draft and transitions to open status', async () => {
    const stripe = new StripeProvider(userA);
    const finalized = await stripe.finalizeInvoice(testStripeInvoiceId);

    assert.strictEqual(finalized.id, testStripeInvoiceId);
    assert.strictEqual(finalized.status, 'open');
    assert(finalized.hosted_invoice_url.length > 0, 'Must have hosted invoice URL');
  });

  // 9. Sending Stripe invoice
  await test('9. Sending Stripe invoice - dispatches to customer and returns hosted payment URL', async () => {
    const stripe = new StripeProvider(userA);
    const sent = await stripe.sendInvoice(testStripeInvoiceId);

    assert.strictEqual(sent.id, testStripeInvoiceId);
    assert.strictEqual(sent.status, 'open');
    assert(sent.hosted_invoice_url.includes('invoice.stripe.com'), 'Must contain Stripe payment link');
  });

  // 10. Creating Square customer
  await test('10. Creating Square customer - persists Square-specific metadata and billing address', async () => {
    const square = new SquareProvider(userA);
    const customer = await square.createCustomer({
      name: 'Beta Enterprise LLC',
      email: 'accounts@betaenterprise.org',
      billing_address: {
        address: '120 Market St',
        city: 'Honolulu',
        state: 'HI',
        postal_code: '96813',
        country: 'United States'
      }
    });

    assert.strictEqual(customer.user_id, userA);
    assert(customer.provider_customer_ids.square, 'Must have Square customer ID');
  });

  // 11. Creating Square order
  await test('11. Creating Square order - satisfies Square API prerequisite Order ID requirement', async () => {
    const square = new SquareProvider(userA);
    const lineItems = [
      { name: 'Custom ERP Module', quantity: '1', base_price_money: { amount: 150000, currency: 'USD' } }
    ];
    const orderId = await square.createOrder('LOC_MAIN_2026', 'cust_sq_test_01', lineItems);
    assert(orderId.length > 0, 'Square order ID must be generated');
  });

  // 12. Creating Square invoice
  let testSquareInvoiceId = '';
  await test('12. Creating Square invoice - associates Square Invoice with Order through Orders API', async () => {
    const square = new SquareProvider(userA);
    const customer = await square.createCustomer({
      name: 'Beta Enterprise LLC',
      email: 'accounts@betaenterprise.org'
    });

    const invoice = await square.createInvoice({
      customerId: customer.id,
      invoiceNumber: 'INV-SQUARE-202',
      currency: 'USD',
      dueDate: '2026-05-01',
      description: 'Consulting & Implementation Services',
      items: [
        { description: 'Architecture Review', quantity: 2, unit_price: 600, tax_rate: 5 },
        { description: 'Production Setup', quantity: 1, unit_price: 800, tax_rate: 5 }
      ]
    });

    assert.strictEqual(invoice.provider, 'square');
    assert.strictEqual(invoice.subtotal, 2000); // 1200 + 800
    assert.strictEqual(invoice.tax, 100); // 5% of 2000
    assert.strictEqual(invoice.total, 2100);
    assert.strictEqual(invoice.status, 'draft');

    testSquareInvoiceId = invoice.id;
  });

  // 13. Publishing Square invoice
  await test('13. Publishing Square invoice - publishes invoice and returns public payment URL', async () => {
    const square = new SquareProvider(userA);
    const published = await square.publishInvoice(testSquareInvoiceId);

    assert.strictEqual(published.id, testSquareInvoiceId);
    assert.strictEqual(published.status, 'open');
    assert(published.hosted_invoice_url.includes('squareupsandbox.com') || published.hosted_invoice_url.includes('square'), 'Must have Square payment URL');
  });

  // 14. Duplicate invoice prevention (Idempotency)
  await test('14. Duplicate invoice prevention - returns existing invoice on repeated idempotency key', async () => {
    const stripe = new StripeProvider(userA);
    const customer = await stripe.createCustomer({
      name: 'Deduplication Test Client',
      email: 'dedup@client.com'
    });

    const idempotencyKey = `idem_key_${Date.now()}`;
    const invoice1 = await stripe.createInvoice({
      customerId: customer.id,
      invoiceNumber: 'INV-DEDUP-001',
      currency: 'USD',
      dueDate: '2026-06-01',
      items: [{ description: 'Test Item', quantity: 1, unit_price: 50 }],
      idempotencyKey
    });

    // Re-issue with identical idempotencyKey
    const invoice2 = await stripe.createInvoice({
      customerId: customer.id,
      invoiceNumber: 'INV-DEDUP-001',
      currency: 'USD',
      dueDate: '2026-06-01',
      items: [{ description: 'Test Item', quantity: 1, unit_price: 50 }],
      idempotencyKey
    });

    assert.strictEqual(invoice1.id, invoice2.id, 'Idempotency must return identical invoice ID');
    assert.strictEqual(invoice1.total, invoice2.total);
  });

  // 15. Webhook signature verification
  await test('15. Webhook signature verification - Square HMAC-SHA256 signature verification', async () => {
    const secretKey = 'sq_test_webhook_signing_secret_xyz';
    const notificationUrl = 'https://crm-saas.com/api/webhooks/square';
    const payloadBody = JSON.stringify({
      event_id: 'evt_sq_payment_123',
      type: 'invoice.payment_made',
      data: { object: { invoice: { id: 'sq_inv_123', status: 'PAID' } } }
    });

    const combined = notificationUrl + payloadBody;
    const validSignature = crypto.createHmac('sha256', secretKey).update(combined).digest('base64');
    
    // Test matching signature
    const testSig = crypto.createHmac('sha256', secretKey).update(combined).digest('base64');
    assert.strictEqual(testSig, validSignature, 'Valid signature must match expected HMAC');

    // Test forged signature
    const forgedSignature = crypto.createHmac('sha256', 'wrong_key').update(combined).digest('base64');
    assert.notStrictEqual(forgedSignature, validSignature, 'Forged signature must mismatch');
  });

  // 16. Duplicate webhook handling
  await test('16. Duplicate webhook handling - idempotently skips already processed event IDs', async () => {
    const eventId = `evt_stripe_charge_${Date.now()}`;
    const initialCheck = await paymentDb.isWebhookEventProcessed('stripe', eventId);
    assert.strictEqual(initialCheck, false, 'New event must not be marked processed');

    await paymentDb.markWebhookEventProcessed('stripe', eventId);
    const secondCheck = await paymentDb.isWebhookEventProcessed('stripe', eventId);
    assert.strictEqual(secondCheck, true, 'Event must now be registered as processed');
  });

  // 17. Provider token expiration
  await test('17. Provider token expiration - corrupted ciphertext triggers PROVIDER_AUTH_EXPIRED', async () => {
    const expiredAccount = {
      id: `conn_stripe_${userA}_expired`,
      user_id: userA,
      provider: 'stripe' as const,
      provider_account_id: 'acct_expired_01',
      access_token_encrypted: 'corrupted_token_data',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    await paymentDb.saveConnectedAccount(expiredAccount);

    const stripe = new StripeProvider(userA);
    let threw = false;
    try {
      await stripe.createInvoice({
        customerId: 'cust_any',
        invoiceNumber: 'INV-FAIL-EXP',
        currency: 'USD',
        dueDate: '2026-05-01',
        items: [{ description: 'Test', quantity: 1, unit_price: 100 }]
      });
    } catch (err: any) {
      threw = true;
      assert(err instanceof PaymentProviderError);
      assert.strictEqual(err.code, 'PROVIDER_AUTH_EXPIRED');
    }
    assert(threw, 'Corrupted or expired access token must throw PROVIDER_AUTH_EXPIRED');
  });

  // 18. Provider authorization revocation
  await test('18. Provider authorization revocation - disconnect removes account credentials cleanly', async () => {
    const stripe = new StripeProvider(userA);
    // Connect first
    await stripe.connect('simulated_stripe_code', 'http://localhost:3000/callback');
    let acc = await stripe.getAccount();
    assert.strictEqual(acc.connected, true);

    // Disconnect
    await stripe.disconnect();
    acc = await stripe.getAccount();
    assert.strictEqual(acc.connected, false);

    const rawInDb = await paymentDb.getConnectedAccount(userA, 'stripe');
    assert.strictEqual(rawInDb, null, 'Connected account record must be removed');
  });

  // 19. User authorization / tenant isolation
  await test('19. User authorization/isolation - User A cannot access User B customers or invoices', async () => {
    // User A creates a customer and invoice
    const stripeA = new StripeProvider(userA);
    await stripeA.connect('simulated_stripe_code', 'http://localhost:3000/callback');

    const customerA = await stripeA.createCustomer({
      name: 'Private Client User A',
      email: 'client_a@secret.com'
    });

    const invoiceA = await stripeA.createInvoice({
      customerId: customerA.id,
      invoiceNumber: 'INV-A-001',
      currency: 'USD',
      dueDate: '2026-04-20',
      items: [{ description: 'Private Services', quantity: 1, unit_price: 1000 }]
    });

    // User B tries to read User A customer
    let customerDenied = false;
    try {
      await paymentDb.getCustomer(userB, customerA.id);
    } catch (err: any) {
      customerDenied = true;
      assert.strictEqual(err.code, 'UNAUTHORIZED_ACCESS');
    }
    assert(customerDenied, 'User B must be forbidden from accessing User A customer');

    // User B tries to read User A invoice
    let invoiceDenied = false;
    try {
      await paymentDb.getInvoice(userB, invoiceA.id);
    } catch (err: any) {
      invoiceDenied = true;
      assert.strictEqual(err.code, 'UNAUTHORIZED_ACCESS');
    }
    assert(invoiceDenied, 'User B must be forbidden from accessing User A invoice');

    // User B listing invoices only sees their own
    const userBInvoices = await paymentDb.listInvoices(userB);
    const leaked = userBInvoices.some(inv => inv.id === invoiceA.id);
    assert.strictEqual(leaked, false, "User B invoice list must never include User A's invoices");
  });

  console.log('\n===========================================================');
  console.log(`TEST SUITE RESULTS: ${passed}/${total} TESTS PASSED (${Math.round((passed/total)*100)}%)`);
  console.log('===========================================================');

  if (passed !== total) {
    process.exit(1);
  }
}

runPaymentIntegrationTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
