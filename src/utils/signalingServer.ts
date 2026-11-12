/**
 * Real-time Socket.IO server: presence, schedule updates, WebRTC signaling and CRM sync on one connection.
 *
 * Security model (every event is scoped to ONE organization):
 *   - Handshake: the same identity check as HTTP (`identify`: Firebase ID token, signed session JWT, or the
 *     dev identity only in explicit dev/test). The organization comes from the server-side membership
 *     (`resolveTenant`; `auth.orgId` is honoured only for members) and the org's security policy applies
 *     (`tenantAccessViolation`: two-step, session age). Guests can't connect.
 *   - Broadcasts go to `org:<orgId>` only; meeting rooms are `org:<orgId>:room:<roomId>`; direct messages to a
 *     socket id are delivered only when that socket belongs to the same organization.
 *   - Identity fields (userId, name, author, updatedBy, bookedBy, sender) always come from the verified user,
 *     never from the payload.
 *   - CRM sync writes need the role-matrix permission for the record type (`canAccess`), and patches are
 *     validated (plain object, size and key limits, no prototype keys).
 *   - Message text and SDP bodies are never logged.
 * Event names and payload shapes are unchanged for same-organization clients.
 */
import { Server as SocketIOServer, Socket } from 'socket.io';
import { Server as HttpServer } from 'http';
import { identify } from '../features/social-accounts/server/auth';
import { resolveTenant, tenantAccessViolation } from '../server/tenancy/middleware';
import { canAccess, type Module } from '../server/security/permissions';

interface UserConnection { socketId: string; userId: string; roomId: string; orgId: string }

export interface UserPresence {
  userId: string;
  name: string;
  status: 'online' | 'busy' | 'offline';
  lastActive: string;
  currentMeetingId?: string;
}

interface SocketUser { id: string; name: string; email: string; role: string; orgId: string }
interface CrmEntry { version: number; lastModified: number; data: Record<string, unknown>; updatedBy: string }

const socketToUserMap = new Map<string, UserConnection>();
const roomToSocketsMap = new Map<string, Set<string>>();
/** orgId → (userId → presence) */
const presenceByOrg = new Map<string, Map<string, UserPresence>>();
/** orgId → ("type:id" → entry) */
const crmStateByOrg = new Map<string, Map<string, CrmEntry>>();

const MAX_CRM_ENTRIES_PER_ORG = 5000;
const MAX_PATCH_KEYS = 50;
const MAX_PATCH_BYTES = 32 * 1024;
const MAX_SIGNAL_BYTES = 64 * 1024;
const MAX_BATCH = 100;

export const ENTITY_MODULE: Record<string, Module> = { contact: 'contacts', lead: 'leads', deal: 'deals', event: 'calendar', task: 'tasks' };

const orgRoom = (orgId: string) => `org:${orgId}`;
const meetingRoom = (orgId: string, roomId: string) => `org:${orgId}:room:${roomId}`;
const ID_RE = /^[A-Za-z0-9_.:-]{1,128}$/;
const isId = (v: unknown): v is string => typeof v === 'string' && ID_RE.test(v);
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '');
const jsonSize = (v: unknown) => { try { return Buffer.byteLength(JSON.stringify(v ?? null)); } catch { return Infinity; } };
const isPlainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** A CRM patch: a plain object with at most 50 own keys, ≤ 32 KB, no prototype keys at any depth. */
export function validPatch(p: unknown): p is Record<string, unknown> {
  if (!isPlainObject(p)) return false;
  const keys = Object.keys(p);
  if (keys.length === 0 || keys.length > MAX_PATCH_KEYS || jsonSize(p) > MAX_PATCH_BYTES) return false;
  const walk = (v: unknown, depth: number): boolean => {
    if (depth > 6) return false;
    if (Array.isArray(v)) return v.every((x) => walk(x, depth + 1));
    if (v && typeof v === 'object') return Object.keys(v).every((k) => !FORBIDDEN_KEYS.has(k) && walk((v as any)[k], depth + 1));
    return true;
  };
  return walk(p, 0);
}

let ioInstance: SocketIOServer | null = null;

/** Returns the active Socket.io server instance. */
export function getSocketIO(): SocketIOServer | null {
  return ioInstance;
}

/** Resolves who is connecting and in which organization (same rules as HTTP requests). */
async function authenticateHandshake(socket: Socket): Promise<SocketUser | null> {
  const authObj: any = socket.handshake.auth || {};
  const header = socket.handshake.headers?.authorization;
  const token = authObj.token ? String(authObj.token) : typeof header === 'string' && header.startsWith('Bearer ') ? header.substring(7) : '';
  const fakeReq: any = {
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(typeof authObj.devUserId === 'string' ? { 'x-dev-user-id': authObj.devUserId } : {}),
      ...(typeof authObj.orgId === 'string' && authObj.orgId ? { 'x-org-id': authObj.orgId } : {}),
    },
  };
  const who = await identify(fakeReq);
  if (!who) return null;
  fakeReq.accountUser = who;
  const tenant = await resolveTenant(fakeReq);
  if (await tenantAccessViolation(fakeReq, tenant)) return null;
  const displayName = String(tenant.name || who.name || authObj.userName || 'CRM User').replace(/[^\p{L}\p{N} .'@-]/gu, '').slice(0, 60) || 'CRM User';
  return { id: who.id, name: displayName, email: tenant.email || '', role: tenant.role, orgId: tenant.orgId };
}

/**
 * Initializes the Socket.io multiplexed real-time server handler.
 * Handles WebRTC Signaling, Calendar & Schedule Updates, and User Presence over a single connection.
 */
export function initializeSignalingServer(server: HttpServer): SocketIOServer {
  console.log('[Signaling Server] Initializing real-time server (organization-scoped).');

  const io = new SocketIOServer(server, {
    // Credentials travel in the handshake `auth` payload (not cookies), so cross-origin pages can't ride a session.
    cors: { origin: '*', methods: ['GET', 'POST'] },
    transports: ['websocket', 'polling'],
    maxHttpBufferSize: 256 * 1024,
  });

  ioInstance = io;

  io.use((socket: Socket, next) => {
    authenticateHandshake(socket)
      .then((u) => { if (!u) return next(new Error('unauthorized')); socket.data.user = u; next(); })
      .catch(() => next(new Error('unauthorized')));
  });

  io.on('connection', (socket: Socket) => {
    const user = socket.data.user as SocketUser;
    const orgId = user.orgId;
    const ORG = orgRoom(orgId);
    socket.join(ORG);

    const presenceMap = presenceByOrg.get(orgId) ?? new Map<string, UserPresence>();
    presenceByOrg.set(orgId, presenceMap);
    const crmStateStore = crmStateByOrg.get(orgId) ?? new Map<string, CrmEntry>();
    crmStateByOrg.set(orgId, crmStateStore);

    /** A socket id the client named, only if it belongs to the same organization. */
    const sameOrgSocket = (id: unknown): string | null => {
      if (typeof id !== 'string' || !id) return null;
      const s = io.sockets.sockets.get(id);
      return s && (s.data.user as SocketUser | undefined)?.orgId === orgId ? id : null;
    };
    /** The caller's current meeting room (namespaced), or one they name that they have joined. */
    const myRoom = (requested?: unknown): string | null => {
      const conn = socketToUserMap.get(socket.id);
      if (!conn) return null;
      if (requested !== undefined && requested !== conn.roomId) return null;
      return meetingRoom(orgId, conn.roomId);
    };
    const setPresence = (status: UserPresence['status'], currentMeetingId?: unknown) => {
      const presence: UserPresence = {
        userId: user.id, name: user.name, status, lastActive: new Date().toISOString(),
        ...(status === 'busy' && isId(currentMeetingId) ? { currentMeetingId } : {}),
      };
      presenceMap.set(user.id, presence);
      io.to(ORG).emit(status === 'busy' ? 'user:busy' : 'user:online', presence);
      io.to(ORG).emit('presence:sync', Array.from(presenceMap.values()));
    };

    console.log(`[Unified Socket] connected ${socket.id} (user ${user.id}, org ${orgId})`);
    setPresence('online');
    socket.emit('presence:sync', Array.from(presenceMap.values()));

    // ---------------------------------------------------------------- presence (verified user only)
    socket.on('user:online', () => setPresence('online'));
    socket.on('user:busy', (data: { currentMeetingId?: string } = {}) => setPresence('busy', data?.currentMeetingId));

    // ---------------------------------------------------------------- calendar / schedule (organization only)
    socket.on('schedule:updated', (data: { meetingId?: string; event?: unknown; changes?: unknown } = {}) => {
      if (!isId(data?.meetingId)) return;
      const event = isPlainObject(data.event) && jsonSize(data.event) <= 8192 ? data.event : undefined;
      const changes = isPlainObject(data.changes) && jsonSize(data.changes) <= 8192 ? data.changes : undefined;
      io.to(ORG).emit('schedule:updated', { meetingId: data.meetingId, event, changes, updatedBy: user.name, timestamp: new Date().toISOString() });
    });

    socket.on('slot:booked', (data: { slotId?: string; date?: string; time?: string } = {}) => {
      if (!isId(data?.slotId)) return;
      const date = text(data.date, 32), time = text(data.time, 32);
      io.to(ORG).emit('slot:booked', { slotId: data.slotId, date, time, bookedBy: user.name, timestamp: new Date().toISOString() });
    });

    // ---------------------------------------------------------------- WebRTC signaling (same org, same room)
    const relay = (events: string[], data: any, body: Record<string, unknown>, opts: { allowRoom: boolean }) => {
      if (jsonSize(body) > MAX_SIGNAL_BYTES) return;
      const conn = socketToUserMap.get(socket.id);
      const payload = { senderSocketId: socket.id, senderUserId: user.id, ...body, ...(conn ? { roomId: conn.roomId } : {}), timestamp: new Date().toISOString() };
      const target = data?.targetSocketId !== undefined ? sameOrgSocket(data.targetSocketId) : null;
      if (data?.targetSocketId !== undefined) { if (target) for (const e of events) socket.to(target).emit(e, payload); return; }
      const room = opts.allowRoom ? myRoom(data?.roomId) : null;
      if (room) for (const e of events) socket.to(room).emit(e, payload);
      // No target and no joined room: nothing is broadcast (it used to go to every connected client).
    };

    socket.on('rtc:offer', (d: any = {}) => { if (d?.offer) relay(['rtc:offer', 'offer'], d, { offer: d.offer }, { allowRoom: true }); });
    socket.on('rtc:answer', (d: any = {}) => { if (d?.answer) relay(['rtc:answer', 'answer'], d, { answer: d.answer }, { allowRoom: true }); });
    socket.on('rtc:ice-candidate', (d: any = {}) => { if (d?.candidate) relay(['rtc:ice-candidate', 'ice-candidate'], d, { candidate: d.candidate }, { allowRoom: true }); });

    // Direct peer-to-peer relays used by older components (target socket required).
    const direct = (events: string[], field: 'offer' | 'answer' | 'candidate') => (d: any = {}) => {
      if (!d?.[field] || d?.targetSocketId === undefined) return;
      relay(events, d, { [field]: d[field] }, { allowRoom: false });
    };
    socket.on('offer', direct(['offer', 'sdp-offer'], 'offer'));
    socket.on('sdp-offer', direct(['offer', 'sdp-offer'], 'offer'));
    socket.on('answer', direct(['answer', 'sdp-answer'], 'answer'));
    socket.on('sdp-answer', direct(['answer', 'sdp-answer'], 'answer'));
    socket.on('ice-candidate', direct(['ice-candidate'], 'candidate'));

    socket.on('track-replaced', (d: any = {}) => {
      const kind = (v: unknown, allowed: string[], dflt: string) => (typeof v === 'string' && allowed.includes(v) ? v : dflt);
      relay(['track-replaced'], d, {
        trackType: kind(d?.trackType, ['video', 'audio', 'screen'], 'video'),
        streamType: kind(d?.streamType, ['camera', 'screen'], 'screen'),
        label: text(d?.label, 80) || 'Screen Share Stream',
        offer: d?.offer ?? null,
      }, { allowRoom: true });
    });
    socket.on('renegotiate', (d: any = {}) => relay(['renegotiate'], d, { offer: d?.offer }, { allowRoom: true }));

    socket.on('join-room', (data: { roomId?: string } = {}) => {
      // The member is always the verified socket user; a userId sent by the client is ignored.
      if (!isId(data?.roomId)) { socket.emit('error', { message: 'A valid room id is required.' }); return; }
      leaveCurrentRoom();
      const roomId = data.roomId;
      const key = meetingRoom(orgId, roomId);
      socket.join(key);
      socketToUserMap.set(socket.id, { socketId: socket.id, userId: user.id, roomId, orgId });
      if (!roomToSocketsMap.has(key)) roomToSocketsMap.set(key, new Set());
      roomToSocketsMap.get(key)!.add(socket.id);
      const peers = Array.from(roomToSocketsMap.get(key) || []).filter((id) => id !== socket.id).map((id) => ({ socketId: id, userId: socketToUserMap.get(id)?.userId }));
      socket.to(key).emit('user-connected', { userId: user.id, socketId: socket.id });
      socket.emit('room-roster', { roomId, peers });
    });

    socket.on('chat-message', (data: { text?: string } = {}) => {
      const conn = socketToUserMap.get(socket.id);
      const body = text(data?.text, 4000);
      if (!conn || !body) return;
      socket.to(meetingRoom(orgId, conn.roomId)).emit('chat-message', {
        sender: user.name, text: body, timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      });
    });

    const toggle = (event: 'toggle-mute-status' | 'toggle-camera-status') => (data: { roomId?: string; targetUserId?: string; newState?: boolean } = {}) => {
      const conn = socketToUserMap.get(socket.id);
      if (!conn || data?.roomId !== conn.roomId) { socket.emit('error', { message: 'Join the room before changing its state.' }); return; }
      if (!isId(data?.targetUserId) || typeof data?.newState !== 'boolean') return;
      const { roomId, targetUserId, newState } = data as { roomId: string; targetUserId: string; newState: boolean };
      const key = meetingRoom(orgId, roomId);
      if (targetUserId === user.id) { socket.to(key).emit(event, { roomId, targetUserId, newState }); return; }
      for (const [sid, c] of socketToUserMap.entries()) {
        if (c.orgId === orgId && c.roomId === roomId && c.userId === targetUserId) io.to(sid).emit(event, { roomId, targetUserId, newState, isOverride: true });
      }
      io.to(key).emit(event, { roomId, targetUserId, newState });
    };
    socket.on('toggle-mute-status', toggle('toggle-mute-status'));
    socket.on('toggle-camera-status', toggle('toggle-camera-status'));

    function leaveCurrentRoom() {
      const conn = socketToUserMap.get(socket.id);
      if (!conn) return;
      const key = meetingRoom(orgId, conn.roomId);
      socket.leave(key);
      socketToUserMap.delete(socket.id);
      const set = roomToSocketsMap.get(key);
      if (set) { set.delete(socket.id); if (set.size === 0) roomToSocketsMap.delete(key); }
      socket.to(key).emit('user-disconnected', { userId: conn.userId, socketId: socket.id });
    }
    socket.on('leave-room', () => leaveCurrentRoom());

    socket.on('disconnect', () => {
      leaveCurrentRoom();
      // Offline only when this was the user's last connection in the organization.
      const stillHere = Array.from(io.sockets.sockets.values()).some((s) => s.id !== socket.id && (s.data.user as SocketUser | undefined)?.id === user.id && (s.data.user as SocketUser).orgId === orgId);
      if (!stillHere) { presenceMap.delete(user.id); io.to(ORG).emit('presence:sync', Array.from(presenceMap.values())); }
    });

    // ---------------------------------------------------------------- CRM sync (organization store, role-checked)
    const allowed = (entityType: unknown, perm: 'edit' | 'delete'): entityType is string =>
      typeof entityType === 'string' && Object.prototype.hasOwnProperty.call(ENTITY_MODULE, entityType) && canAccess(user.role, ENTITY_MODULE[entityType], perm);
    const deny = (entityType: unknown, entityId: unknown, reason: string) =>
      socket.emit('crm:sync:denied', { entityType: typeof entityType === 'string' ? entityType.slice(0, 20) : null, entityId: isId(entityId) ? entityId : null, reason });

    socket.on('crm:sync:ping', (data: { clientTimestamp?: number } = {}) => {
      socket.emit('crm:sync:pong', {
        clientTimestamp: Number.isFinite(data?.clientTimestamp) ? data.clientTimestamp : null,
        serverTimestamp: Date.now(),
        activeConnections: io.sockets.adapter.rooms.get(ORG)?.size || 1,
      });
    });

    socket.on('crm:sync:request_state', () => {
      const vectorClock: Record<string, { version: number; lastModified: number; updatedBy: string }> = {};
      for (const [key, v] of crmStateStore.entries()) vectorClock[key] = { version: v.version, lastModified: v.lastModified, updatedBy: v.updatedBy };
      socket.emit('crm:sync:init', { serverTime: Date.now(), totalEntities: crmStateStore.size, vectorClock, activeClients: io.sockets.adapter.rooms.get(ORG)?.size || 1 });
    });

    const applyUpdate = (entityType: string, entityId: string, patch: Record<string, unknown>, version?: unknown) => {
      const key = `${entityType}:${entityId}`;
      const existing = crmStateStore.get(key);
      if (!existing && crmStateStore.size >= MAX_CRM_ENTRIES_PER_ORG) return null;
      const conflict = !!existing && typeof version === 'number' && version <= existing.version;
      const newVersion = (existing?.version || 0) + 1;
      const data: Record<string, unknown> = { ...(existing?.data || {}), ...patch };
      if (conflict) data._conflictResolution = { timestamp: Date.now(), strategy: 'Field-level 3-Way Merge (Last-Write-Wins)', previousVersion: existing!.version, resolvedVersion: newVersion, competingAuthors: [existing!.updatedBy, user.id] };
      crmStateStore.set(key, { version: newVersion, lastModified: Date.now(), data, updatedBy: user.id });
      return { entityType, entityId, version: newVersion, data, updatedBy: user.id, wasReconciled: conflict, timestamp: Date.now() };
    };

    socket.on('crm:entity:update', (payload: { entityType?: string; entityId?: string; version?: number; patch?: unknown } = {}) => {
      if (!allowed(payload?.entityType, 'edit')) return deny(payload?.entityType, payload?.entityId, 'forbidden');
      if (!isId(payload.entityId) || !validPatch(payload.patch)) return deny(payload.entityType, payload.entityId, 'invalid');
      const u = applyUpdate(payload.entityType, payload.entityId, payload.patch, payload.version);
      if (!u) return deny(payload.entityType, payload.entityId, 'limit');
      if (u.wasReconciled) {
        socket.emit('crm:sync:conflict', { entityType: u.entityType, entityId: u.entityId, strategy: 'Field-level 3-Way Merge', resolvedVersion: u.version, mergedData: u.data });
        io.to(ORG).emit('crm:entity:updated', u);
        return;
      }
      socket.to(ORG).emit('crm:entity:updated', u);
      socket.emit('crm:entity:ack', { entityType: u.entityType, entityId: u.entityId, version: u.version, timestamp: Date.now() });
    });

    socket.on('crm:entity:batch_update', (payload: { updates?: Array<{ entityType?: string; entityId?: string; version?: number; patch?: unknown }> } = {}) => {
      if (!Array.isArray(payload?.updates) || payload.updates.length > MAX_BATCH) return deny(null, null, 'invalid');
      const updated: any[] = [];
      for (const item of payload.updates) {
        if (!allowed(item?.entityType, 'edit')) { deny(item?.entityType, item?.entityId, 'forbidden'); continue; }
        if (!isId(item.entityId) || !validPatch(item.patch)) { deny(item.entityType, item.entityId, 'invalid'); continue; }
        const u = applyUpdate(item.entityType, item.entityId, item.patch);
        if (u) updated.push(u);
      }
      if (updated.length) {
        socket.to(ORG).emit('crm:entity:batch_updated', { updates: updated, timestamp: Date.now() });
        for (const u of updated) socket.to(ORG).emit('crm:entity:updated', u);
      }
      socket.emit('crm:entity:batch_ack', { count: updated.length, timestamp: Date.now() });
    });

    socket.on('crm:entity:delete', (payload: { entityType?: string; entityId?: string } = {}) => {
      if (!allowed(payload?.entityType, 'delete')) return deny(payload?.entityType, payload?.entityId, 'forbidden');
      if (!isId(payload.entityId)) return deny(payload.entityType, payload.entityId, 'invalid');
      crmStateStore.delete(`${payload.entityType}:${payload.entityId}`);
      io.to(ORG).emit('crm:entity:deleted', { entityType: payload.entityType, entityId: payload.entityId, timestamp: Date.now() });
    });
  });

  return io;
}
