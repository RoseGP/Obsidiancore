/**
 * /api/greet: GREET pieces that aren't plain meeting sessions.
 *
 * Public (no sign-in; guard(PUBLIC.greet) lets only these through, each rate limited by IP):
 *   GET  /invite/:token                   what the invitation is for (title, time, host, whether it has started)
 *   POST /invite/:token/join   { name }   enter the waiting room of the running meeting → { guestKey }
 *   GET  /invite/:token/session           your status (waiting / in / denied) and the meeting state   [X-Greet-Guest-Key]
 *   POST /invite/:token/media-token       LiveKit token once the host has let you in                   [X-Greet-Guest-Key]
 *   POST /invite/:token/recording-consent { consent }                                                  [X-Greet-Guest-Key]
 *   POST /invite/:token/leave                                                                          [X-Greet-Guest-Key]
 *   POST /livekit-webhook                 LiveKit server events (signed with the LiveKit API secret): recording results
 *
 * Signed-in organization members:
 *   GET    /recordings          cloud recordings you may see (host of the meeting, or OWNER/ADMIN)
 *   GET    /recordings/:id      details + a 5-minute download link (logged)
 *   DELETE /recordings/:id      deletes the file from storage and marks the record deleted (logged)
 *   GET    /settings  PUT /settings   recording on/off and retention (PUT: OWNER/ADMIN)
 *   GET    /audit                     GREET audit entries (OWNER/ADMIN)
 */
import express, { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { WebhookReceiver } from 'livekit-server-sdk';
import { rateLimit } from '../features/social-accounts/server/http';
import { requirePermission, requireTenant, sendError, tenantOf } from '../server/tenancy/middleware';
import { assertId, getDocStore } from '../server/data/docStore';
import { GreetError } from '../server/greet/scheduled';
import { hashGuestKey, newGuestKey, verifyInvite } from '../server/greet/invites';
import { listAudit, recordAudit } from '../server/greet/audit';
import { presignS3 } from '../server/greet/s3presign';
import {
  MeetingError, answerRecordingConsent, greetSettings, guestJoin, guestLeave, guestMediaToken, guestParticipant, guestView, liveSessionForMeeting,
} from '../server/meetings/sessions';
import { cloudRecordingAvailable, egressConfig, mediaConfig } from '../server/meetings/media';

const router = Router();
const ipKey = (req: Request) => String(req.ip || req.socket?.remoteAddress || 'unknown');
const publicLimiter = rateLimit({ name: 'greet-invite', windowMs: 60_000, max: 60, key: ipKey });
const joinLimiter = rateLimit({ name: 'greet-invite-join', windowMs: 60_000, max: 10, key: ipKey });

function sendGreet(res: Response, err: unknown, tag: string) {
  if (err instanceof GreetError || err instanceof MeetingError) return res.status(err.status).json({ success: false, code: err.code, error: err.message });
  if (err instanceof z.ZodError) return res.status(400).json({ success: false, code: 'invalid_input', error: err.issues[0]?.message || 'Check the form and try again.' });
  return sendError(res, err, tag);
}

const guestKeyOf = (req: Request) => {
  const k = req.get('X-Greet-Guest-Key');
  if (!k || !/^[A-Za-z0-9_-]{20,64}$/.test(k)) throw new GreetError(401, 'guest_key_missing', 'Open the invitation link again to rejoin.');
  return hashGuestKey(k);
};

async function liveFor(token: string) {
  const v = await verifyInvite(token);
  const live = await liveSessionForMeeting(v.claims.o, v.meeting);
  return { ...v, live };
}

// ---------------------------------------------------------------------------
// Guests (public)
// ---------------------------------------------------------------------------

router.get('/invite/:token', publicLimiter, async (req, res) => {
  try {
    const { invite, meeting, live } = await liveFor(req.params.token);
    res.json({
      success: true,
      meeting: { title: meeting.title, startTime: meeting.startTime, endTime: meeting.endTime, duration: meeting.duration, hostName: meeting.hostName || 'Your host', status: meeting.status, live: !!live },
      invite: { name: invite.name, email: invite.email },
      mediaConfigured: !!mediaConfig(),
    });
  } catch (err) { sendGreet(res, err, 'greet.invite.get'); }
});

const joinSchema = z.object({ name: z.string().trim().min(1, 'Add your name.').max(80) });
router.post('/invite/:token/join', joinLimiter, async (req, res) => {
  try {
    const { name } = joinSchema.parse(req.body ?? {});
    const { claims, invite, live } = await liveFor(req.params.token);
    if (!live) return res.status(409).json({ success: false, code: 'meeting_not_started', error: 'The host hasn\'t started this meeting yet. Keep this page open and try again in a moment.' });
    const key = newGuestKey();
    const r = await guestJoin(claims.o, live.id, { inviteId: invite.id, email: invite.email, name, keyHash: hashGuestKey(key) });
    await (await getDocStore()).update(`organizations/${claims.o}/scheduled_meetings/${claims.m}/invites/${claims.i}`, { lastUsedAt: new Date().toISOString() });
    await recordAudit(claims.o, { actorId: `guest:${invite.id}`, action: 'greet.guest.joined_waiting_room', target: live.id });
    res.json({ success: true, guestKey: key, session: guestView(r.session, r.you) });
  } catch (err) { sendGreet(res, err, 'greet.invite.join'); }
});

router.get('/invite/:token/session', publicLimiter, async (req, res) => {
  try {
    const keyHash = guestKeyOf(req);
    const { claims, invite, live } = await liveFor(req.params.token);
    if (!live) return res.json({ success: true, session: null });
    const r = await guestParticipant(claims.o, live.id, keyHash, invite.id);
    res.json({ success: true, session: guestView(r.session, r.you) });
  } catch (err) { sendGreet(res, err, 'greet.invite.session'); }
});

router.post('/invite/:token/media-token', publicLimiter, async (req, res) => {
  try {
    const keyHash = guestKeyOf(req);
    const { claims, invite, live } = await liveFor(req.params.token);
    if (!live) return res.status(409).json({ success: false, code: 'meeting_ended', error: 'This meeting isn\'t running.' });
    const t = await guestMediaToken(claims.o, live.id, keyHash, invite.id);
    if (!t) return res.status(503).json({ success: false, code: 'media_not_configured', error: 'Audio and video aren\'t connected on this server yet.' });
    res.json({ success: true, ...t });
  } catch (err) { sendGreet(res, err, 'greet.invite.media'); }
});

router.post('/invite/:token/recording-consent', publicLimiter, async (req, res) => {
  try {
    const keyHash = guestKeyOf(req);
    const { claims, invite, live } = await liveFor(req.params.token);
    if (!live) return res.status(409).json({ success: false, code: 'meeting_ended', error: 'This meeting isn\'t running.' });
    const s = await answerRecordingConsent(claims.o, live.id, { guestKeyHash: keyHash }, req.body?.consent);
    await recordAudit(claims.o, { actorId: `guest:${invite.id}`, action: req.body?.consent ? 'greet.recording.consent_given' : 'greet.recording.consent_declined', target: live.id });
    const r = await guestParticipant(claims.o, s.id, keyHash, invite.id);
    res.json({ success: true, session: guestView(r.session, r.you) });
  } catch (err) { sendGreet(res, err, 'greet.invite.consent'); }
});

router.post('/invite/:token/leave', publicLimiter, async (req, res) => {
  try {
    const keyHash = guestKeyOf(req);
    const { claims, invite, live } = await liveFor(req.params.token);
    if (live) await guestLeave(claims.o, live.id, keyHash, invite.id);
    res.json({ success: true });
  } catch (err) { sendGreet(res, err, 'greet.invite.leave'); }
});

// ---------------------------------------------------------------------------
// LiveKit webhook (recording results). Verified with the LiveKit API key/secret.
// ---------------------------------------------------------------------------

const recordingPath = (orgId: string, id: string) => `organizations/${assertId(orgId)}/meeting_recordings/${assertId(id)}`;

router.post('/livekit-webhook', express.text({ type: ['application/webhook+json', 'application/json'], limit: '1mb' }), async (req: any, res) => {
  try {
    const cfg = mediaConfig();
    if (!cfg) return res.status(503).json({ success: false, code: 'media_not_configured', error: 'LiveKit isn\'t configured.' });
    const body = typeof req.body === 'string' ? req.body : (req.rawBody ?? '');
    let event: any;
    try { event = await new WebhookReceiver(cfg.apiKey, cfg.apiSecret).receive(body, req.get('Authorization') || undefined); }
    catch { return res.status(401).json({ success: false, code: 'invalid_signature', error: 'Invalid webhook signature.' }); }
    if ((event.event === 'egress_ended' || event.event === 'egress_updated') && event.egressInfo) {
      const info = event.egressInfo;
      const file = (info.fileResults && info.fileResults[0]) || null;
      const filename = String(file?.filename || '');
      // Our storage keys look like <prefix>/<orgId>/<sessionId>/<recordingId>.mp4
      const m = filename.match(/([A-Za-z0-9_-]+)\/(mtg_[A-Za-z0-9]+)\/(rec_[A-Za-z0-9]+)\.mp4$/);
      if (m) {
        const [, orgId, , recId] = m;
        const st = await getDocStore();
        const rec = await st.get(recordingPath(orgId, recId));
        if (rec && rec.egressId === info.egressId && rec.status !== 'deleted') {
          const ended = event.event === 'egress_ended';
          const failed = ended && (Number(info.status) === 4 || String(info.status).includes('FAILED') || !!info.error);
          await st.update(recordingPath(orgId, recId), {
            status: !ended ? rec.status : failed ? 'failed' : 'ready',
            ...(ended ? { finalizedAt: new Date().toISOString(), sizeBytes: Number(file?.size || 0), durationSeconds: Math.round(Number(file?.duration || 0) / 1e9), error: failed ? 'The recording service reported an error.' : null } : {}),
          });
        }
      }
    }
    res.json({ success: true });
  } catch (err) { sendError(res, err, 'greet.livekit.webhook'); }
});

// ---------------------------------------------------------------------------
// Recordings (signed-in members; host of the meeting or OWNER/ADMIN)
// ---------------------------------------------------------------------------

const isAdmin = (role: string) => role === 'OWNER' || role === 'ADMIN';
const canSee = (rec: any, t: { userId: string; role: string }) => isAdmin(t.role) || rec.hostUserId === t.userId || rec.startedBy === t.userId;
const recView = (r: any) => ({
  id: r.id, title: r.title, sessionId: r.sessionId, scheduledMeetingId: r.scheduledMeetingId ?? null, status: r.status, mode: r.mode,
  startedAt: r.startedAt, endedAt: r.endedAt, durationSeconds: r.durationSeconds ?? null, sizeBytes: r.sizeBytes ?? null,
  retentionDays: r.retentionDays, deleteAfter: r.deleteAfter, consents: r.consents || [], deletedAt: r.deletedAt ?? null,
});

router.get('/recordings', requireTenant, requirePermission('read'), async (req, res) => {
  try {
    const t = tenantOf(req);
    const rows = await (await getDocStore()).list(`organizations/${t.orgId}/meeting_recordings`, { orderBy: 'startedAt', direction: 'desc', limit: 200 });
    const settings = await greetSettings(t.orgId);
    res.json({
      success: true, recordings: rows.filter((r) => canSee(r, t) && r.status !== 'deleted').map(recView),
      cloud: { enabled: settings.recordingEnabled, configured: cloudRecordingAvailable(), retentionDays: settings.recordingRetentionDays },
    });
  } catch (err) { sendGreet(res, err, 'greet.recordings.list'); }
});

router.get('/recordings/:id', requireTenant, requirePermission('read'), async (req, res) => {
  try {
    const t = tenantOf(req);
    const rec = await (await getDocStore()).get(recordingPath(t.orgId, req.params.id));
    if (!rec || rec.status === 'deleted' || !canSee(rec, t)) return res.status(404).json({ success: false, code: 'not_found', error: 'Recording not found.' });
    const ec = egressConfig();
    const downloadUrl = rec.status === 'ready' && ec && rec.storageKey ? presignS3(ec, 'GET', rec.storageKey, 300) : null;
    await recordAudit(t.orgId, { actorId: t.userId, action: downloadUrl ? 'greet.recording.download_link' : 'greet.recording.viewed', target: rec.id });
    res.json({ success: true, recording: recView(rec), downloadUrl, downloadExpiresInSeconds: downloadUrl ? 300 : null });
  } catch (err) { sendGreet(res, err, 'greet.recordings.get'); }
});

/** Deletion workflow: removes the file from storage (when configured), then keeps a tombstone for the audit trail. */
export async function deleteRecording(orgId: string, rec: any, actorId: string, reason: 'user' | 'retention') {
  const ec = egressConfig();
  let fileDeleted = false;
  if (ec && rec.storageKey) {
    try {
      const r = await fetch(presignS3(ec, 'DELETE', rec.storageKey, 120), { method: 'DELETE' });
      fileDeleted = r.ok || r.status === 404;
    } catch { fileDeleted = false; }
  }
  await (await getDocStore()).update(recordingPath(orgId, rec.id), {
    status: fileDeleted || !rec.storageKey ? 'deleted' : 'deletion_pending', deletedAt: new Date().toISOString(), deletedBy: actorId, deleteReason: reason,
  });
  await recordAudit(orgId, { actorId, action: reason === 'retention' ? 'greet.recording.expired' : 'greet.recording.deleted', target: rec.id, meta: { fileDeleted } });
  return fileDeleted;
}

router.delete('/recordings/:id', requireTenant, requirePermission('write'), async (req, res) => {
  try {
    const t = tenantOf(req);
    const rec = await (await getDocStore()).get(recordingPath(t.orgId, req.params.id));
    if (!rec || rec.status === 'deleted' || !canSee(rec, t)) return res.status(404).json({ success: false, code: 'not_found', error: 'Recording not found.' });
    if (rec.status === 'recording') return res.status(409).json({ success: false, code: 'recording_active', error: 'Stop the recording before deleting it.' });
    const fileDeleted = await deleteRecording(t.orgId, rec, t.userId, 'user');
    res.json({ success: true, fileDeleted, message: fileDeleted ? 'Recording deleted.' : 'The recording is marked for deletion, but the file couldn\'t be removed from storage yet. It will be retried.' });
  } catch (err) { sendGreet(res, err, 'greet.recordings.delete'); }
});

/** Retention: deletes recordings past their deleteAfter date (and retries pending deletions). */
export async function sweepRecordingRetention(now = Date.now()) {
  const st = await getDocStore();
  let removed = 0;
  const orgs = await st.list('organizations', { limit: 1000 });
  for (const o of orgs) {
    if (!o?.id) continue;
    const rows = await st.list(`organizations/${o.id}/meeting_recordings`, { limit: 500 }).catch(() => [] as any[]);
    for (const r of rows) {
      const due = (r.status === 'ready' || r.status === 'failed' || r.status === 'processing') && r.deleteAfter && Date.parse(r.deleteAfter) <= now;
      if (due || r.status === 'deletion_pending') { await deleteRecording(o.id, r, 'system', 'retention'); removed++; }
    }
  }
  return removed;
}
let retentionTimer: NodeJS.Timeout | null = null;
export function startRecordingRetentionSweeper(intervalMs = 60 * 60_000) {
  if (retentionTimer) return;
  retentionTimer = setInterval(() => { sweepRecordingRetention().catch((e) => console.warn('[greet] retention sweep failed:', (e as Error)?.name || 'error')); }, intervalMs);
  retentionTimer.unref?.();
}

// ---------------------------------------------------------------------------
// Settings and audit
// ---------------------------------------------------------------------------

router.get('/settings', requireTenant, requirePermission('read'), async (req, res) => {
  try {
    const s = await greetSettings(tenantOf(req).orgId);
    res.json({ success: true, settings: s, media: { configured: !!mediaConfig() }, cloudRecording: { configured: cloudRecordingAvailable() } });
  } catch (err) { sendGreet(res, err, 'greet.settings.get'); }
});

const settingsSchema = z.object({ recordingEnabled: z.boolean().optional(), recordingRetentionDays: z.coerce.number().int().min(1).max(3650).optional() });
router.put('/settings', requireTenant, requirePermission('manage_org'), async (req, res) => {
  try {
    const t = tenantOf(req);
    const input = settingsSchema.parse(req.body ?? {});
    const cur = await greetSettings(t.orgId);
    const next = { ...cur, ...input, updatedAt: new Date().toISOString(), updatedBy: t.userId };
    await (await getDocStore()).set(`organizations/${t.orgId}/settings/greet`, next);
    await recordAudit(t.orgId, { actorId: t.userId, action: 'greet.settings.updated', meta: input });
    res.json({ success: true, settings: { recordingEnabled: next.recordingEnabled, recordingRetentionDays: next.recordingRetentionDays } });
  } catch (err) { sendGreet(res, err, 'greet.settings.put'); }
});

router.get('/audit', requireTenant, requirePermission('manage_org'), async (req, res) => {
  try {
    const rows = await listAudit(tenantOf(req).orgId, 300);
    res.json({ success: true, entries: rows.filter((r: any) => String(r.action || '').startsWith('greet.')) });
  } catch (err) { sendGreet(res, err, 'greet.audit'); }
});

export default router;
