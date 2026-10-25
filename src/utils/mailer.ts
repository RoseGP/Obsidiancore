import nodemailer from 'nodemailer';
import { wsDispatcher } from './wsDispatcher';

// Interface defining the input schema for the outbound mailer service
export interface SendEmailOptions {
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
}

// SMTP configuration fetched from environment variables with safe development defaults
const MAIL_CONFIG = {
  host: process.env.SMTP_HOST || '',
  port: parseInt(process.env.SMTP_PORT || '587', 10),
  secure: process.env.SMTP_SECURE === 'true', // true for port 465, false for other ports
  auth: {
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
  },
  from: process.env.SMTP_FROM || 'no-reply@crm-omnichannel.com',
  fromName: process.env.SMTP_FROM_NAME || 'CRM Omnichannel Support',
};

let transporter: nodemailer.Transporter | null = null;

/**
 * Lazy initialization of the Nodemailer SMTP Transporter
 * If SMTP credentials are not specified, it falls back to a sandbox simulated logger.
 */
export function getMailerTransporter(): nodemailer.Transporter {
  if (transporter) return transporter;

  // Auto-detect Postal Server, SendGrid API Key, or AWS SES Credentials
  const postalServer = process.env.POSTAL_SERVER_URL || process.env.POSTAL_HOST;
  const postalApiKey = process.env.POSTAL_API_KEY;
  const sendgridKey = process.env.SENDGRID_API_KEY;
  const sesKeyId = process.env.AWS_SES_ACCESS_KEY_ID;
  const sesSecretKey = process.env.AWS_SES_SECRET_ACCESS_KEY;
  const sesRegion = process.env.AWS_SES_REGION || 'us-east-1';

  let host = MAIL_CONFIG.host;
  let port = MAIL_CONFIG.port;
  let secure = MAIL_CONFIG.secure;
  let user = MAIL_CONFIG.auth.user;
  let pass = MAIL_CONFIG.auth.pass;

  if (postalServer && postalApiKey) {
    console.log(`[Mailer Service] Auto-detected Postal Server (${postalServer}). Using Postal SMTP Driver.`);
    host = postalServer.replace(/^https?:\/\//, '').split('/')[0].split(':')[0];
    port = parseInt(process.env.POSTAL_PORT || '587', 10);
    secure = process.env.POSTAL_SECURE === 'true';
    user = process.env.POSTAL_USER || postalApiKey;
    pass = process.env.POSTAL_PASS || postalApiKey;
  } else if (sendgridKey) {
    console.log('[Mailer Service] Auto-detected SendGrid API Key. Using SendGrid SMTP Driver.');
    host = 'smtp.sendgrid.net';
    port = 587;
    secure = false;
    user = 'apikey';
    pass = sendgridKey;
  } else if (sesKeyId && sesSecretKey) {
    console.log(`[Mailer Service] Auto-detected AWS SES Credentials for region ${sesRegion}. Using AWS SES SMTP Driver.`);
    host = `email-smtp.${sesRegion}.amazonaws.com`;
    port = 587;
    secure = false;
    user = sesKeyId;
    pass = sesSecretKey;
  }

  const hasCredentials = host && user && pass;

  if (!hasCredentials) {
    console.warn(
      '[Mailer Service] Outbound SMTP credentials are not configured or incomplete in .env.\n' +
      'Operating in Simulated SMTP Mode. All sent emails will be logged beautifully to the server console.'
    );
    
    // Create a mock JSON transport for sandbox simulation
    transporter = nodemailer.createTransport({
      jsonTransport: true
    });
    return transporter;
  }

  try {
    console.log(`[Mailer Service] Initializing secure SMTP transport for host: ${host}:${port}...`);
    
    transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: {
        user,
        pass,
      },
      tls: {
        rejectUnauthorized: false, // Ensure maximum compatibility in diverse hosting environments
      },
    });

    return transporter;
  } catch (error: any) {
    console.error('[Mailer Service] Critical: Failed to initialize Nodemailer SMTP transporter:', error.message);
    // Fallback to jsonTransport to keep the app functional
    transporter = nodemailer.createTransport({
      jsonTransport: true
    });
    return transporter;
  }
}

/**
 * Sends an email using Nodemailer with support for HTML, text, and file attachments.
 * Integrates error handling, transaction logs, and real-time frontend notifications via WebSockets.
 * 
 * @param options SendEmailOptions configurations
 * @returns Promise<any> Nodemailer dispatch receipt
 */
export async function sendEmail(options: SendEmailOptions): Promise<any> {
  const { to, cc, bcc, subject, text, html, attachments } = options;

  if (!to || (Array.isArray(to) && to.length === 0)) {
    throw new Error('Cannot send email: Recipient (to) field is empty or missing.');
  }

  const activeTransporter = getMailerTransporter();
  const isSimulated = !MAIL_CONFIG.host || !MAIL_CONFIG.auth.user;

  const mailOptions: nodemailer.SendMailOptions = {
    from: `"${MAIL_CONFIG.fromName}" <${MAIL_CONFIG.from}>`,
    to: Array.isArray(to) ? to.join(', ') : to,
    cc: cc ? (Array.isArray(cc) ? cc.join(', ') : cc) : undefined,
    bcc: bcc ? (Array.isArray(bcc) ? bcc.join(', ') : bcc) : undefined,
    subject: subject || '(No Subject)',
    text: text || '',
    html: html || undefined,
    attachments: attachments?.map(att => ({
      filename: att.filename,
      content: att.content,
      path: att.path,
      contentType: att.contentType,
    })),
  };

  try {
    console.log(`[Mailer Service] Preparing to dispatch email to: ${mailOptions.to}`);
    if (attachments && attachments.length > 0) {
      console.log(`[Mailer Service] Attaching ${attachments.length} file(s) to outgoing email.`);
    }

    const info = await activeTransporter.sendMail(mailOptions);

    if (isSimulated) {
      console.log(
        '\n================== [SIMULATED SMTP EMAIL DISPATCH] ==================\n' +
        `FROM:    ${mailOptions.from}\n` +
        `TO:      ${mailOptions.to}\n` +
        `CC:      ${mailOptions.cc || 'None'}\n` +
        `BCC:     ${mailOptions.bcc || 'None'}\n` +
        `SUBJECT: ${mailOptions.subject}\n` +
        `TEXT:    ${mailOptions.text || '(Empty text)'}\n` +
        `HTML:    ${mailOptions.html ? '[HTML Content Included]' : 'None'}\n` +
        `ATTACHMENTS: ${attachments ? attachments.map(a => a.filename).join(', ') : 'None'}\n` +
        '=====================================================================\n'
      );
    } else {
      console.log(`[Mailer Service] Email successfully sent! Message ID: ${info.messageId}`);
    }

    // Broadcast a real-time event to update the active CRM dashboard / omnichannel inbox
    wsDispatcher.broadcast('SMTP_DISPATCHED', {
      to: mailOptions.to,
      cc: mailOptions.cc,
      bcc: mailOptions.bcc,
      subject: mailOptions.subject,
      timestamp: new Date().toISOString(),
      isSimulated,
      messageId: info.messageId || `sim-${Date.now()}`,
    });

    return {
      success: true,
      messageId: info.messageId || `sim-${Date.now()}`,
      isSimulated,
      envelope: info.envelope || mailOptions.to,
    };
  } catch (error: any) {
    console.error('[Mailer Service] Failed to send email via SMTP transporter:', error.message);
    throw error;
  }
}
