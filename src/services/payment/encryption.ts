import crypto from 'crypto';
import { PaymentProviderError } from './types';
import { coreSecret } from '../../utils/secrets';

// Derives a 32-byte AES key from environment secret
function getEncryptionKey(): Buffer {
  const secret = coreSecret(['PAYMENT_ENCRYPTION_SECRET', 'JWT_SECRET']);
  return crypto.createHash('sha256').update(secret).digest();
}

const HMAC_SECRET = coreSecret(['OAUTH_STATE_SECRET', 'JWT_SECRET']);

/**
 * Encrypts sensitive credentials (such as OAuth access tokens and refresh tokens)
 * using AES-256-GCM authenticated encryption.
 * Output format: `ivHex:authTagHex:ciphertextHex`
 */
export function encryptToken(plainText: string): string {
  if (!plainText) return '';
  const iv = crypto.randomBytes(12); // 96-bit IV recommended for GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  
  let encrypted = cipher.update(plainText, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * Decrypts AES-256-GCM encrypted tokens.
 * Throws PaymentProviderError if ciphertext or auth tag has been tampered with.
 */
export function decryptToken(encryptedData: string): string {
  if (!encryptedData) return '';
  const parts = encryptedData.split(':');
  if (parts.length !== 3) {
    throw new PaymentProviderError('PROVIDER_VALIDATION_ERROR', 'Invalid encrypted token format');
  }

  const [ivHex, authTagHex, cipherHex] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');

  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', getEncryptionKey(), iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(cipherHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err: any) {
    throw new PaymentProviderError(
      'PROVIDER_AUTH_REVOKED',
      'Failed to decrypt token: authentication tag mismatch or corrupted secret',
      undefined,
      err.message,
      500
    );
  }
}

export interface OAuthStatePayload {
  /** The organization the connection is for. */
  userId: string;
  provider: 'stripe' | 'square';
  nonce: string;
  timestamp: number;
  /** The CRM user who started the flow (recorded on the connection). */
  actor?: string;
  /** sha256 of a random value kept in an HttpOnly cookie of the browser that started the flow. */
  bind?: string;
}

/**
 * Generates a signed, tamper-proof OAuth state token for CSRF defense.
 */
export function generateOAuthState(userId: string, provider: 'stripe' | 'square', extra: { actor?: string; bind?: string } = {}): string {
  const nonce = crypto.randomBytes(16).toString('hex');
  const timestamp = Date.now();
  const actor = extra.actor || '', bind = extra.bind || '';
  const rawData = `${userId}:${provider}:${nonce}:${timestamp}:${actor}:${bind}`;
  const signature = crypto.createHmac('sha256', HMAC_SECRET).update(rawData).digest('hex');
  
  const payload: OAuthStatePayload & { signature: string } = {
    userId,
    provider,
    nonce,
    timestamp,
    ...(actor ? { actor } : {}),
    ...(bind ? { bind } : {}),
    signature
  };

  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

/**
 * Validates the OAuth state token returned by Stripe or Square callback.
 * Ensures the signature matches, the timestamp is within 15 minutes,
 * and the state belongs to the expected user and provider.
 */
export function validateOAuthState(stateStr: string, expectedProvider: 'stripe' | 'square'): OAuthStatePayload {
  if (!stateStr) {
    throw new PaymentProviderError('CSRF_STATE_INVALID', 'Missing OAuth state parameter', expectedProvider);
  }

  let payload: any;
  try {
    const decoded = Buffer.from(stateStr, 'base64url').toString('utf8');
    payload = JSON.parse(decoded);
  } catch {
    throw new PaymentProviderError('CSRF_STATE_INVALID', 'Malformed OAuth state parameter', expectedProvider);
  }

  const { userId, provider, nonce, timestamp, signature } = payload;
  const actor = typeof payload.actor === 'string' ? payload.actor : '';
  const bind = typeof payload.bind === 'string' ? payload.bind : '';
  if (!userId || !provider || !nonce || !timestamp || !signature) {
    throw new PaymentProviderError('CSRF_STATE_INVALID', 'OAuth state missing required claims', expectedProvider);
  }

  if (provider !== expectedProvider) {
    throw new PaymentProviderError('CSRF_STATE_INVALID', `OAuth state provider mismatch. Expected ${expectedProvider}, got ${provider}`);
  }

  // Validate lifetime (15 minutes max)
  const MAX_AGE_MS = 15 * 60 * 1000;
  if (Date.now() - timestamp > MAX_AGE_MS) {
    throw new PaymentProviderError('CSRF_STATE_INVALID', 'OAuth state expired. Please initiate connection again.', expectedProvider);
  }

  // Verify HMAC signature
  const rawData = `${userId}:${provider}:${nonce}:${timestamp}:${actor}:${bind}`;
  const expectedSig = crypto.createHmac('sha256', HMAC_SECRET).update(rawData).digest('hex');

  const sigBuf = Buffer.from(signature, 'hex');
  const expectedSigBuf = Buffer.from(expectedSig, 'hex');

  if (sigBuf.length !== expectedSigBuf.length || !crypto.timingSafeEqual(sigBuf, expectedSigBuf)) {
    throw new PaymentProviderError('CSRF_STATE_INVALID', 'OAuth state signature verification failed', expectedProvider);
  }

  return { userId, provider, nonce, timestamp, ...(actor ? { actor } : {}), ...(bind ? { bind } : {}) };
}
