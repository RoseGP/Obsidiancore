/**
 * Transactional email for the app itself (sign-in links). Credentials come only from the environment:
 *
 *   SMTP_HOST, SMTP_PORT (587), SMTP_SECURE (true for 465), SMTP_USER, SMTP_PASS, SMTP_FROM
 *   (AUTH_SMTP_* overrides any of these for auth mail only, e.g. a dedicated sender)
 *
 * Without SMTP the mailer reports "not configured" and sends nothing; there is no simulated success.
 * Development only: with NODE_ENV=development|test and MAIL_DEV_LOG=true, messages are written to the
 * server log instead (so sign-in links can be tested locally). This is ignored in production.
 */
import nodemailer, { type Transporter } from 'nodemailer';
import { isExplicitDevOrTest } from '../runtimeEnv';
import { logger } from '../http/logger';

export interface MailMessage { to: string; subject: string; text: string; html?: string }
export type MailResult = { ok: true; provider: string; reason?: undefined } | { ok: false; reason: 'not_configured' | 'failed' };

export interface Mailer {
  /** 'smtp', 'dev-log', or null when email can't be sent. */
  readonly mode: 'smtp' | 'dev-log' | null;
  send(msg: MailMessage): Promise<MailResult>;
}

const env = (k: string) => (process.env[`AUTH_SMTP_${k}`] ?? process.env[`SMTP_${k}`] ?? '').trim();

export function smtpConfigured() { return Boolean(env('HOST') && env('FROM')); }
export function devMailLogEnabled() { return isExplicitDevOrTest() && (process.env.MAIL_DEV_LOG || '').trim().toLowerCase() === 'true'; }

let transporter: Transporter | null = null;
function smtp(): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env('HOST'),
      port: Number(env('PORT') || 587),
      secure: env('SECURE') === 'true',
      auth: env('USER') ? { user: env('USER'), pass: env('PASS') } : undefined,
    });
  }
  return transporter;
}

let override: Mailer | null = null;
/** Tests: capture mail instead of sending (null restores the real mailer). */
export function setMailerForTests(m: Mailer | null) { override = m; }

export function getMailer(): Mailer {
  if (override) return override;
  if (smtpConfigured()) {
    return {
      mode: 'smtp',
      async send(msg) {
        try {
          const info = await smtp().sendMail({ from: env('FROM'), to: msg.to, subject: msg.subject, text: msg.text, html: msg.html });
          const accepted = (info.accepted ?? []).length > 0;
          return accepted ? { ok: true, provider: 'smtp' } : { ok: false, reason: 'failed' };
        } catch (e) {
          logger.error('mail.send_failed', { provider: 'smtp', error: (e as Error)?.message });
          return { ok: false, reason: 'failed' };
        }
      },
    };
  }
  if (devMailLogEnabled()) {
    return {
      mode: 'dev-log',
      async send(msg) {
        // Development only (never in production): print the message so links can be clicked locally.
        console.log(`\n[mail:dev-log] To: ${msg.to}\nSubject: ${msg.subject}\n\n${msg.text}\n`);
        return { ok: true, provider: 'dev-log' };
      },
    };
  }
  return { mode: null, async send() { return { ok: false, reason: 'not_configured' }; } };
}
