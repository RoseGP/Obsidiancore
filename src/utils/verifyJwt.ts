export interface JWTPayload {
  userId: string;
  email: string;
  exp?: number;
  iat?: number;
  [key: string]: any;
}

// Alias for backwards compatibility
export type JwtPayload = JWTPayload;

/**
 * Base64URL Helpers for Edge Runtime
 */
export function base64UrlEncode(str: string | Uint8Array): string {
  const bytes = typeof str === 'string' ? new TextEncoder().encode(str) : str;
  const base64 = btoa(String.fromCharCode(...bytes));
  return base64.replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

export function base64UrlDecode(str: string): string {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  const binaryStr = atob(base64);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

/**
 * Imports a plaintext secret into a SubtleCrypto CryptoKey
 */
export async function getCryptoKey(secret: string, usage: 'sign' | 'verify'): Promise<CryptoKey> {
  const enc = new TextEncoder();
  return await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    [usage]
  );
}

/**
 * Generates an HMAC SHA-256 signed JWT
 */
export async function signJwt(payload: JWTPayload, secret: string, expiresInSeconds = 86400): Promise<string> {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);

  const fullPayload: JWTPayload = {
    ...payload,
    iat: now,
    exp: now + expiresInSeconds,
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(fullPayload));
  const tokenData = `${encodedHeader}.${encodedPayload}`;

  const key = await getCryptoKey(secret, 'sign');
  const signatureBuffer = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(tokenData)
  );

  const encodedSignature = base64UrlEncode(new Uint8Array(signatureBuffer));
  return `${tokenData}.${encodedSignature}`;
}

/**
 * Verifies an incoming JWT and returns the decoded payload
 */
export async function verifyJwt(token: string, secret: string): Promise<JWTPayload | null> {
  try {
    if (!token || typeof token !== 'string') return null;

    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [encodedHeader, encodedPayload, encodedSignature] = parts;

    // 1. Verify Header Algorithm
    const header = JSON.parse(base64UrlDecode(encodedHeader));
    if (header.alg !== 'HS256') return null;

    // 2. Verify Cryptographic Signature
    const key = await getCryptoKey(secret, 'verify');
    const tokenData = `${encodedHeader}.${encodedPayload}`;
    
    // Decode signature back to Uint8Array
    let base64Sig = encodedSignature.replace(/-/g, '+').replace(/_/g, '/');
    while (base64Sig.length % 4) base64Sig += '=';
    const sigBinary = atob(base64Sig);
    const signatureBytes = new Uint8Array(sigBinary.length);
    for (let i = 0; i < sigBinary.length; i++) {
      signatureBytes[i] = sigBinary.charCodeAt(i);
    }

    const isValid = await crypto.subtle.verify(
      'HMAC',
      key,
      signatureBytes,
      new TextEncoder().encode(tokenData)
    );

    if (!isValid) return null;

    // 3. Time claims. `exp` is REQUIRED: a token without one used to be valid forever.
    //    `nbf` / `iat` in the future are rejected; 30 s of clock skew is allowed.
    const payload: JWTPayload = JSON.parse(base64UrlDecode(encodedPayload));
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
    const now = Math.floor(Date.now() / 1000);
    const SKEW = 30;
    if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp) || payload.exp + SKEW < now) return null;
    if (payload.nbf !== undefined && (typeof payload.nbf !== 'number' || payload.nbf - SKEW > now)) return null;
    if (payload.iat !== undefined && (typeof payload.iat !== 'number' || payload.iat - SKEW > now)) return null;

    return payload;
  } catch (err) {
    console.error('JWT Verification Error:', err);
    return null;
  }
}
