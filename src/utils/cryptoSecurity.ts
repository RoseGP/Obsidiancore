import crypto from 'crypto';
import { coreSecret } from './secrets';

/**
 * AES-256-GCM Cryptographic Security Engine
 * Provides authenticated encryption for OAuth access tokens, refresh tokens, and API credentials.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16; // 128-bit IV for AES-GCM
const DEFAULT_KEY = coreSecret('ENCRYPTION_KEY', { length: 32 });

// Derives exactly a 32-byte (256-bit) buffer key from any input string or secret
function getKeyBuffer(customKey?: string): Buffer {
  const secret = customKey || DEFAULT_KEY;
  const key = Buffer.alloc(32);
  const secretBuf = Buffer.from(secret, 'utf8');
  secretBuf.copy(key);
  return key;
}

export interface EncryptedPayload {
  encryptedToken: string;
  iv: string;
  authTag: string;
}

/**
 * Encrypts a plaintext OAuth token or credential using AES-256-GCM.
 */
export function encryptToken(plainText: string, customKey?: string): EncryptedPayload {
  if (!plainText) {
    throw new Error('Encryption error: plainText value cannot be empty');
  }

  const iv = crypto.randomBytes(IV_LENGTH);
  const key = getKeyBuffer(customKey);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plainText, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');

  return {
    encryptedToken: encrypted,
    iv: iv.toString('hex'),
    authTag: authTag
  };
}

/**
 * Decrypts an AES-256-GCM encrypted token with verification of the authentication tag.
 */
export function decryptToken(encryptedToken: string, ivHex: string, authTagHex: string, customKey?: string): string {
  if (!encryptedToken || !ivHex || !authTagHex) {
    throw new Error('Decryption error: encryptedToken, iv, and authTag are all required.');
  }

  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const key = getKeyBuffer(customKey);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encryptedToken, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

export const cryptoSecurity = {
  encryptToken,
  decryptToken
};
