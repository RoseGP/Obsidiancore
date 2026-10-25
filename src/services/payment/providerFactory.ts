import { PaymentProvider, PaymentProviderType, PaymentProviderError } from './types';
import { StripeProvider } from './stripeProvider';
import { SquareProvider } from './squareProvider';

export function getPaymentProvider(userId: string, provider: PaymentProviderType): PaymentProvider {
  if (provider === 'stripe') {
    return new StripeProvider(userId);
  }
  if (provider === 'square') {
    return new SquareProvider(userId);
  }
  throw new PaymentProviderError('PROVIDER_VALIDATION_ERROR', `Unsupported payment provider: ${provider}`);
}
