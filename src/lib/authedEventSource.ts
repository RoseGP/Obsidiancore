/**
 * Server-sent events over fetch, so the request carries the user's credentials like every other
 * /api call (the browser's EventSource can't send an Authorization header). Same surface as
 * EventSource for what the app uses: addEventListener(name, handler) and close(). Reconnects with
 * backoff after a dropped connection; stops on 401/403 (signed out or no access).
 */
import { getApiAuthHeaders } from './apiAuth';

type Handler = (e: MessageEvent) => void;

export class AuthedEventSource {
  private handlers = new Map<string, Set<Handler>>();
  private controller: AbortController | null = null;
  private closed = false;
  private attempt = 0;

  constructor(private url: string) { void this.connect(); }

  addEventListener(name: string, fn: Handler) {
    if (!this.handlers.has(name)) this.handlers.set(name, new Set());
    this.handlers.get(name)!.add(fn);
  }

  removeEventListener(name: string, fn: Handler) { this.handlers.get(name)?.delete(fn); }

  close() { this.closed = true; this.controller?.abort(); }

  private emit(name: string, data: string) {
    const ev = new MessageEvent(name, { data });
    this.handlers.get(name)?.forEach((fn) => { try { fn(ev); } catch (err) { console.error('[stream] handler failed', err); } });
  }

  private async connect() {
    if (this.closed) return;
    this.controller = new AbortController();
    try {
      const res = await fetch(this.url, { headers: { Accept: 'text/event-stream', ...(await getApiAuthHeaders()) }, signal: this.controller.signal, cache: 'no-store' });
      if (res.status === 401 || res.status === 403) { this.emit('error', String(res.status)); return; }
      if (!res.ok || !res.body) throw new Error(`stream ${res.status}`);
      this.attempt = 0;
      this.emit('open', '');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.search(/\r?\n\r?\n/)) !== -1) {
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx).replace(/^\r?\n\r?\n/, '');
          let event = 'message';
          const data: string[] = [];
          for (const line of frame.split(/\r?\n/)) {
            if (line.startsWith('event:')) event = line.slice(6).trim();
            else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
          }
          if (data.length) this.emit(event, data.join('\n'));
        }
      }
    } catch (err: any) {
      if (this.closed || err?.name === 'AbortError') return;
    }
    if (this.closed) return;
    const delay = Math.min(30_000, 1000 * 2 ** this.attempt++) + Math.random() * 500;
    setTimeout(() => void this.connect(), delay);
  }
}
