/**
 * Service monitoring for the dashboard: first-response SLA, unanswered conversations and messages,
 * voicemails (missed calls), channel connection status and AI provider availability.
 * Only measured figures are returned; anything that can't be measured is null. No secrets or
 * environment values leave the server, only booleans and labels.
 */
import { getDocStore } from '../data/docStore';

export type ChannelStatus = 'connected' | 'not_configured' | 'not_available';
export interface ChannelInfo { id: string; label: string; status: ChannelStatus; detail: string }

const has = (env: NodeJS.ProcessEnv, ...keys: string[]) => keys.every((k) => !!env[k] && !String(env[k]).includes('placeholder'));

/** Channel statuses from server configuration (booleans only) and the organization's own setup. */
export function channelStatuses(env: NodeJS.ProcessEnv, org: { hasActiveWidget: boolean; hasPhoneRoute: boolean; hasWhatsappRoute: boolean }): ChannelInfo[] {
  const twilio = has(env, 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER');
  const whatsapp = has(env, 'WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID');
  const email = has(env, 'SMTP_HOST') || has(env, 'CLOUDFLARE_SMTP_RELAY_HOST');
  const viaRoute = (serverOk: boolean, route: boolean, what: string, routeLabel: string): Pick<ChannelInfo, 'status' | 'detail'> =>
    !serverOk ? { status: 'not_configured', detail: `${what} isn't set up on the server.` }
      : !route ? { status: 'not_configured', detail: `Connect your ${routeLabel} in Phone settings.` }
      : { status: 'connected', detail: 'Connected' };
  return [
    { id: 'website_chat', label: 'Website chat', ...(org.hasActiveWidget ? { status: 'connected' as const, detail: 'Chat widget is live' } : { status: 'not_configured' as const, detail: 'Create a chat widget in the Inbox.' }) },
    { id: 'whatsapp', label: 'WhatsApp', ...viaRoute(whatsapp, org.hasWhatsappRoute, 'WhatsApp Business API', 'WhatsApp number') },
    { id: 'sms', label: 'SMS', ...viaRoute(twilio, org.hasPhoneRoute, 'Twilio', 'phone number') },
    { id: 'voice', label: 'Voice calls', ...viaRoute(twilio, org.hasPhoneRoute, 'Twilio', 'phone number') },
    { id: 'email', label: 'Email', ...(email ? { status: 'connected' as const, detail: 'Outgoing mail server set' } : { status: 'not_configured' as const, detail: 'No mail server (SMTP) is set up.' }) },
    { id: 'telegram', label: 'Telegram', status: 'not_available', detail: 'Not supported yet' },
    { id: 'instagram', label: 'Instagram', status: 'not_available', detail: 'Not supported yet' },
  ];
}

/**
 * Overall status:
 *   red    no AI provider is configured, or the first-response SLA met rate is below 80%
 *   yellow SLA met rate below the 99% goal, or any unanswered conversation/message,
 *          or any voicemail from the last 24 hours not yet reviewed
 *   green  otherwise (including when nothing could be measured yet)
 * Channel configuration is reported per channel and does not change the overall colour.
 */
export function overallStatus(s: { aiConfigured: boolean; slaMetRate: number | null; unansweredCount: number; unreviewedMissedCalls: number }): 'green' | 'yellow' | 'red' {
  if (!s.aiConfigured || (s.slaMetRate !== null && s.slaMetRate < 80)) return 'red';
  if ((s.slaMetRate !== null && s.slaMetRate < 99) || s.unansweredCount > 0 || s.unreviewedMissedCalls > 0) return 'yellow';
  return 'green';
}

const digits = (v: unknown) => String(v ?? '').replace(/\D/g, '');

/** Inbound WhatsApp/SMS messages in the window with no later outbound message to the same number. */
export function unansweredInbound(inbound: any[], outbound: any[], sinceMs: number): number {
  const lastOut = new Map<string, number>();
  for (const o of outbound) {
    const k = digits(o.to), t = Date.parse(o.at);
    if (k && Number.isFinite(t)) lastOut.set(k, Math.max(lastOut.get(k) ?? 0, t));
  }
  const waiting = new Set<string>();
  for (const m of inbound) {
    const k = digits(m.from), t = Date.parse(m.at);
    if (!k || !Number.isFinite(t) || t < sinceMs) continue;
    if ((lastOut.get(k) ?? 0) < t) waiting.add(k);
  }
  return waiting.size; // one per contact waiting for a reply
}

export async function loadServiceStatus(orgId: string, env: NodeJS.ProcessEnv = process.env, now: number = Date.now()) {
  const windowDays = 7;
  const sinceMs = now - windowDays * 86_400_000;
  const slaTargetMinutes = Math.max(1, Math.round(Number(env.SLA_FIRST_RESPONSE_MINUTES) || 15));
  const st = await getDocStore();
  const base = `organizations/${orgId}`;
  const { inboxServiceStats } = await import('../../routes/messagingPlatform');
  const [inbox, routes, inbound, outbound, voicemails] = await Promise.all([
    inboxServiceStats(orgId, sinceMs, slaTargetMinutes, now),
    st.list(`${base}/inbound_routes`),
    st.list(`${base}/inbound_messages`, { orderBy: 'at', direction: 'desc', limit: 500 }),
    st.list(`${base}/outbound_messages`, { orderBy: 'at', direction: 'desc', limit: 500 }),
    st.list(`${base}/voicemails`, { orderBy: 'at', direction: 'desc', limit: 500 }),
  ]);
  const hasPhoneRoute = routes.some((r) => r.kind === 'phone');
  const hasWhatsappRoute = routes.some((r) => r.kind === 'whatsapp');
  const recentVm = voicemails.filter((v) => Date.parse(v.at) >= now - 24 * 3_600_000);
  const missedCalls = { count: hasPhoneRoute ? recentVm.length : null, windowHours: 24, unreviewed: hasPhoneRoute ? recentVm.filter((v) => !v.reviewedAt).length : null };
  const slaMetRate = inbox.measured ? Math.round((inbox.met / inbox.measured) * 1000) / 10 : null;
  const unansweredCount = inbox.unanswered + unansweredInbound(inbound, outbound, sinceMs);
  const { providerStatus } = await import('../../services/ai/aiService');
  const ps = providerStatus();
  const ai = { claude: { configured: ps.claude.configured }, gemini: { configured: ps.gemini.configured } };
  return {
    success: true as const,
    windowDays, slaTargetMinutes, slaMetRate,
    avgFirstResponseMinutes: inbox.avgFirstResponseMinutes === null ? null : Math.round(inbox.avgFirstResponseMinutes * 10) / 10,
    measuredConversations: inbox.measured,
    unansweredCount,
    missedCalls,
    channels: channelStatuses(env, { hasActiveWidget: inbox.hasActiveWidget, hasPhoneRoute, hasWhatsappRoute }),
    ai,
    overall: overallStatus({ aiConfigured: ai.claude.configured || ai.gemini.configured, slaMetRate, unansweredCount, unreviewedMissedCalls: missedCalls.unreviewed ?? 0 }),
  };
}
