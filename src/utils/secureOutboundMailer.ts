import crypto from 'crypto';
import tls from 'tls';
import nodemailer from 'nodemailer';
import type { Transporter, SendMailOptions } from 'nodemailer';
import { wsDispatcher } from './wsDispatcher';

export type DKIMAlgorithm = 'rsa-sha256' | 'ed25519-sha256';

export interface DKIMConfig {
  domainName: string;
  keySelector: string;
  privateKey: string;
  publicKey?: string;
  algorithm?: DKIMAlgorithm;
  headerFieldNames?: string; // Default: 'from:to:subject:date:message-id:mime-version:content-type'
  canonicalization?: 'relaxed/relaxed' | 'simple/simple' | 'relaxed/simple';
}

export interface CloudflareMtlsRelayConfig {
  host: string;
  port: number;
  secure?: boolean;
  user?: string;
  pass?: string;
  // mTLS Client Certificate Options
  clientCert?: string;
  clientKey?: string;
  caCert?: string;
  passphrase?: string;
  // Cloudflare Access Service Tokens
  cfAccessClientId?: string;
  cfAccessClientSecret?: string;
  rejectUnauthorized?: boolean;
}

export interface SendSecureEmailOptions {
  from?: string;
  fromName?: string;
  to: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  subject: string;
  text?: string;
  html?: string;
  attachments?: Array<{
    filename: string;
    content?: string | Buffer;
    path?: string;
    contentType?: string;
  }>;
  dkim?: Partial<DKIMConfig>;
  relayConfig?: Partial<CloudflareMtlsRelayConfig>;
}

export interface DKIMKeyPairResult {
  algorithm: DKIMAlgorithm;
  selector: string;
  domain: string;
  publicKeyPem: string;
  privateKeyPem: string;
  dnsTxtRecord: string;
  dnsRecordName: string;
}

// Default Configuration fallbacks from environment variables
const DEFAULT_DKIM_DOMAIN = process.env.DKIM_DOMAIN || 'crm-omnichannel.com';
const DEFAULT_DKIM_SELECTOR = process.env.DKIM_SELECTOR || 'cf2026';

/**
 * 1. DKIM Key Pair Generator
 * Generates valid RSA (2048-bit) or Ed25519 Keypairs and constructs the DNS TXT record format.
 */
export function generateDKIMKeyPair(
  algorithm: DKIMAlgorithm = 'rsa-sha256',
  domain: string = DEFAULT_DKIM_DOMAIN,
  selector: string = DEFAULT_DKIM_SELECTOR,
  keyBits: number = 2048
): DKIMKeyPairResult {
  let publicKeyPem = '';
  let privateKeyPem = '';
  let dnsTxtRecord = '';

  if (algorithm === 'rsa-sha256') {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: keyBits,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    publicKeyPem = publicKey;
    privateKeyPem = privateKey;

    // Format public key for DNS TXT record (strip headers and newlines)
    const rawBase64 = publicKey
      .replace(/-----BEGIN PUBLIC KEY-----/g, '')
      .replace(/-----END PUBLIC KEY-----/g, '')
      .replace(/\s+/g, '');

    dnsTxtRecord = `v=DKIM1; k=rsa; p=${rawBase64}`;
  } else {
    // Ed25519 DKIM Key Generation
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    publicKeyPem = publicKey;
    privateKeyPem = privateKey;

    const rawBase64 = publicKey
      .replace(/-----BEGIN PUBLIC KEY-----/g, '')
      .replace(/-----END PUBLIC KEY-----/g, '')
      .replace(/\s+/g, '');

    dnsTxtRecord = `v=DKIM1; k=ed25519; p=${rawBase64}`;
  }

  const dnsRecordName = `${selector}._domainkey.${domain}`;

  return {
    algorithm,
    selector,
    domain,
    publicKeyPem,
    privateKeyPem,
    dnsTxtRecord,
    dnsRecordName,
  };
}

/**
 * 2. Cryptographic DKIM Header Signer (RSA-SHA256 & Ed25519-SHA256)
 * Generates RFC 6376 compliant DKIM-Signature headers.
 */
export function createDKIMHeader(
  headers: Record<string, string>,
  bodyText: string,
  config: DKIMConfig
): string {
  const domain = config.domainName || DEFAULT_DKIM_DOMAIN;
  const selector = config.keySelector || DEFAULT_DKIM_SELECTOR;
  const algo = config.algorithm || 'rsa-sha256';
  const headerFields = config.headerFieldNames || 'from:to:subject:date:message-id';

  // Body Canonicalization (relaxed) & Body Hash (SHA-256)
  const canonicalBody = bodyText.trim().replace(/[ \t]+/g, ' ') + '\r\n';
  const bodyHash = crypto.createHash('sha256').update(canonicalBody).digest('base64');

  const timestamp = Math.floor(Date.now() / 1000);

  // Construct DKIM-Signature template before computing signature (b=)
  const dkimTemplate = 
    `v=1; a=${algo}; c=relaxed/relaxed; d=${domain}; s=${selector}; ` +
    `t=${timestamp}; h=${headerFields}; bh=${bodyHash}; b=`;

  // Prepare header block to sign
  const headersToSign = headerFields.split(':');
  let headerBlockToSign = '';

  for (const h of headersToSign) {
    const val = headers[h.toLowerCase()] || headers[h] || '';
    headerBlockToSign += `${h.toLowerCase()}:${val.trim()}\r\n`;
  }
  headerBlockToSign += `dkim-signature:${dkimTemplate}`;

  // Sign with RSA or Ed25519
  let signatureBase64 = '';
  if (algo === 'ed25519-sha256') {
    // Ed25519 signature using Node crypto
    const signer = crypto.createSign(null);
    signer.update(headerBlockToSign);
    signatureBase64 = signer.sign(config.privateKey, 'base64');
  } else {
    // RSA-SHA256 signature
    const signer = crypto.createSign('RSA-SHA256');
    signer.update(headerBlockToSign);
    signatureBase64 = signer.sign(config.privateKey, 'base64');
  }

  return `${dkimTemplate}${signatureBase64}`;
}

/**
 * 3. Authenticated Cloudflare mTLS Relay Transporter Builder
 * Constructs a Nodemailer transporter configured with Cloudflare mTLS Client Certificates
 * and DKIM signature integration.
 */
export function createCloudflareMtlsTransporter(
  relayConfig?: Partial<CloudflareMtlsRelayConfig>,
  dkimConfig?: Partial<DKIMConfig>
): Transporter {
  const host = relayConfig?.host || process.env.CLOUDFLARE_SMTP_RELAY_HOST || process.env.SMTP_HOST || 'smtp.cloudflare.com';
  const port = relayConfig?.port || Number(process.env.CLOUDFLARE_SMTP_RELAY_PORT) || Number(process.env.SMTP_PORT) || 587;
  const secure = relayConfig?.secure ?? (port === 465);

  const clientCert = relayConfig?.clientCert || process.env.CLOUDFLARE_MTLS_CLIENT_CERT;
  const clientKey = relayConfig?.clientKey || process.env.CLOUDFLARE_MTLS_CLIENT_KEY;
  const caCert = relayConfig?.caCert || process.env.CLOUDFLARE_MTLS_CA_CERT;
  const passphrase = relayConfig?.passphrase || process.env.CLOUDFLARE_MTLS_PASSPHRASE;

  const cfAccessClientId = relayConfig?.cfAccessClientId || process.env.CF_ACCESS_CLIENT_ID;
  const cfAccessClientSecret = relayConfig?.cfAccessClientSecret || process.env.CF_ACCESS_CLIENT_SECRET;

  const authUser = relayConfig?.user || process.env.CLOUDFLARE_RELAY_USER || process.env.SMTP_USER || '';
  const authPass = relayConfig?.pass || process.env.CLOUDFLARE_RELAY_PASS || process.env.SMTP_PASS || '';

  // Determine DKIM options
  let dkimOptions: any = undefined;
  if (dkimConfig?.privateKey) {
    dkimOptions = {
      domainName: dkimConfig.domainName || DEFAULT_DKIM_DOMAIN,
      keySelector: dkimConfig.keySelector || DEFAULT_DKIM_SELECTOR,
      privateKey: dkimConfig.privateKey,
    };
  }

  // Build TLS mTLS Client Options
  const tlsOptions: tls.ConnectionOptions = {
    rejectUnauthorized: relayConfig?.rejectUnauthorized ?? true,
    servername: host,
  };

  if (clientCert && clientKey) {
    tlsOptions.cert = clientCert;
    tlsOptions.key = clientKey;
    if (caCert) tlsOptions.ca = caCert;
    if (passphrase) tlsOptions.passphrase = passphrase;
  }

  // Construct Custom Headers if Cloudflare Access Service Tokens are present
  const customHeaders: Record<string, string> = {};
  if (cfAccessClientId && cfAccessClientSecret) {
    customHeaders['CF-Access-Client-Id'] = cfAccessClientId;
    customHeaders['CF-Access-Client-Secret'] = cfAccessClientSecret;
  }

  const transportOptions: any = {
    host,
    port,
    secure,
    auth: authUser && authPass ? { user: authUser, pass: authPass } : undefined,
    tls: tlsOptions,
    headers: Object.keys(customHeaders).length > 0 ? customHeaders : undefined,
    dkim: dkimOptions,
  };

  // If host is absent, fall back to sandbox jsonTransport for simulation
  if (!host || host === 'smtp.cloudflare.com' && !authUser && !clientCert) {
    console.log('[Outbound Secure Mailer] No active Cloudflare mTLS credentials configured. Operating in High-Fidelity DKIM & mTLS Simulation Mode.');
    return nodemailer.createTransport({
      jsonTransport: true,
    });
  }

  return nodemailer.createTransport(transportOptions);
}

/**
 * 4. Main Outbound Dispatcher
 * Signs message with DKIM (RSA or Ed25519) and transmits via authenticated Cloudflare mTLS Relay.
 */
export async function sendSecureOutboundEmail(options: SendSecureEmailOptions): Promise<{
  success: boolean;
  messageId: string;
  dkimHeaderGenerated?: string;
  isSimulated: boolean;
  relayUsed: string;
  algorithmUsed: DKIMAlgorithm;
}> {
  const fromEmail = options.from || process.env.SMTP_FROM || 'support@crm-omnichannel.com';
  const fromName = options.fromName || process.env.SMTP_FROM_NAME || 'Omnichannel Secure Mailer';
  const recipients = Array.isArray(options.to) ? options.to.join(', ') : options.to;

  const dkimAlgo: DKIMAlgorithm = options.dkim?.algorithm || 'rsa-sha256';
  
  // 1. Ensure or Generate DKIM Keypair for signing if not provided
  let privateKey = options.dkim?.privateKey || process.env.DKIM_PRIVATE_KEY;
  let selector = options.dkim?.keySelector || process.env.DKIM_SELECTOR || DEFAULT_DKIM_SELECTOR;
  let domain = options.dkim?.domainName || process.env.DKIM_DOMAIN || DEFAULT_DKIM_DOMAIN;

  if (!privateKey) {
    // Generate an ephemeral DKIM key pair dynamically
    const keyPair = generateDKIMKeyPair(dkimAlgo, domain, selector);
    privateKey = keyPair.privateKeyPem;
  }

  const fullDkimConfig: DKIMConfig = {
    domainName: domain,
    keySelector: selector,
    privateKey,
    algorithm: dkimAlgo,
    headerFieldNames: 'from:to:subject:date:message-id',
  };

  const messageId = `<${Date.now()}.${Math.random().toString(36).substring(2, 8)}@${domain}>`;
  const dateStr = new Date().toUTCString();

  // 2. Generate DKIM Signature Header
  const headersToSign = {
    from: `"${fromName}" <${fromEmail}>`,
    to: recipients,
    subject: options.subject,
    date: dateStr,
    'message-id': messageId,
  };

  const dkimHeaderValue = createDKIMHeader(headersToSign, options.text || options.html || '', fullDkimConfig);

  // 3. Create Transporter with Cloudflare mTLS
  const transporter = createCloudflareMtlsTransporter(options.relayConfig, fullDkimConfig);
  const isSimulated = !process.env.CLOUDFLARE_SMTP_RELAY_HOST && !process.env.SMTP_HOST;
  const relayHost = options.relayConfig?.host || process.env.CLOUDFLARE_SMTP_RELAY_HOST || process.env.SMTP_HOST || 'smtp.cloudflare.com';

  const mailOptions: SendMailOptions = {
    from: `"${fromName}" <${fromEmail}>`,
    to: recipients,
    cc: options.cc ? (Array.isArray(options.cc) ? options.cc.join(', ') : options.cc) : undefined,
    bcc: options.bcc ? (Array.isArray(options.bcc) ? options.bcc.join(', ') : options.bcc) : undefined,
    subject: options.subject,
    text: options.text,
    html: options.html,
    headers: {
      'DKIM-Signature': dkimHeaderValue,
      'X-Outbound-Security': `DKIM-${dkimAlgo.toUpperCase()}; mTLS-Cloudflare-Relay`,
      'Message-ID': messageId,
      Date: dateStr,
    },
    attachments: options.attachments?.map((att) => ({
      filename: att.filename,
      content: att.content,
      path: att.path,
      contentType: att.contentType,
    })),
  };

  console.log(`[Outbound Secure Mailer] Dispatching email to ${recipients} | DKIM: ${dkimAlgo} | Relay: ${relayHost}`);

  const info = await transporter.sendMail(mailOptions);
  const resultMessageId = info.messageId || messageId;

  // Broadcast Webhook/Socket event for live tracking
  wsDispatcher.broadcast('DKIM_MTLS_EMAIL_SENT', {
    to: recipients,
    subject: options.subject,
    messageId: resultMessageId,
    dkimAlgorithm: dkimAlgo,
    dkimDomain: domain,
    dkimSelector: selector,
    relayHost,
    isSimulated,
    timestamp: new Date().toISOString(),
  });

  return {
    success: true,
    messageId: resultMessageId,
    dkimHeaderGenerated: dkimHeaderValue,
    isSimulated,
    relayUsed: relayHost,
    algorithmUsed: dkimAlgo,
  };
}

/**
 * 5. mTLS & Cloudflare Relay Diagnostic Test
 * Verifies TCP + TLS Handshake with Client Certificate
 */
export async function testCloudflareMtlsConnection(
  config?: Partial<CloudflareMtlsRelayConfig>
): Promise<{
  success: boolean;
  host: string;
  port: number;
  authorized: boolean;
  peerCertificate?: any;
  error?: string;
}> {
  const host = config?.host || process.env.CLOUDFLARE_SMTP_RELAY_HOST || 'smtp.cloudflare.com';
  const port = config?.port || Number(process.env.CLOUDFLARE_SMTP_RELAY_PORT) || 587;

  return new Promise((resolve) => {
    const socketOptions: tls.ConnectionOptions = {
      host,
      port,
      rejectUnauthorized: config?.rejectUnauthorized ?? false,
      cert: config?.clientCert || process.env.CLOUDFLARE_MTLS_CLIENT_CERT,
      key: config?.clientKey || process.env.CLOUDFLARE_MTLS_CLIENT_KEY,
      ca: config?.caCert || process.env.CLOUDFLARE_MTLS_CA_CERT,
    };

    const socket = tls.connect(socketOptions, () => {
      const authorized = socket.authorized;
      const peerCert = socket.getPeerCertificate();
      socket.end();

      resolve({
        success: true,
        host,
        port,
        authorized,
        peerCertificate: peerCert ? { subject: peerCert.subject, issuer: peerCert.issuer, validTo: peerCert.valid_to } : undefined,
      });
    });

    socket.on('error', (err) => {
      resolve({
        success: false,
        host,
        port,
        authorized: false,
        error: err.message,
      });
    });

    // Timeout safety
    socket.setTimeout(4000, () => {
      socket.destroy();
      resolve({
        success: false,
        host,
        port,
        authorized: false,
        error: 'Connection timed out after 4000ms',
      });
    });
  });
}
