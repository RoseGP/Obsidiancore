/** Recent IVR call events (in memory, per instance) for the console. Numbers are masked. */
import { maskNumber } from './config';

export interface CallEvent { at: string; callSid: string; event: string; detail: string; from: string }
const MAX = 200;
const events: CallEvent[] = [];

export function recordEvent(callSid: string, event: string, detail: string, from?: string) {
  events.push({ at: new Date().toISOString(), callSid: callSid.slice(0, 8) + '…' + callSid.slice(-4), event, detail: detail.slice(0, 200), from: maskNumber(from) });
  if (events.length > MAX) events.splice(0, events.length - MAX);
}
export const recentEvents = () => [...events].reverse();
