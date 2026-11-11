/**
 * AWS Signature V4 presigned URLs (S3 and S3-compatible storage) for GREET recordings, without an SDK.
 * Used for short-lived download links (GET) and the deletion workflow (DELETE). Keys come from env only.
 */
import crypto from 'crypto';
import type { EgressConfig } from '../meetings/media';

const hmac = (key: Buffer | string, data: string) => crypto.createHmac('sha256', key).update(data).digest();
const sha256hex = (data: string) => crypto.createHash('sha256').update(data).digest('hex');
const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

export function presignS3(cfg: EgressConfig, method: 'GET' | 'DELETE', key: string, expiresSeconds = 300, now = new Date()): string {
  const endpoint = cfg.endpoint ? cfg.endpoint.replace(/\/+$/, '') : `https://${cfg.bucket}.s3.${cfg.region}.amazonaws.com`;
  const url = new URL(endpoint);
  const pathStyle = !!cfg.endpoint;
  const path = (pathStyle ? `/${cfg.bucket}/` : '/') + key.split('/').map(enc).join('/');
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = amzDate.slice(0, 8);
  const scope = `${day}/${cfg.region}/s3/aws4_request`;
  const params: Record<string, string> = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${cfg.accessKey}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(Math.min(604800, Math.max(1, expiresSeconds))),
    'X-Amz-SignedHeaders': 'host',
  };
  const query = Object.keys(params).sort().map((k) => `${enc(k)}=${enc(params[k])}`).join('&');
  const canonical = [method, path, query, `host:${url.host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonical)].join('\n');
  const kSigning = hmac(hmac(hmac(hmac(`AWS4${cfg.secret}`, day), cfg.region), 's3'), 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(toSign).digest('hex');
  return `${url.protocol}//${url.host}${path}?${query}&X-Amz-Signature=${signature}`;
}
