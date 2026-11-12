/**
 * The one place the server creates Stripe API clients.
 *
 * Stripe Connect (Standard accounts, OAuth): every call is made with the PLATFORM secret key
 * (STRIPE_SECRET_KEY) plus the `Stripe-Account: acct_…` header of the organization's connected account,
 * which is what Stripe recommends over using the connected account's OAuth access token as an API key.
 * The access token is still stored (encrypted) as received, but isn't needed for API calls.
 *
 * The API version is pinned: a version change changes request/response shapes and is a deliberate,
 * tested change, never a side effect of upgrading the SDK.
 *
 * Tests replace the client with `setStripeClientFactoryForTests` (no network, no keys).
 */
import Stripe from 'stripe';
import { optionalSecret } from '../../utils/secrets';
import { PaymentProviderError } from './types';

export const STRIPE_API_VERSION = '2023-10-16';

type Factory = (secretKey: string) => Stripe;
let factory: Factory = (key) => new Stripe(key, { apiVersion: STRIPE_API_VERSION as any, maxNetworkRetries: 2, timeout: 20_000 });

/** Tests only: swap the Stripe client (pass null to restore the real SDK). */
export function setStripeClientFactoryForTests(f: Factory | null) {
  factory = f ?? ((key) => new Stripe(key, { apiVersion: STRIPE_API_VERSION as any, maxNetworkRetries: 2, timeout: 20_000 }));
}

/** A client using the platform secret key. Throws 503 stripe_not_configured without one. */
export function platformStripe(): Stripe {
  const key = optionalSecret('STRIPE_SECRET_KEY');
  if (!key) throw new PaymentProviderError('PROVIDER_NOT_CONFIGURED', 'Stripe isn’t set up on this server yet. An administrator adds the Stripe keys.', 'stripe', null, 503);
  return factory(key);
}

/** Test-mode keys only produce test objects; the UI shows this so nobody mistakes a test invoice for a real one. */
export function stripeMode(): 'test' | 'live' | 'unknown' {
  const key = optionalSecret('STRIPE_SECRET_KEY');
  return key.startsWith('sk_test_') || key.startsWith('rk_test_') ? 'test' : key.startsWith('sk_live_') || key.startsWith('rk_live_') ? 'live' : 'unknown';
}

/**
 * Currencies the CRM invoices in, with Stripe's minor-unit exponent. They match the Invoicing app's
 * `CURRENCIES` decimals exactly (JPY is zero-decimal in both), so CRM minor units = Stripe amounts.
 * Anything else is refused rather than guessed (a wrong exponent bills 100× too much or too little).
 */
export const STRIPE_CURRENCY_EXPONENT: Record<string, number> = {
  USD: 2, EUR: 2, GBP: 2, CAD: 2, AUD: 2, CHF: 2, JPY: 0, INR: 2, NGN: 2, ZAR: 2,
};

export function assertStripeCurrency(code: unknown): string {
  const c = typeof code === 'string' ? code.trim().toUpperCase() : '';
  if (!Object.prototype.hasOwnProperty.call(STRIPE_CURRENCY_EXPONENT, c)) {
    throw new PaymentProviderError('PROVIDER_VALIDATION_ERROR', `Stripe invoices can be created in ${Object.keys(STRIPE_CURRENCY_EXPONENT).join(', ')}.`, 'stripe', null, 400);
  }
  return c;
}

/** Stripe's minimum charge per currency (major units ≈ 0.50 USD), from Stripe's documentation. */
const MIN_CHARGE_MINOR: Record<string, number> = { USD: 50, EUR: 50, GBP: 30, CAD: 50, AUD: 50, CHF: 50, JPY: 50, INR: 50, NGN: 50, ZAR: 50 };
export const minimumChargeMinor = (currency: string) => MIN_CHARGE_MINOR[currency] ?? 50;

/** Request options for an organization's connected account, with an idempotency key for writes. */
export function onAccount(accountId: string, idempotencyKey?: string): Stripe.RequestOptions {
  return { stripeAccount: accountId, ...(idempotencyKey ? { idempotencyKey: idempotencyKey.slice(0, 255) } : {}) };
}

/** A safe summary of a Stripe error for logs and error details (never the request, never keys). */
export function stripeErrorSummary(err: any): { type?: string; code?: string; statusCode?: number; requestId?: string } {
  return { type: err?.type, code: err?.code, statusCode: err?.statusCode, requestId: err?.requestId };
}

/** A user-facing message for a Stripe error: Stripe's own message only for card/validation errors. */
export function stripeUserMessage(err: any, fallback: string): string {
  if (err?.type === 'StripeInvalidRequestError' && typeof err?.message === 'string' && err.message.length < 300) return `Stripe: ${err.message}`;
  if (err?.type === 'StripePermissionError') return 'Stripe refused this request for the connected account. Reconnect Stripe and try again.';
  if (err?.type === 'StripeRateLimitError') return 'Stripe is busy right now. Try again in a minute.';
  if (err?.type === 'StripeConnectionError' || err?.type === 'StripeAPIError') return 'Stripe couldn’t be reached. Try again in a minute.';
  return fallback;
}
