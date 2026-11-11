/**
 * GREET guest invitations: signed, expiring links for one external guest and one meeting.
 *
 *   organizations/{orgId}/scheduled_meetings/{meetingId}/invites/{inviteId}
 *     { id, email, name, createdAt, createdBy, expiresAt, revoked, lastUsedAt }
 *
 * The link token is `<payload>.<hmac>` where payload = base64url({ v, o, m, i, exp }) and the HMAC uses
 * GREET_INVITE_SECRET (or JWT_SECRET). The token itself is never stored; a revoked or deleted invite record
 * makes the token useless even before it expires. Guests always wait for the host to admit them.
 */
import crypto from 'crypto';
import { assertId, getDocStore, newId } from '../data/docStore';
import { GreetError, lastEnd, scheduledPath } from './scheduled';

const DAY = 86_400_000;

function secret(): string | null {
  const s = (process.env.GREET_INVITE_SECRET || process.env.JWT_SECRET || '').trim();
  return s.length >= 16 ? s : null;
}
export const invitesConfigured = () => secret() !== null;

const b64 = (b: Buffer) => b.toString('base64url');
const sign = (payload: string, key: string) => b64(crypto.createHmac('sha256', key).update(`greet-invite:${payload}`).digest());

export interface InviteClaims { o: string; m: string; i: string; exp: number }

export function signInvite(c: InviteClaims): string {
  const key = secret();
  if (!key) throw new GreetError(503, 'invites_not_configured', 'Guest invitation links need GREET_INVITE_SECRET (or JWT_SECRET) on the server.');
  const payload = b64(Buffer.from(JSON.stringify({ v: 1, ...c })));
  return `${payload}.${sign(payload, key)}`;
}

/** Verifies signature and expiry, then that the invite record still exists and isn't revoked. */
export async function verifyInvite(token: unknown) {
  const key = secret();
  if (!key) throw new GreetError(503, 'invites_not_configured', 'Guest invitations aren\'t set up on this server.');
  const bad = () => new GreetError(404, 'invite_invalid', 'This invitation link isn\'t valid. Ask the host for a new one.');
  if (typeof token !== 'string' || token.length > 600 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) throw bad();
  const [payload, mac] = token.split('.');
  const expected = sign(payload, key);
  if (mac.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) throw bad();
  let c: InviteClaims & { v: number };
  try { c = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { throw bad(); }
  if (c?.v !== 1 || typeof c.exp !== 'number') throw bad();
  if (c.exp < Date.now()) throw new GreetError(410, 'invite_expired', 'This invitation has expired. Ask the host for a new link.');
  try { assertId(c.o); assertId(c.m); assertId(c.i); } catch { throw bad(); }
  const st = await getDocStore();
  const invite = await st.get(`${scheduledPath(c.o)}/${c.m}/invites/${c.i}`);
  if (!invite || invite.revoked) throw new GreetError(410, 'invite_revoked', 'This invitation was withdrawn by the host.');
  const meeting = await st.get(`${scheduledPath(c.o)}/${c.m}`);
  if (!meeting) throw bad();
  if (meeting.status === 'CANCELLED') throw new GreetError(410, 'meeting_cancelled', 'This meeting was cancelled.');
  return { claims: c, invite, meeting };
}

export async function createInvites(orgId: string, meeting: any, people: Array<{ email: string; name?: string }>, createdBy: string, appUrl: string) {
  const st = await getDocStore();
  const exp = Math.min(Date.now() + 90 * DAY, Math.max(Date.now() + DAY, lastEnd(meeting) + DAY));
  const out: Array<{ id: string; email: string; name: string; link: string; expiresAt: string }> = [];
  for (const p of people) {
    const id = newId('inv');
    const email = p.email.trim().toLowerCase();
    const name = (p.name || email.split('@')[0]).trim().slice(0, 120);
    const record = { id, email, name, createdAt: new Date().toISOString(), createdBy, expiresAt: new Date(exp).toISOString(), revoked: false, lastUsedAt: null };
    await st.set(`${scheduledPath(orgId)}/${meeting.id}/invites/${id}`, record);
    const token = signInvite({ o: orgId, m: meeting.id, i: id, exp });
    out.push({ id, email, name, link: `${appUrl}/?greet_invite=${encodeURIComponent(token)}`, expiresAt: record.expiresAt });
  }
  return out;
}

export async function listInvites(orgId: string, meetingId: string) {
  return (await getDocStore()).list(`${scheduledPath(orgId)}/${assertId(meetingId)}/invites`, { orderBy: 'createdAt', direction: 'desc', limit: 500 });
}

export async function revokeInvite(orgId: string, meetingId: string, inviteId: string) {
  const ok = await (await getDocStore()).update(`${scheduledPath(orgId)}/${assertId(meetingId)}/invites/${assertId(inviteId)}`, { revoked: true, revokedAt: new Date().toISOString() });
  if (!ok) throw new GreetError(404, 'invite_not_found', 'That invitation doesn\'t exist.');
}

export const hashGuestKey = (key: string) => crypto.createHash('sha256').update(`greet-guest:${key}`).digest('hex');
export const newGuestKey = () => crypto.randomBytes(24).toString('base64url');
