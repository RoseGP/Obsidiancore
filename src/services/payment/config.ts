/**
 * Which payment providers this server can talk to. Nothing is simulated: without the credentials below a
 * provider answers 503 `<provider>_not_configured` and the UI says so.
 *   Stripe: STRIPE_SECRET_KEY + STRIPE_CLIENT_ID (Connect OAuth)
 *   Square: SQUARE_APPLICATION_ID + SQUARE_APPLICATION_SECRET (OAuth)
 */
import { PaymentProviderError, type PaymentProviderType } from './types';

export function providerConfigured(p: PaymentProviderType): boolean {
  if (p === 'stripe') return Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_CLIENT_ID);
  if (p === 'square') return Boolean(process.env.SQUARE_APPLICATION_ID && process.env.SQUARE_APPLICATION_SECRET);
  return false;
}

export function assertProviderConfigured(p: PaymentProviderType): void {
  if (!providerConfigured(p)) {
    const name = p === 'stripe' ? 'Stripe' : 'Square';
    throw new PaymentProviderError('PROVIDER_NOT_CONFIGURED', `${name} isn't set up on this server yet. An administrator adds the ${name} keys.`, p, null, 503);
  }
}
