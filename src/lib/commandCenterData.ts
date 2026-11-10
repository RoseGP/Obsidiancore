/**
 * Data for the AI Command Center beyond deals/leads/tickets (lib/dashboardData): proposals, scheduled
 * meetings, inbox conversations, inbound WhatsApp/SMS and voicemails, service status and daily missions.
 * Each source loads on its own, so one failing (or not set up) doesn't blank the dashboard. Inbox changes
 * arrive live over the messaging stream.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { getDashboardJson, onDashboardInvalidated } from './dashboardData';
import { AuthedEventSource } from './authedEventSource';
import type { CcConversation, CcMeeting, CcProposal } from './commandCenter';

export interface InboundMessage { id: string; channel: 'WHATSAPP' | 'SMS' | string; from: string; body: string; at: string; contactName?: string }
export interface Voicemail { id: string; from: string; at: string; durationSeconds?: number; recordingUrl?: string; reviewedAt?: string | null }

export interface ServiceStatus {
  windowDays: number; slaTargetMinutes: number; slaMetRate: number | null; avgFirstResponseMinutes: number | null; measuredConversations: number;
  unansweredCount: number; missedCalls: { count: number | null; windowHours: number };
  channels: { id: string; label: string; status: 'connected' | 'not_configured' | 'not_available'; detail?: string }[];
  ai: { claude: { configured: boolean }; gemini: { configured: boolean } };
  overall: 'green' | 'yellow' | 'red';
}

export interface Mission { id: string; title: string; description: string; target: number; progress: number; done: boolean; xp: number; action?: { label: string; view: string } }
export interface MissionsState {
  date: string; missions: Mission[]; completedCount: number; totalCount: number; completionPct: number; xpToday: number; totalXp: number;
  streak: { current: number; best: number }; badges: { id: string; label: string; description: string; earned: boolean }[];
}

type Slot<T> = { data: T | null; error: string | null; loading: boolean };
const initial = <T,>(): Slot<T> => ({ data: null, error: null, loading: true });

function localDay() {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { date, dayStart: d.toISOString() };
}
const message = (err: any, what: string) => (err?.status === 404 ? `${what} isn’t available on this server yet.`
  : err?.status === 401 || err?.status === 403 ? `You don’t have access to ${what.toLowerCase()}.`
  : err?.status === 503 ? (err?.message || `${what} isn’t set up yet.`) : `${what} couldn’t load. Try again.`);

export function useCommandCenterData() {
  const [proposals, setProposals] = useState<Slot<CcProposal[]>>(initial);
  const [meetings, setMeetings] = useState<Slot<CcMeeting[]>>(initial);
  const [conversations, setConversations] = useState<Slot<CcConversation[]>>(initial);
  const [inbound, setInbound] = useState<Slot<{ messages: InboundMessage[]; voicemails: Voicemail[] }>>(initial);
  const [service, setService] = useState<Slot<ServiceStatus>>(initial);
  const [missions, setMissions] = useState<Slot<MissionsState>>(initial);
  const alive = useRef(true);

  const load = useCallback(<T,>(url: string, pick: (d: any) => T, set: (s: Slot<T>) => void, what: string, fresh: boolean) => {
    getDashboardJson(url, { fresh })
      .then((d) => { if (alive.current) set({ data: pick(d), error: null, loading: false }); })
      .catch((e) => { if (alive.current) set({ data: null, error: message(e, what), loading: false }); });
  }, []);

  const loadConversations = useCallback((fresh = false) => load('/api/messaging/conversations', (d) => d.conversations || [], setConversations, 'The inbox', fresh), [load]);
  const loadMissions = useCallback((fresh = false) => {
    const { date, dayStart } = localDay();
    load(`/api/dashboard/missions?date=${date}&dayStart=${encodeURIComponent(dayStart)}`, (d) => d as MissionsState, setMissions, 'Daily missions', fresh);
  }, [load]);

  const refreshAll = useCallback((fresh = false) => {
    load('/api/proposals', (d) => d.proposals || [], setProposals, 'Proposals', fresh);
    load('/api/meetings', (d) => d.meetings || [], setMeetings, 'Meetings', fresh);
    loadConversations(fresh);
    load('/api/communication/inbound-messages', (d) => ({ messages: d.messages || [], voicemails: d.voicemails || [] }), setInbound, 'WhatsApp, SMS and voicemail', fresh);
    load('/api/dashboard/service', (d) => d as ServiceStatus, setService, 'Service status', fresh);
    loadMissions(fresh);
  }, [load, loadConversations, loadMissions]);

  useEffect(() => {
    alive.current = true;
    refreshAll();
    const off = onDashboardInvalidated(() => refreshAll(true));
    // Live inbox updates (new messages, new or changed conversations).
    let timer: ReturnType<typeof setTimeout> | null = null;
    const bump = () => { if (timer) clearTimeout(timer); timer = setTimeout(() => { loadConversations(true); load('/api/dashboard/service', (d) => d as ServiceStatus, setService, 'Service status', true); }, 600); };
    const stream = new AuthedEventSource('/api/messaging/stream');
    ['new_message', 'conversation_created', 'conversation_updated', 'conversation_deleted'].forEach((ev) => stream.addEventListener(ev, bump));
    // Missions follow the day: refresh every 5 minutes so progress from other tabs and teammates shows up.
    const tick = setInterval(() => loadMissions(true), 5 * 60_000);
    return () => { alive.current = false; off(); stream.close(); clearInterval(tick); if (timer) clearTimeout(timer); };
  }, [refreshAll, loadConversations, loadMissions, load]);

  return { proposals, meetings, conversations, inbound, service, missions, refreshAll: () => refreshAll(true), refreshMissions: () => loadMissions(true), refreshConversations: () => loadConversations(true) };
}
