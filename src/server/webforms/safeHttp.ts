/**
 * Outbound HTTPS for CRM webhooks, safe against server-side request forgery:
 *   - https only (http is refused);
 *   - the host is resolved once and EVERY address must be public (no loopback, private, link-local, CGNAT,
 *     multicast, cloud metadata 169.254.169.254, IPv6 ULA/link-local, or IPv4-mapped private addresses);
 *     the connection is pinned to that checked address (no DNS-rebinding window);
 *   - redirects are not followed; a timeout applies; at most 64 KB of the response is read and discarded.
 * Tests (and local development) may allow private addresses with { allowPrivate: true }; production never does.
 */
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

export class OutboundError extends Error {
  constructor(message: string, public code: 'invalid_url' | 'blocked_address' | 'dns_failed' | 'timeout' | 'network') { super(message); }
}

function v4ToInt(ip: string) { return ip.split('.').reduce((a, o) => (a << 8) + Number(o), 0) >>> 0; }
const inV4 = (ip: string, cidr: string) => { const [base, bits] = cidr.split('/'); const mask = Number(bits) === 0 ? 0 : (~0 << (32 - Number(bits))) >>> 0; return (v4ToInt(ip) & mask) === (v4ToInt(base) & mask); };
const PRIVATE_V4 = ['0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8', '169.254.0.0/16', '172.16.0.0/12', '192.0.0.0/24', '192.0.2.0/24', '192.168.0.0/16', '198.18.0.0/15', '198.51.100.0/24', '203.0.113.0/24', '224.0.0.0/4', '240.0.0.0/4'];

export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) return PRIVATE_V4.some((c) => inV4(ip, c));
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    if (lower === '::' || lower === '::1') return true;
    const first = parseInt(lower.split(':')[0] || '0', 16);
    if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
    if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
    if ((first & 0xff00) === 0xff00) return true; // multicast
    return false;
  }
  return true; // not an IP: treat as unsafe
}

export interface PostResult { status: number; ms: number }

export function validateWebhookUrl(raw: string, opts: { allowHttp?: boolean } = {}): URL {
  let u: URL;
  try { u = new URL(raw); } catch { throw new OutboundError('Enter a full URL starting with https://.', 'invalid_url'); }
  if (u.protocol !== 'https:' && !(opts.allowHttp && u.protocol === 'http:')) throw new OutboundError('The webhook URL must start with https://.', 'invalid_url');
  if (u.username || u.password) throw new OutboundError('Don\'t put credentials in the URL; use the signing secret instead.', 'invalid_url');
  if (!u.hostname || u.hostname.length > 253) throw new OutboundError('The webhook URL has no valid host.', 'invalid_url');
  return u;
}

export async function safePostJson(rawUrl: string, body: string, headers: Record<string, string>, opts: { timeoutMs?: number; allowPrivate?: boolean } = {}): Promise<PostResult> {
  const allowPrivate = !!opts.allowPrivate && process.env.NODE_ENV !== 'production';
  const u = validateWebhookUrl(rawUrl, { allowHttp: allowPrivate });
  const host = u.hostname.replace(/^\[|\]$/g, '');
  let addresses: dns.LookupAddress[];
  try {
    addresses = net.isIP(host) ? [{ address: host, family: net.isIPv6(host) ? 6 : 4 }] : await dns.promises.lookup(host, { all: true, verbatim: true });
  } catch { throw new OutboundError('The webhook host couldn\'t be resolved.', 'dns_failed'); }
  if (!addresses.length) throw new OutboundError('The webhook host couldn\'t be resolved.', 'dns_failed');
  if (!allowPrivate && addresses.some((a) => isPrivateAddress(a.address))) {
    throw new OutboundError('The webhook URL points to a private or internal address, which isn\'t allowed.', 'blocked_address');
  }
  const pinned = addresses[0];
  const started = Date.now();
  const timeoutMs = opts.timeoutMs ?? 8000;
  const lib = u.protocol === 'https:' ? https : http;
  return new Promise<PostResult>((resolve, reject) => {
    const req = lib.request({
      protocol: u.protocol, hostname: host, port: u.port || undefined, path: `${u.pathname}${u.search}`, method: 'POST',
      servername: net.isIP(host) ? undefined : host, // SNI and certificate check against the real host name
      headers: { ...headers, 'Content-Length': String(Buffer.byteLength(body)) },
      // Connect to the address we checked, not whatever DNS answers a moment later.
      lookup: (_h: string, options: any, cb: any) => (options?.all ? cb(null, [pinned]) : cb(null, pinned.address, pinned.family)),
      timeout: timeoutMs,
    }, (res) => {
      let read = 0;
      res.on('data', (chunk: Buffer) => { read += chunk.length; if (read > 64 * 1024) res.destroy(); });
      res.on('end', () => resolve({ status: res.statusCode || 0, ms: Date.now() - started }));
      res.on('close', () => resolve({ status: res.statusCode || 0, ms: Date.now() - started }));
      res.on('error', () => resolve({ status: res.statusCode || 0, ms: Date.now() - started }));
    });
    req.on('timeout', () => { req.destroy(new OutboundError('The webhook didn\'t answer in time.', 'timeout')); });
    req.on('error', (e) => reject(e instanceof OutboundError ? e : new OutboundError('The webhook couldn\'t be reached.', 'network')));
    req.end(body);
  });
}
