import { Server as SocketIOServer, Socket } from 'socket.io';
import { Server as HttpServer } from 'http';
import jwt from 'jsonwebtoken';
import { db } from './db';
import { JWT_SECRET } from '../middleware/apiGatewayMiddleware';
import { identifyToken } from '../features/social-accounts/server/auth';

interface UserConnection {
  socketId: string;
  userId: string;
  roomId: string;
}

export interface UserPresence {
  userId: string;
  name: string;
  status: 'online' | 'busy' | 'offline';
  lastActive: string;
  currentMeetingId?: string;
}

// Global mappings for WebRTC handshakes and presence multiplexing
const socketToUserMap = new Map<string, UserConnection>();
const roomToSocketsMap = new Map<string, Set<string>>();
const userPresenceMap = new Map<string, UserPresence>();

let ioInstance: SocketIOServer | null = null;

/**
 * Returns the active Socket.io server instance.
 */
export function getSocketIO(): SocketIOServer | null {
  return ioInstance;
}

/**
 * Initializes the Socket.io multiplexed real-time server handler.
 * Handles WebRTC Signaling, Calendar & Schedule Updates, and User Presence over a single connection.
 */
const MEETING_EVENT_TYPES = new Set(['hand', 'reaction', 'whiteboard:stroke', 'whiteboard:clear', 'poll:create', 'poll:vote', 'poll:close']);

export function initializeSignalingServer(server: HttpServer): SocketIOServer {
  console.log('[Signaling Server] Initializing Unified Socket.io Multiplexed Real-Time Engine...');

  const io = new SocketIOServer(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
      credentials: true
    },
    transports: ['websocket', 'polling']
  });

  ioInstance = io;

  // ---------------------------------------------------------------------------
  // 1. HANDSHAKE JWT AUTHENTICATION MIDDLEWARE (io.use)
  // ---------------------------------------------------------------------------
  io.use((socket: Socket, next) => {
    // Identity comes only from a verified token (Firebase ID token or JWT_SECRET-signed JWT),
    // or the dev identity when SOCIAL_ACCOUNTS_DEV_AUTH=true outside production. Failures are rejected.
    const authObj: any = socket.handshake.auth || {};
    const header = socket.handshake.headers?.authorization;
    const token = authObj.token ? String(authObj.token) : header && header.startsWith('Bearer ') ? header.substring(7) : '';
    identifyToken(token, authObj.devUserId).then((who) => {
      if (!who) return next(new Error('unauthorized'));
      const c = who.claims || {};
      const displayName = String(c.name || authObj.userName || 'CRM User').replace(/[^\p{L}\p{N} .'-]/gu, '').slice(0, 60) || 'CRM User';
      socket.data.user = { id: who.id, name: displayName, email: String(c.email || ''), role: String(c.role || 'AGENT') };
      next();
    }).catch(() => next(new Error('unauthorized')));
  });

  io.on('connection', (socket: Socket) => {
    const user = socket.data.user;
    console.log(`[Unified Socket] Multiplexed Connection Established: ${socket.id} (User: ${user?.name || user?.id})`);

    // Register initial presence as online
    if (user?.id) {
      const presence: UserPresence = {
        userId: user.id,
        name: user.name || 'CRM User',
        status: 'online',
        lastActive: new Date().toISOString()
      };
      userPresenceMap.set(user.id, presence);

      // Broadcast presence state update to all clients
      io.emit('user:online', presence);
      io.emit('presence:sync', Array.from(userPresenceMap.values()));
    }

    // Send initial presence roster to newly connected client
    socket.emit('presence:sync', Array.from(userPresenceMap.values()));

    // =========================================================================
    // FEATURE MODULE 1: PRESENCE / USER STATUS MULTIPLEXING
    // =========================================================================

    /**
     * user:online
     * Multiplexed presence status update to mark user active
     */
    socket.on('user:online', (data: Partial<UserPresence>) => {
      const userId = data?.userId || user?.id;
      const userName = data?.name || user?.name || 'CRM User';

      if (!userId) return;

      const presence: UserPresence = {
        userId,
        name: userName,
        status: 'online',
        lastActive: new Date().toISOString()
      };

      userPresenceMap.set(userId, presence);
      console.log(`[Presence Module] User marked ONLINE: ${userName} (${userId})`);

      io.emit('user:online', presence);
      io.emit('presence:sync', Array.from(userPresenceMap.values()));
    });

    /**
     * user:busy
     * Multiplexed presence status update to mark user in a meeting or on a call
     */
    socket.on('user:busy', (data: { userId?: string; name?: string; currentMeetingId?: string }) => {
      const userId = data?.userId || user?.id;
      const userName = data?.name || user?.name || 'CRM User';

      if (!userId) return;

      const presence: UserPresence = {
        userId,
        name: userName,
        status: 'busy',
        currentMeetingId: data?.currentMeetingId,
        lastActive: new Date().toISOString()
      };

      userPresenceMap.set(userId, presence);
      console.log(`[Presence Module] User marked BUSY: ${userName} (${userId}) [Meeting: ${data?.currentMeetingId || 'Active Call'}]`);

      io.emit('user:busy', presence);
      io.emit('presence:sync', Array.from(userPresenceMap.values()));
    });

    // =========================================================================
    // FEATURE MODULE 2: CALENDAR & SCHEDULE UPDATES MULTIPLEXING
    // =========================================================================

    /**
     * schedule:updated
     * Broadcasts calendar event, rescheduling, or itinerary changes to all connected clients
     */
    socket.on('schedule:updated', (data: { meetingId: string; event?: any; updatedBy?: string; changes?: any; timestamp?: string }) => {
      console.log(`[Schedule Module] Schedule updated for meeting: ${data.meetingId} by ${data.updatedBy || user?.name}`);

      const payload = {
        ...data,
        updatedBy: data.updatedBy || user?.name || 'System',
        timestamp: data.timestamp || new Date().toISOString()
      };

      // Broadcast real-time schedule update event across all connected clients
      io.emit('schedule:updated', payload);
    });

    /**
     * slot:booked
     * Broadcasts real-time slot booking event for calendar synchronization
     */
    socket.on('slot:booked', (data: { slotId: string; date: string; time: string; bookedBy?: string; attendeeEmail?: string; timestamp?: string }) => {
      console.log(`[Schedule Module] Slot booked: ${data.slotId} on ${data.date} at ${data.time} by ${data.bookedBy || user?.name}`);

      const payload = {
        ...data,
        bookedBy: data.bookedBy || user?.name || 'CRM Contact',
        timestamp: data.timestamp || new Date().toISOString()
      };

      // Broadcast slot booking to update calendar views globally in real-time
      io.emit('slot:booked', payload);
    });

    // =========================================================================
    // FEATURE MODULE 3: WEBRTC SIGNALING MULTIPLEXING
    // =========================================================================

    /**
     * rtc:offer
     * Multiplexed WebRTC SDP Offer event
     */
    socket.on('rtc:offer', (data: { targetSocketId?: string; roomId?: string; offer: any; senderUserId?: string }) => {
      const senderConn = socketToUserMap.get(socket.id);
      const roomId = data.roomId || senderConn?.roomId;
      const senderUserId = senderConn?.userId || data.senderUserId || user?.id || socket.id;

      console.log(`[WebRTC Module] rtc:offer relayed from ${senderUserId} (${socket.id}) -> Target: ${data.targetSocketId || roomId || 'room'}`);

      const payload = {
        senderSocketId: socket.id,
        senderUserId,
        offer: data.offer,
        roomId,
        timestamp: new Date().toISOString()
      };

      if (data.targetSocketId) {
        socket.to(data.targetSocketId).emit('rtc:offer', payload);
        socket.to(data.targetSocketId).emit('offer', payload);
      } else if (roomId) {
        socket.to(roomId).emit('rtc:offer', payload);
        socket.to(roomId).emit('offer', payload);
      } else {
        socket.broadcast.emit('rtc:offer', payload);
        socket.broadcast.emit('offer', payload);
      }
    });

    /**
     * rtc:answer
     * Multiplexed WebRTC SDP Answer event
     */
    socket.on('rtc:answer', (data: { targetSocketId?: string; roomId?: string; answer: any; senderUserId?: string }) => {
      const senderConn = socketToUserMap.get(socket.id);
      const roomId = data.roomId || senderConn?.roomId;
      const senderUserId = senderConn?.userId || data.senderUserId || user?.id || socket.id;

      console.log(`[WebRTC Module] rtc:answer relayed from ${senderUserId} (${socket.id}) -> Target: ${data.targetSocketId || roomId || 'room'}`);

      const payload = {
        senderSocketId: socket.id,
        senderUserId,
        answer: data.answer,
        roomId,
        timestamp: new Date().toISOString()
      };

      if (data.targetSocketId) {
        socket.to(data.targetSocketId).emit('rtc:answer', payload);
        socket.to(data.targetSocketId).emit('answer', payload);
      } else if (roomId) {
        socket.to(roomId).emit('rtc:answer', payload);
        socket.to(roomId).emit('answer', payload);
      } else {
        socket.broadcast.emit('rtc:answer', payload);
        socket.broadcast.emit('answer', payload);
      }
    });

    /**
     * rtc:ice-candidate
     * Multiplexed WebRTC ICE Candidate event
     */
    socket.on('rtc:ice-candidate', (data: { targetSocketId?: string; roomId?: string; candidate: any; senderUserId?: string }) => {
      const senderConn = socketToUserMap.get(socket.id);
      const roomId = data.roomId || senderConn?.roomId;
      const senderUserId = senderConn?.userId || data.senderUserId || user?.id || socket.id;

      console.log(`[WebRTC Module] rtc:ice-candidate relayed from ${senderUserId} (${socket.id}) -> Target: ${data.targetSocketId || roomId || 'room'}`);

      const payload = {
        senderSocketId: socket.id,
        senderUserId,
        candidate: data.candidate,
        roomId,
        timestamp: new Date().toISOString()
      };

      if (data.targetSocketId) {
        socket.to(data.targetSocketId).emit('rtc:ice-candidate', payload);
        socket.to(data.targetSocketId).emit('ice-candidate', payload);
      } else if (roomId) {
        socket.to(roomId).emit('rtc:ice-candidate', payload);
        socket.to(roomId).emit('ice-candidate', payload);
      } else {
        socket.broadcast.emit('rtc:ice-candidate', payload);
        socket.broadcast.emit('ice-candidate', payload);
      }
    });

    // Backward compatibility handlers for existing components
    socket.on('offer', (data) => {
      if (!data.offer) return;
      socket.emit('rtc:offer', data);
    });
    socket.on('answer', (data) => {
      if (!data.answer) return;
      socket.emit('rtc:answer', data);
    });
    socket.on('ice-candidate', (data) => {
      if (!data.candidate) return;
      socket.emit('rtc:ice-candidate', data);
    });

    // 1. join-room: Takes a roomId and userId. Adds the socket to the room and broadcasts user-connected.
    socket.on('join-room', async (data: { roomId: string; userId: string; email?: string }) => {
      const { roomId, userId } = data;

      if (!roomId || !userId) {
        console.error(`[Signaling Server] Join rejected: missing roomId or userId. Socket: ${socket.id}`);
        socket.emit('error', { message: 'Authentication failed: Missing roomId or userId' });
        return;
      }

      try {
        // Authenticate joining member or allow guest participant
        let user: any = null;
        try {
          user = await db.user.findFirst({
            where: {
              OR: [
                { id: userId },
                { email: userId },
                ...(data.email ? [{ email: data.email }] : [])
              ]
            }
          });
        } catch (e) {
          // Allow guest join if db lookup fails
        }

        const memberName = user?.name || data.email || userId;
        console.log(`[Signaling Server] Member ${memberName} (${userId}) joining room: ${roomId}`);

        // Add socket to the room
        socket.join(roomId);

        // Register connection in memory maps
        socketToUserMap.set(socket.id, { socketId: socket.id, userId, roomId });

        if (!roomToSocketsMap.has(roomId)) {
          roomToSocketsMap.set(roomId, new Set());
        }
        roomToSocketsMap.get(roomId)!.add(socket.id);

        // Fetch other peers already in the room
        const peers = Array.from(roomToSocketsMap.get(roomId) || [])
          .filter(id => id !== socket.id)
          .map(id => ({
            socketId: id,
            userId: socketToUserMap.get(id)?.userId
          }));

        // Broadcast a user-connected event to everyone else in that room
        socket.to(roomId).emit('user-connected', {
          userId,
          socketId: socket.id
        });

        // Send the current room roster to the newly joined peer so they know who to call
        socket.emit('room-roster', {
          roomId,
          peers
        });

        console.log(`[Signaling Server] Room ${roomId} Roster updated. Total active sockets: ${roomToSocketsMap.get(roomId)?.size}`);
      } catch (err: any) {
        console.error(`[Signaling Server] Exception verifying user joining room:`, err.message);
        socket.emit('error', { message: 'Failed to process room join request' });
      }
    });

    // 2. offer / sdp-offer: Relays a WebRTC SDP offer from one peer to a specific target peer in the room.
    const handleOffer = (data: { targetSocketId: string; offer: any }) => {
      const { targetSocketId, offer } = data;
      const sender = socketToUserMap.get(socket.id);

      if (!targetSocketId || !offer) {
        console.warn(`[Signaling Server] Offer ignored from ${socket.id}: incomplete payload.`);
        return;
      }

      console.log(`[Signaling Server] Relaying SDP Offer from ${sender?.userId || socket.id} to target: ${targetSocketId}`);

      const payload = {
        senderSocketId: socket.id,
        senderUserId: sender?.userId,
        offer
      };

      socket.to(targetSocketId).emit('offer', payload);
      socket.to(targetSocketId).emit('sdp-offer', payload);
    };
    socket.on('offer', handleOffer);
    socket.on('sdp-offer', handleOffer);

    // 3. answer / sdp-answer: Relays a WebRTC SDP answer back to the peer who created the offer.
    const handleAnswer = (data: { targetSocketId: string; answer: any }) => {
      const { targetSocketId, answer } = data;
      const sender = socketToUserMap.get(socket.id);

      if (!targetSocketId || !answer) {
        console.warn(`[Signaling Server] Answer ignored from ${socket.id}: incomplete payload.`);
        return;
      }

      console.log(`[Signaling Server] Relaying SDP Answer from ${sender?.userId || socket.id} to target: ${targetSocketId}`);

      const payload = {
        senderSocketId: socket.id,
        senderUserId: sender?.userId,
        answer
      };

      socket.to(targetSocketId).emit('answer', payload);
      socket.to(targetSocketId).emit('sdp-answer', payload);
    };
    socket.on('answer', handleAnswer);
    socket.on('sdp-answer', handleAnswer);

    // 4. ice-candidate: Relays WebRTC ICE candidates between peers.
    socket.on('ice-candidate', (data: { targetSocketId: string; candidate: any }) => {
      const { targetSocketId, candidate } = data;
      const sender = socketToUserMap.get(socket.id);

      if (!targetSocketId || !candidate) {
        console.warn(`[Signaling Server] ICE Candidate ignored from ${socket.id}: incomplete payload.`);
        return;
      }

      console.log(`[Signaling Server] Relaying ICE Candidate from ${sender?.userId || socket.id} to target: ${targetSocketId}`);

      socket.to(targetSocketId).emit('ice-candidate', {
        senderSocketId: socket.id,
        senderUserId: sender?.userId,
        candidate
      });
    });

    // 4.5. track-replaced & renegotiate: Handles stream renegotiation when switching webcam to screen share track
    socket.on('track-replaced', (data: {
      roomId?: string;
      targetSocketId?: string;
      trackType?: 'video' | 'audio' | 'screen';
      streamType?: 'camera' | 'screen';
      label?: string;
      offer?: any;
      userId?: string;
    }) => {
      const sender = socketToUserMap.get(socket.id);
      const roomId = data.roomId || sender?.roomId;
      const senderUserId = sender?.userId || data.userId || socket.id;

      console.log(`[Signaling Server] Track replaced event from user ${senderUserId} (${socket.id}) -> trackType: ${data.trackType || 'video'}, streamType: ${data.streamType || 'screen'}`);

      const payload = {
        senderSocketId: socket.id,
        senderUserId,
        trackType: data.trackType || 'video',
        streamType: data.streamType || 'screen',
        label: data.label || 'Screen Share Stream',
        offer: data.offer || null,
        timestamp: new Date().toISOString()
      };

      if (data.targetSocketId) {
        socket.to(data.targetSocketId).emit('track-replaced', payload);
      } else if (roomId) {
        socket.to(roomId).emit('track-replaced', payload);
      } else {
        socket.broadcast.emit('track-replaced', payload);
      }
    });

    socket.on('renegotiate', (data: { targetSocketId?: string; roomId?: string; offer?: any }) => {
      const sender = socketToUserMap.get(socket.id);
      const roomId = data.roomId || sender?.roomId;
      const payload = {
        senderSocketId: socket.id,
        senderUserId: sender?.userId,
        offer: data.offer
      };

      if (data.targetSocketId) {
        socket.to(data.targetSocketId).emit('renegotiate', payload);
      } else if (roomId) {
        socket.to(roomId).emit('renegotiate', payload);
      }
    });

    // 5. chat-message: Relays chat messages to other peers in the room.
    socket.on('chat-message', (data: { text: string; sender: string; timestamp?: string }) => {
      const userConn = socketToUserMap.get(socket.id);
      if (userConn) {
        console.log(`[Signaling Server] Relay chat message from ${userConn.userId} in room ${userConn.roomId}: ${data.text}`);
        socket.to(userConn.roomId).emit('chat-message', {
          sender: data.sender || userConn.userId,
          text: data.text,
          timestamp: data.timestamp || new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
        });
      }
    });

    // Real-time administrative notification overrides & self-state broadcast
    socket.on('toggle-mute-status', async (data: { roomId: string; targetUserId: string; newState: boolean; userId?: string }) => {
      const { roomId, targetUserId, newState } = data;
      const senderConn = socketToUserMap.get(socket.id);
      const senderUserId = senderConn?.userId || data.userId;

      if (!senderUserId) {
        console.error(`[Signaling Server] Toggle Mute rejected: unknown sender identity. Socket: ${socket.id}`);
        socket.emit('error', { message: 'Authentication failed: Unknown sender identity' });
        return;
      }

      try {
        // Authenticate the actor (Requirement 3)
        const user = await db.user.findFirst({
          where: {
            OR: [
              { id: senderUserId },
              { email: senderUserId }
            ]
          }
        });

        if (!user) {
          console.warn(`[Signaling Server] Unauthorized toggle-mute-status from ${senderUserId}. Actor not in CRM database.`);
          socket.emit('error', { message: 'Authentication failed: Not a verified CRM member' });
          return;
        }

        console.log(`[Signaling Server] Verified member ${user.name} (${senderUserId}) muting/unmuting ${targetUserId} to ${newState}`);

        if (targetUserId === senderUserId) {
          // Self-toggle broadcast to room (Requirement 2)
          socket.to(roomId).emit('toggle-mute-status', { roomId, targetUserId, newState });
          console.log(`[Signaling Server] Self-mute status broadcasted to room ${roomId} for user ${targetUserId}`);
        } else {
          // Administrative override (Requirement 1)
          let targetSocketFound = false;
          for (const [sid, conn] of socketToUserMap.entries()) {
            if (conn.userId === targetUserId && conn.roomId === roomId) {
              io.to(sid).emit('toggle-mute-status', { roomId, targetUserId, newState, isOverride: true });
              targetSocketFound = true;
              console.log(`[Signaling Server] Dispatched direct administrative mute override to socket: ${sid} for user ${targetUserId}`);
            }
          }

          // Broadcast to the room so sidebar UI updates instantly
          io.to(roomId).emit('toggle-mute-status', { roomId, targetUserId, newState });

          if (!targetSocketFound) {
            console.warn(`[Signaling Server] Override target user ${targetUserId} not found in room ${roomId}.`);
          }
        }
      } catch (err: any) {
        console.error(`[Signaling Server] Auth exception in toggle-mute-status:`, err.message);
        socket.emit('error', { message: 'Internal validation error' });
      }
    });

    socket.on('toggle-camera-status', async (data: { roomId: string; targetUserId: string; newState: boolean; userId?: string }) => {
      const { roomId, targetUserId, newState } = data;
      const senderConn = socketToUserMap.get(socket.id);
      const senderUserId = senderConn?.userId || data.userId;

      if (!senderUserId) {
        console.error(`[Signaling Server] Toggle Camera rejected: unknown sender identity. Socket: ${socket.id}`);
        socket.emit('error', { message: 'Authentication failed: Unknown sender identity' });
        return;
      }

      try {
        // Authenticate the actor (Requirement 3)
        const user = await db.user.findFirst({
          where: {
            OR: [
              { id: senderUserId },
              { email: senderUserId }
            ]
          }
        });

        if (!user) {
          console.warn(`[Signaling Server] Unauthorized toggle-camera-status from ${senderUserId}. Actor not in CRM database.`);
          socket.emit('error', { message: 'Authentication failed: Not a verified CRM member' });
          return;
        }

        console.log(`[Signaling Server] Verified member ${user.name} (${senderUserId}) toggling camera for ${targetUserId} to ${newState}`);

        if (targetUserId === senderUserId) {
          // Self-toggle broadcast to room
          socket.to(roomId).emit('toggle-camera-status', { roomId, targetUserId, newState });
          console.log(`[Signaling Server] Self-camera status broadcasted to room ${roomId} for user ${targetUserId}`);
        } else {
          // Administrative override (Requirement 1)
          let targetSocketFound = false;
          for (const [sid, conn] of socketToUserMap.entries()) {
            if (conn.userId === targetUserId && conn.roomId === roomId) {
              io.to(sid).emit('toggle-camera-status', { roomId, targetUserId, newState, isOverride: true });
              targetSocketFound = true;
              console.log(`[Signaling Server] Dispatched direct administrative camera override to socket: ${sid} for user ${targetUserId}`);
            }
          }

          // Broadcast to the room so sidebar UI updates instantly
          io.to(roomId).emit('toggle-camera-status', { roomId, targetUserId, newState });

          if (!targetSocketFound) {
            console.warn(`[Signaling Server] Override target user ${targetUserId} not found in room ${roomId}.`);
          }
        }
      } catch (err: any) {
        console.error(`[Signaling Server] Auth exception in toggle-camera-status:`, err.message);
        socket.emit('error', { message: 'Internal validation error' });
      }
    });

    // 5.4. meeting:event: small in-meeting UI events (raise hand, reactions, polls, whiteboard),
    // relayed only to the sender's current room. Unknown types and oversized payloads are dropped.
    socket.on('meeting:event', (evt: unknown) => {
      const conn = socketToUserMap.get(socket.id);
      if (!conn || !evt || typeof evt !== 'object') return;
      const e = evt as Record<string, unknown>;
      if (typeof e.id !== 'string' || typeof e.type !== 'string' || !MEETING_EVENT_TYPES.has(e.type)) return;
      let size = 0;
      try { size = JSON.stringify(e).length; } catch { return; }
      if (size > 16_000) return;
      socket.to(conn.roomId).emit('meeting:event', { ...e, relayedAt: Date.now() });
    });

    // 5.5. leave-room: Handles voluntary exit from a WebRTC session room.
    socket.on('leave-room', (data: { roomId: string }) => {
      const userConn = socketToUserMap.get(socket.id);
      if (userConn) {
        const { roomId, userId } = userConn;
        console.log(`[Signaling Server] User voluntarily leaving room: ${userId} (${socket.id}) from room ${roomId}`);
        socket.leave(roomId);
        socketToUserMap.delete(socket.id);
        const socketsInRoom = roomToSocketsMap.get(roomId);
        if (socketsInRoom) {
          socketsInRoom.delete(socket.id);
          if (socketsInRoom.size === 0) {
            roomToSocketsMap.delete(roomId);
          }
        }
        // Broadcast user-disconnected so remaining client handles UI updates immediately
        socket.to(roomId).emit('user-disconnected', {
          userId,
          socketId: socket.id
        });
      }
    });

    // 6. disconnect: Detects when a user leaves and notifies the remaining peers in the room.
    socket.on('disconnect', () => {
      const userConn = socketToUserMap.get(socket.id);

      if (userConn) {
        const { roomId, userId } = userConn;
        console.log(`[Signaling Server] Socket disconnected: ${socket.id} (User: ${userId}) from room ${roomId}`);

        // Clean up in-memory maps
        socketToUserMap.delete(socket.id);
        const socketsInRoom = roomToSocketsMap.get(roomId);
        if (socketsInRoom) {
          socketsInRoom.delete(socket.id);
          if (socketsInRoom.size === 0) {
            roomToSocketsMap.delete(roomId);
          }
        }

        // Notify remaining peers in the room
        socket.to(roomId).emit('user-disconnected', {
          userId,
          socketId: socket.id
        });

        console.log(`[Signaling Server] Broadcasted user-disconnected for ${userId} (${socket.id}) to room ${roomId}`);
      } else {
        console.log(`[Signaling Server] Untracked Socket disconnected: ${socket.id}`);
      }
    });

    // ===========================================================================
    // MODULE 7: REAL-TIME CRM DATA SYNCHRONIZATION & CONFLICT RESOLUTION
    // ===========================================================================
    const crmStateStore = new Map<string, { version: number; lastModified: number; data: any; updatedBy: string }>();

    socket.on('crm:sync:ping', (data: { clientTimestamp: number }) => {
      socket.emit('crm:sync:pong', {
        clientTimestamp: data.clientTimestamp,
        serverTimestamp: Date.now(),
        activeConnections: io.engine.clientsCount || 1,
      });
    });

    socket.on('crm:sync:request_state', () => {
      const stateSummary: Record<string, { version: number; lastModified: number; updatedBy: string }> = {};
      for (const [key, value] of crmStateStore.entries()) {
        stateSummary[key] = {
          version: value.version,
          lastModified: value.lastModified,
          updatedBy: value.updatedBy
        };
      }
      socket.emit('crm:sync:init', {
        serverTime: Date.now(),
        totalEntities: crmStateStore.size,
        vectorClock: stateSummary,
        activeClients: io.engine.clientsCount || 1
      });
    });

    socket.on('crm:entity:update', (payload: {
      entityType: 'contact' | 'lead' | 'deal' | 'event' | 'task';
      entityId: string;
      version: number;
      patch: Record<string, any>;
      clientTimestamp: number;
      author?: string;
    }) => {
      const key = `${payload.entityType}:${payload.entityId}`;
      const existing = crmStateStore.get(key);
      const author = payload.author || user?.id || socket.id;

      if (existing) {
        // Conflict Detection: If incoming version is equal or less than server version, concurrent edit occurred
        if (payload.version <= existing.version) {
          console.warn(`[CRM Sync] Concurrent Conflict detected on ${key}! Incoming v${payload.version} vs Server v${existing.version}`);
          
          // Conflict Resolution Strategy: Deterministic Last-Write-Wins with Field-Level 3-Way Merge
          const mergedData = {
            ...existing.data,
            ...payload.patch,
            _conflictResolution: {
              timestamp: Date.now(),
              strategy: 'Field-level 3-Way Merge (Last-Write-Wins)',
              previousVersion: existing.version,
              resolvedVersion: existing.version + 1,
              competingAuthors: [existing.updatedBy, author]
            }
          };

          const newVersion = existing.version + 1;
          crmStateStore.set(key, {
            version: newVersion,
            lastModified: Date.now(),
            data: mergedData,
            updatedBy: author
          });

          // Notify sender of conflict resolution
          socket.emit('crm:sync:conflict', {
            entityType: payload.entityType,
            entityId: payload.entityId,
            strategy: 'Field-level 3-Way Merge',
            resolvedVersion: newVersion,
            mergedData
          });

          // Broadcast reconciled entity to all clients
          io.emit('crm:entity:updated', {
            entityType: payload.entityType,
            entityId: payload.entityId,
            version: newVersion,
            data: mergedData,
            updatedBy: author,
            wasReconciled: true,
            timestamp: Date.now()
          });
          return;
        }
      }

      // No conflict: Clean optimistic update
      const newVersion = (existing?.version || 0) + 1;
      const updatedData = { ...(existing?.data || {}), ...payload.patch };

      crmStateStore.set(key, {
        version: newVersion,
        lastModified: Date.now(),
        data: updatedData,
        updatedBy: author
      });

      // Broadcast update to all other connected clients
      socket.broadcast.emit('crm:entity:updated', {
        entityType: payload.entityType,
        entityId: payload.entityId,
        version: newVersion,
        data: updatedData,
        updatedBy: author,
        wasReconciled: false,
        timestamp: Date.now()
      });

      // Acknowledge to sender
      socket.emit('crm:entity:ack', {
        entityType: payload.entityType,
        entityId: payload.entityId,
        version: newVersion,
        timestamp: Date.now()
      });
    });

    socket.on('crm:entity:batch_update', (payload: {
      updates: Array<{
        entityType: 'contact' | 'lead' | 'deal' | 'event' | 'task';
        entityId: string;
        version?: number;
        patch: Record<string, any>;
      }>;
      clientTimestamp: number;
      author?: string;
    }) => {
      if (!Array.isArray(payload?.updates)) return;
      const author = payload.author || user?.id || socket.id;
      const updatedList: any[] = [];

      for (const item of payload.updates) {
        const key = `${item.entityType}:${item.entityId}`;
        const existing = crmStateStore.get(key);
        const newVersion = (existing?.version || 0) + 1;
        const updatedData = { ...(existing?.data || {}), ...item.patch };

        crmStateStore.set(key, {
          version: newVersion,
          lastModified: Date.now(),
          data: updatedData,
          updatedBy: author
        });

        updatedList.push({
          entityType: item.entityType,
          entityId: item.entityId,
          version: newVersion,
          data: updatedData,
          updatedBy: author,
          wasReconciled: false,
          timestamp: Date.now()
        });
      }

      socket.broadcast.emit('crm:entity:batch_updated', {
        updates: updatedList,
        timestamp: Date.now()
      });

      for (const u of updatedList) {
        socket.broadcast.emit('crm:entity:updated', u);
      }

      socket.emit('crm:entity:batch_ack', {
        count: updatedList.length,
        timestamp: Date.now()
      });
    });

    socket.on('crm:entity:delete', (payload: { entityType: string; entityId: string }) => {
      const key = `${payload.entityType}:${payload.entityId}`;
      crmStateStore.delete(key);
      io.emit('crm:entity:deleted', {
        entityType: payload.entityType,
        entityId: payload.entityId,
        timestamp: Date.now()
      });
    });
  });

  return io;
}
