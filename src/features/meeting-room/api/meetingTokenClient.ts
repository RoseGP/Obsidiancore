/**
 * The meeting room's only path to LiveKit credentials: the app's own server (src/routes/meetings.ts).
 *
 *   POST /api/meetings/rooms/:roomCode/join         joins the meeting's roster (capacity, lock and waiting room
 *                                                   apply); answers { you: { participantId, status } }
 *   POST /api/meetings/rooms/:roomCode/media-token  a LiveKit access token, issued only to people the roster has
 *                                                   let in, for that meeting's room only, until its plan time limit
 *   POST /api/meetings/rooms/:roomCode/leave        marks you as left on the roster
 *
 * The server chooses the LiveKit room name (the meeting id) and identity (your roster participant id); the
 * browser never sends either, and the LiveKit API secret never leaves the server. Tokens are kept in memory
 * only and never logged.
 */

export type JoinResult =
  | { kind: 'token'; url: string; token: string; expiresAt: number; participantId: string }
  | { kind: 'waiting'; participantId: string };

export class MeetingApiError extends Error {
  constructor(message: string, public status: number, public code: string) { super(message); this.name = 'MeetingApiError'; }
}

export interface MeetingTokenClient {
  join(roomCode: string, signal?: AbortSignal): Promise<JoinResult>;
  leave(roomCode: string): Promise<void>;
}

/** Same rule as the server (src/server/meetings/sessions.ts ROOM_RE). */
const ROOM_RE = /^[a-z0-9][a-z0-9-]{2,62}$/;

/** A meeting code from what someone typed or pasted: "abc-defg-hij", "/?view=greet&meet=abc-defg-hij" or a full link. */
export function normalizeRoomCode(input: string): string | null {
  const raw = String(input || '').trim();
  if (!raw) return null;
  let candidate = raw;
  try {
    const url = new URL(raw, 'http://local.invalid');
    const fromQuery = url.searchParams.get('meet') || url.searchParams.get('room');
    if (fromQuery) candidate = fromQuery;
    else if (/^https?:\/\//i.test(raw) || raw.startsWith('/')) candidate = url.pathname.split('/').filter(Boolean).pop() || '';
  } catch { /* not a URL: use as typed */ }
  const code = decodeURIComponent(candidate).trim().toLowerCase();
  return ROOM_RE.test(code) ? code : null;
}

const FALLBACK: Record<number, string> = {
  0: 'Couldn\'t reach the server. Check your connection and try again.',
  401: 'Your session has expired. Sign in again to join.',
  403: 'You\'re not allowed to join this meeting.',
  404: 'No meeting is running with that code.',
  409: 'This meeting can\'t be joined right now.',
  423: 'The host has locked this meeting.',
  429: 'Too many attempts. Wait a moment and try again.',
  503: 'Audio and video aren\'t connected on this server yet (LiveKit isn\'t configured).',
};

export function createMeetingTokenClient(fetchImpl: typeof fetch = (input, init) => fetch(input, init), base = '/api/meetings'): MeetingTokenClient {
  async function post<T>(path: string, signal?: AbortSignal): Promise<T> {
    let res: Response;
    try {
      res = await fetchImpl(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal, credentials: 'same-origin' });
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') throw e;
      throw new MeetingApiError(FALLBACK[0], 0, 'network');
    }
    const data = await res.json().catch(() => null) as (T & { success?: boolean; error?: string; code?: string }) | null;
    if (!res.ok || !data || data.success === false) {
      const status = res.status || 0;
      throw new MeetingApiError(data?.error || FALLBACK[status] || 'Something went wrong. Try again.', status, data?.code || (status === 503 ? 'media_not_configured' : 'request_failed'));
    }
    return data;
  }

  return {
    async join(roomCode, signal) {
      const code = normalizeRoomCode(roomCode);
      if (!code) throw new MeetingApiError('That meeting code isn\'t valid. Codes look like abc-defg-hij.', 400, 'invalid_input');
      const joined = await post<{ you?: { participantId?: string; status?: string } }>(`/rooms/${encodeURIComponent(code)}/join`, signal);
      const participantId = String(joined.you?.participantId || '');
      if (joined.you?.status === 'waiting') return { kind: 'waiting', participantId };
      if (joined.you?.status !== 'in') throw new MeetingApiError('You couldn\'t be added to this meeting.', 409, 'not_admitted');
      const t = await post<{ url?: string; token?: string; expiresAt?: number }>(`/rooms/${encodeURIComponent(code)}/media-token`, signal);
      if (!t.url || !t.token) throw new MeetingApiError(FALLBACK[503], 503, 'media_not_configured');
      return { kind: 'token', url: t.url, token: t.token, expiresAt: Number(t.expiresAt) || 0, participantId };
    },
    async leave(roomCode) {
      const code = normalizeRoomCode(roomCode);
      if (!code) return;
      try { await post(`/rooms/${encodeURIComponent(code)}/leave`); } catch { /* best effort: leaving the media room already happened; the roster update can fail offline */ }
    },
  };
}
