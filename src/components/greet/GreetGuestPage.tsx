/**
 * Public GREET page for external guests (/?greet_invite=<token>). No CRM account:
 *   1. shows what the invitation is for,
 *   2. the guest enters their name and joins the waiting room (POST /api/greet/invite/:token/join),
 *   3. once the host lets them in, gets a LiveKit token for that meeting's room only and connects.
 * The guest's browser key is kept in sessionStorage for this tab; the server stores only its hash.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Video, VideoOff, Mic, MicOff, PhoneOff, Clock, AlertTriangle, Circle, Users } from 'lucide-react';
import { MeetingMedia, type MediaStatus, type RemoteMedia } from '../../lib/meetingMedia';

interface InviteInfo { meeting: { title: string; startTime: string; duration: number; hostName: string; status: string; live: boolean }; invite: { name: string; email: string }; mediaConfigured: boolean }
interface GuestSession { title: string; status: 'active' | 'ended'; hostName: string; you: { participantId: string; name: string; status: string } | null; participantCount: number; recording: { active: boolean; requested: boolean; mode: string | null; yourConsent: string | null } }

const keyName = (token: string) => `greet_guest_key:${token.slice(-24)}`;

async function call<T>(path: string, init?: RequestInit, key?: string | null): Promise<T> {
  let res: Response;
  try { res = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', ...(key ? { 'X-Greet-Guest-Key': key } : {}) } }); }
  catch { throw Object.assign(new Error('Couldn\'t reach the meeting service. Check your connection.'), { code: 'network' }); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.success === false) throw Object.assign(new Error(data?.error || 'Something went wrong.'), { code: data?.code, status: res.status });
  return data as T;
}

function Tile({ name, track, muted, you }: { name: string; track: MediaStreamTrack | null; muted?: boolean; you?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => { if (ref.current) ref.current.srcObject = track ? new MediaStream([track]) : null; }, [track]);
  return (
    <div className="relative aspect-video overflow-hidden rounded-xl bg-neutral-800">
      {track ? <video ref={ref} autoPlay playsInline muted className={`h-full w-full object-cover ${you ? '-scale-x-100' : ''}`} />
        : <div className="flex h-full items-center justify-center text-2xl font-semibold text-neutral-300">{name.slice(0, 2).toUpperCase()}</div>}
      <span className="absolute bottom-2 left-2 flex items-center gap-1 rounded-md bg-black/60 px-2 py-0.5 text-xs text-white">{muted && <MicOff className="h-3 w-3" />}{name}{you ? ' (you)' : ''}</span>
    </div>
  );
}

export default function GreetGuestPage({ token }: { token: string }) {
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [key, setKey] = useState<string | null>(() => { try { return sessionStorage.getItem(keyName(token)); } catch { return null; } });
  const [session, setSession] = useState<GuestSession | null>(null);
  const [busy, setBusy] = useState(false);
  const [mediaStatus, setMediaStatus] = useState<MediaStatus>('idle');
  const [remote, setRemote] = useState<Record<string, RemoteMedia>>({});
  const [local, setLocal] = useState<MediaStream | null>(null);
  const [mic, setMic] = useState(true);
  const [cam, setCam] = useState(true);
  const [left, setLeft] = useState(false);
  const mediaRef = useRef<MeetingMedia | null>(null);

  useEffect(() => {
    call<InviteInfo>(`/api/greet/invite/${encodeURIComponent(token)}`).then((i) => { setInfo(i); setName((n) => n || i.invite.name); }).catch((e) => setError(e.message));
  }, [token]);

  const poll = useCallback(async () => {
    if (!key || left) return;
    try { const r = await call<{ session: GuestSession | null }>(`/api/greet/invite/${encodeURIComponent(token)}/session`, undefined, key); setSession(r.session); }
    catch (e) { if ((e as any).status === 401) { setKey(null); } }
  }, [key, token, left]);
  useEffect(() => { poll(); const t = window.setInterval(poll, 3000); return () => window.clearInterval(t); }, [poll]);

  // Admitted → connect audio/video for this meeting's room.
  const status = session?.you?.status;
  useEffect(() => {
    if (status !== 'in' || mediaRef.current || !key) return;
    let cancelled = false;
    (async () => {
      let stream: MediaStream | null = null;
      try { stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true }); } catch { stream = null; }
      if (cancelled) { stream?.getTracks().forEach((t) => t.stop()); return; }
      setLocal(stream);
      try {
        const t = await call<{ url: string; token: string }>(`/api/greet/invite/${encodeURIComponent(token)}/media-token`, { method: 'POST' }, key);
        const m = new MeetingMedia({ onRemote: setRemote, onStatus: (s) => setMediaStatus(s), onChat: () => {} });
        mediaRef.current = m;
        await m.connect(t.url, t.token, stream);
      } catch (e) { setError((e as Error).message); setMediaStatus((e as any).code === 'media_not_configured' ? 'not_configured' : 'failed'); }
    })();
    return () => { cancelled = true; };
  }, [status, key, token]);
  useEffect(() => () => { mediaRef.current?.disconnect(); local?.getTracks().forEach((t) => t.stop()); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (session?.status === 'ended' || status === 'removed' || status === 'denied') { mediaRef.current?.disconnect(); mediaRef.current = null; } }, [session?.status, status]);

  const join = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      const r = await call<{ guestKey: string; session: GuestSession }>(`/api/greet/invite/${encodeURIComponent(token)}/join`, { method: 'POST', body: JSON.stringify({ name: name.trim() }) });
      try { sessionStorage.setItem(keyName(token), r.guestKey); } catch { /* storage blocked: this tab still works */ }
      setKey(r.guestKey); setSession(r.session);
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  };
  const leave = async () => {
    mediaRef.current?.disconnect(); mediaRef.current = null; local?.getTracks().forEach((t) => t.stop()); setLocal(null); setLeft(true);
    if (key) call(`/api/greet/invite/${encodeURIComponent(token)}/leave`, { method: 'POST' }, key).catch(() => {});
  };
  const consent = async (agree: boolean) => {
    try { const r = await call<{ session: GuestSession }>(`/api/greet/invite/${encodeURIComponent(token)}/recording-consent`, { method: 'POST', body: JSON.stringify({ consent: agree }) }, key); setSession(r.session); }
    catch (e) { setError((e as Error).message); }
  };

  const shell = (children: React.ReactNode) => (
    <div className="obsidian min-h-screen bg-[var(--obsidian-0)] text-neutral-100 flex flex-col">
      <header className="flex items-center gap-2 px-4 sm:px-6 h-14 border-b border-white/10"><Video className="h-5 w-5 text-indigo-300" /><span className="font-semibold tracking-tight">GREET</span><span className="text-xs text-neutral-400">Video meeting</span></header>
      <main className="flex-1 w-full max-w-5xl mx-auto px-4 sm:px-6 py-6">{children}</main>
    </div>
  );
  const errorBox = error && <p role="alert" className="mt-4 flex items-start gap-2 rounded-lg bg-rose-950/60 border border-rose-500/30 px-3 py-2 text-sm text-rose-100"><AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />{error}</p>;

  if (!info) return shell(error ? errorBox : <p className="text-neutral-400">Loading your invitation…</p>);
  if (left) return shell(<div className="text-center py-16"><h1 className="text-xl font-semibold">You left the meeting</h1><p className="mt-2 text-neutral-400">You can close this tab.</p></div>);
  if (session?.status === 'ended') return shell(<div className="text-center py-16"><h1 className="text-xl font-semibold">The meeting has ended</h1><p className="mt-2 text-neutral-400">Thanks for joining.</p></div>);
  if (status === 'denied' || status === 'removed') return shell(<div className="text-center py-16"><h1 className="text-xl font-semibold">The host didn't let you in</h1><p className="mt-2 text-neutral-400">Contact them if you think this is a mistake.</p></div>);

  const when = new Date(info.meeting.startTime).toLocaleString([], { dateStyle: 'full', timeStyle: 'short' });

  if (!key || !session?.you) {
    return shell(
      <div className="max-w-md mx-auto">
        <h1 className="text-2xl font-semibold tracking-tight">{info.meeting.title}</h1>
        <p className="mt-2 flex items-center gap-1.5 text-sm text-neutral-300"><Clock className="h-4 w-4" />{when} · {info.meeting.duration} min</p>
        <p className="mt-1 text-sm text-neutral-400">Hosted by {info.meeting.hostName}</p>
        {!info.mediaConfigured && <p className="mt-4 text-sm text-amber-200">Video isn't connected on this server yet. You can still join the waiting room.</p>}
        <form onSubmit={join} className="mt-6 space-y-3">
          <label className="block text-sm text-neutral-300" htmlFor="guest-name">Your name</label>
          <input id="guest-name" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-lg border border-white/15 bg-neutral-900 px-3 py-2 text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400" />
          <button type="submit" disabled={busy || !name.trim()} className="w-full rounded-lg bg-indigo-600 hover:bg-indigo-500 px-4 py-2.5 font-semibold text-white disabled:opacity-50">{busy ? 'Joining…' : info.meeting.live ? 'Ask to join' : 'Ask to join (the host hasn\'t started yet)'}</button>
          <p className="text-xs text-neutral-500">The host lets you in. Your browser will ask to use your camera and microphone once you're admitted.</p>
        </form>
        {errorBox}
      </div>
    );
  }

  if (status === 'waiting') {
    return shell(<div className="text-center py-16"><h1 className="text-xl font-semibold">Waiting for the host to let you in…</h1><p className="mt-2 text-neutral-400">{info.meeting.title} · hosted by {info.meeting.hostName}</p>
      <button type="button" onClick={leave} className="mt-6 rounded-lg border border-white/15 px-4 py-2 text-sm hover:bg-white/5">Leave</button>{errorBox}</div>);
  }

  const tiles = Object.entries(remote);
  return shell(
    <div className="space-y-4">
      {session.recording.requested && !session.recording.yourConsent && (
        <div role="dialog" aria-modal="true" aria-label="Recording consent" className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="max-w-md rounded-2xl border border-white/10 bg-neutral-900 p-5">
            <h2 className="font-semibold">The host would like to record this meeting</h2>
            <p className="mt-2 text-sm text-neutral-300">Recording starts only if everyone agrees. You'll see a red "Recording" label while it runs.</p>
            <div className="mt-4 flex justify-end gap-2"><button type="button" onClick={() => consent(false)} className="rounded-lg border border-white/15 px-4 py-2 text-sm">Decline</button>
              <button type="button" onClick={() => consent(true)} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold">I agree to be recorded</button></div>
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <h1 className="font-semibold text-lg mr-auto">{session.title}</h1>
        {session.recording.active && <span className="flex items-center gap-1.5 rounded-full border border-rose-500/40 bg-rose-950/60 px-2.5 py-1 text-xs text-rose-100"><Circle className="h-2.5 w-2.5 fill-rose-500 text-rose-500" />Recording</span>}
        <span className="flex items-center gap-1 text-neutral-400"><Users className="h-4 w-4" />{session.participantCount}</span>
        <span className="text-xs text-neutral-400">{mediaStatus === 'connected' ? 'Connected' : mediaStatus === 'reconnecting' ? 'Reconnecting…' : mediaStatus === 'not_configured' ? 'Video not connected on this server' : mediaStatus === 'failed' ? 'Couldn\'t connect' : 'Connecting…'}</span>
      </div>
      <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        <Tile name={session.you?.name || name} track={cam ? local?.getVideoTracks()[0] ?? null : null} muted={!mic} you />
        {tiles.map(([id, r]) => <Tile key={id} name={r.name} track={r.screen || r.video} muted={r.micMuted} />)}
      </div>
      <div className="flex justify-center gap-3 pt-2">
        <button type="button" aria-label={mic ? 'Mute microphone' : 'Unmute microphone'} onClick={() => { const v = !mic; setMic(v); local?.getAudioTracks().forEach((t) => (t.enabled = v)); mediaRef.current?.setMicEnabled(v); }} className="rounded-full bg-neutral-800 p-3 hover:bg-neutral-700">{mic ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5 text-rose-300" />}</button>
        <button type="button" aria-label={cam ? 'Turn camera off' : 'Turn camera on'} onClick={() => { const v = !cam; setCam(v); local?.getVideoTracks().forEach((t) => (t.enabled = v)); mediaRef.current?.setCamEnabled(v); }} className="rounded-full bg-neutral-800 p-3 hover:bg-neutral-700">{cam ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5 text-rose-300" />}</button>
        <button type="button" aria-label="Leave meeting" onClick={leave} className="rounded-full bg-rose-600 p-3 hover:bg-rose-500"><PhoneOff className="h-5 w-5" /></button>
      </div>
      {errorBox}
    </div>
  );
}
