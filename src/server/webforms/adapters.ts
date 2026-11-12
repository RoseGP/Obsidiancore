/**
 * CRM adapters for website form submissions (provider-neutral).
 *
 *   interface CrmAdapter { id; label; deliver(payload, ctx) → DeliveryResult }
 *
 * Two adapters ship:
 *   - "obsidian": this app's own CRM (creates or updates a lead, follow-up task, lead intelligence).
 *   - "webhook":  a signed JSON POST to any URL you configure (Zapier/Make/n8n catch hooks, HubSpot/Salesforce
 *                 middleware, your own endpoint). Payload and signature are documented in docs/local-seo/WEB_FORMS.md.
 * To add a specific CRM later, implement CrmAdapter (e.g. map WebFormPayload to that CRM's "create contact"
 * call, with its API key from the environment) and register it in ADAPTERS.
 */
import crypto from 'node:crypto';
import { upsertWebsiteLead } from '../crm/websiteLeads';
import { OutboundError, safePostJson } from './safeHttp';

export const PAYLOAD_VERSION = 1;

/** What every adapter receives (and what the webhook sends, as JSON). */
export interface WebFormPayload {
  event: 'form.submission';
  version: typeof PAYLOAD_VERSION;
  id: string;
  submittedAt: string;
  isTest: boolean;
  form: { name: string };
  contact: { name: string; email: string; phone: string | null; company: string | null };
  message: string | null;
  consent: { contactAboutRequest: boolean | null; marketing: boolean | null };
  source: { pageUrl: string | null; utm: { source: string | null; medium: string | null; campaign: string | null } };
}

export type DeliveryResult =
  | { ok: true; detail?: string; externalId?: string; httpStatus?: number; retryable?: undefined; error?: undefined }
  | { ok: false; retryable: boolean; error: string; httpStatus?: number };

export interface DeliveryContext { orgId: string; webhook?: { url: string; secret: string; allowPrivate?: boolean } }

export interface CrmAdapter {
  id: 'obsidian' | 'webhook';
  label: string;
  deliver(p: WebFormPayload, ctx: DeliveryContext): Promise<DeliveryResult>;
}

export const obsidianAdapter: CrmAdapter = {
  id: 'obsidian',
  label: 'Obsidian CRM (built in)',
  async deliver(p, ctx) {
    if (p.isTest) return { ok: true, detail: 'Test: nothing stored.' };
    try {
      const r = await upsertWebsiteLead(ctx.orgId, {
        name: p.contact.name, email: p.contact.email, phone: p.contact.phone || '', company: p.contact.company || '',
        message: p.message || '', sourceUrl: p.source.pageUrl || '', utmSource: p.source.utm.source || '', utmCampaign: p.source.utm.campaign || '',
        formLabel: `Website form${p.form.name ? `: ${p.form.name}` : ''}`,
      });
      return { ok: true, externalId: r.leadId, detail: r.isExisting ? 'Added to an existing lead.' : 'New lead created.' };
    } catch {
      return { ok: false, retryable: true, error: 'The CRM couldn\'t save this submission.' };
    }
  },
};

/** Signature: X-Obsidian-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, `${t}.${body}`)> */
export function signBody(secret: string, body: string, t = Math.floor(Date.now() / 1000)) {
  return `t=${t},v1=${crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;
}

/** For receivers (and tests): constant-time check with a 5-minute tolerance. */
export function verifySignature(secret: string, body: string, header: string, now = Math.floor(Date.now() / 1000), toleranceSec = 300): boolean {
  const m = /^t=(\d+),v1=([a-f0-9]{64})$/.exec(header || '');
  if (!m || Math.abs(now - Number(m[1])) > toleranceSec) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${m[1]}.${body}`).digest();
  const got = Buffer.from(m[2], 'hex');
  return got.length === expected.length && crypto.timingSafeEqual(got, expected);
}

export const webhookAdapter: CrmAdapter = {
  id: 'webhook',
  label: 'Webhook (any CRM or automation tool)',
  async deliver(p, ctx) {
    if (!ctx.webhook) return { ok: false, retryable: false, error: 'No webhook is configured.' };
    const body = JSON.stringify(p);
    try {
      const r = await safePostJson(ctx.webhook.url, body, {
        'Content-Type': 'application/json',
        'User-Agent': 'ObsidianCRM-Webhooks/1.0',
        'X-Obsidian-Event': p.event,
        'X-Obsidian-Delivery': p.id,
        'X-Obsidian-Signature': signBody(ctx.webhook.secret, body),
      }, { allowPrivate: ctx.webhook.allowPrivate });
      if (r.status >= 200 && r.status < 300) return { ok: true, httpStatus: r.status, detail: `Accepted (${r.status}) in ${r.ms} ms.` };
      const retryable = r.status >= 500 || r.status === 408 || r.status === 429;
      return { ok: false, retryable, httpStatus: r.status, error: `The webhook answered ${r.status}.` };
    } catch (e) {
      const code = e instanceof OutboundError ? e.code : 'network';
      return { ok: false, retryable: code === 'timeout' || code === 'network' || code === 'dns_failed', error: e instanceof OutboundError ? e.message : 'The webhook couldn\'t be reached.' };
    }
  },
};

export const ADAPTERS: Record<CrmAdapter['id'], CrmAdapter> = { obsidian: obsidianAdapter, webhook: webhookAdapter };
