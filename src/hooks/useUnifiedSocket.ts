import { useEffect, useState, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { getApiAuthHeaders } from '../lib/apiAuth';

export interface UserPresence {
  userId: string;
  name: string;
  status: 'online' | 'busy' | 'offline';
  lastActive: string;
  currentMeetingId?: string;
}

export interface WebRtcOfferPayload {
  targetSocketId?: string;
  roomId?: string;
  offer: any;
  senderUserId?: string;
  senderSocketId?: string;
  timestamp?: string;
}

export interface WebRtcAnswerPayload {
  targetSocketId?: string;
  roomId?: string;
  answer: any;
  senderUserId?: string;
  senderSocketId?: string;
  timestamp?: string;
}

export interface WebRtcIceCandidatePayload {
  targetSocketId?: string;
  roomId?: string;
  candidate: any;
  senderUserId?: string;
  senderSocketId?: string;
  timestamp?: string;
}

export interface ScheduleUpdatedPayload {
  meetingId: string;
  event?: any;
  updatedBy?: string;
  changes?: any;
  timestamp?: string;
}

export interface SlotBookedPayload {
  slotId: string;
  date: string;
  time: string;
  bookedBy?: string;
  attendeeEmail?: string;
  timestamp?: string;
}

export interface UseUnifiedSocketOptions {
  token?: string;
  userId?: string;
  userName?: string;
  autoConnect?: boolean;
}

// Global persistent socket reference to enforce a single collapsed socket connection across components
let sharedSocketInstance: Socket | null = null;
let connectionCount = 0;

export function useUnifiedSocket(options: UseUnifiedSocketOptions = {}) {
  const { token, userId, userName, autoConnect = true } = options;

  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [socketId, setSocketId] = useState<string | null>(null);
  const [activeUsers, setActiveUsers] = useState<UserPresence[]>([]);
  const [lastEvent, setLastEvent] = useState<{ name: string; timestamp: number } | null>(null);

  const socketRef = useRef<Socket | null>(null);

  // Determine JWT auth token from options or localStorage
  const getAuthToken = useCallback(() => {
    if (token) return token;
    if (typeof window !== 'undefined') {
      return localStorage.getItem('bff_jwt_token') || '';
    }
    return '';
  }, [token]);

  useEffect(() => {
    if (!autoConnect) return;

    const activeToken = getAuthToken();

    if (!sharedSocketInstance || !sharedSocketInstance.connected) {
      console.log('[useUnifiedSocket] Initializing collapsed single Socket.io connection...');
      
      const socketUrl = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
      
      sharedSocketInstance = io(socketUrl, {
        transports: ['websocket', 'polling'],
        // Credentials are sent in the handshake auth only (never the URL). Without a stored token,
        // the signed-in user's Firebase ID token (or the dev identity in development) is used.
        auth: (cb: (data: Record<string, unknown>) => void) => {
          getApiAuthHeaders().then((h) => cb({
            token: activeToken || (h.Authorization ? h.Authorization.slice(7) : undefined),
            devUserId: h['X-Dev-User-Id'],
            userName,
          })).catch(() => cb({ userName }));
        },
        autoConnect: true,
        reconnection: true,
        reconnectionAttempts: 10,
        reconnectionDelay: 1000
      });
    }

    const socket = sharedSocketInstance;
    socketRef.current = socket;
    connectionCount++;

    // Connection lifecycle listeners
    const handleConnect = () => {
      console.log(`[useUnifiedSocket] Socket connected successfully! ID: ${socket.id}`);
      setIsConnected(true);
      setSocketId(socket.id || null);
    };

    const handleDisconnect = (reason: string) => {
      console.warn(`[useUnifiedSocket] Socket disconnected: ${reason}`);
      setIsConnected(false);
      setSocketId(null);
    };

    const handlePresenceSync = (presenceList: UserPresence[]) => {
      setActiveUsers(presenceList || []);
      setLastEvent({ name: 'presence:sync', timestamp: Date.now() });
    };

    const handleUserOnline = (presence: UserPresence) => {
      setActiveUsers((prev) => {
        const filtered = prev.filter((u) => u.userId !== presence.userId);
        return [...filtered, presence];
      });
      setLastEvent({ name: 'user:online', timestamp: Date.now() });
    };

    const handleUserBusy = (presence: UserPresence) => {
      setActiveUsers((prev) => {
        const filtered = prev.filter((u) => u.userId !== presence.userId);
        return [...filtered, presence];
      });
      setLastEvent({ name: 'user:busy', timestamp: Date.now() });
    };

    if (socket.connected) {
      setIsConnected(true);
      setSocketId(socket.id || null);
    }

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('presence:sync', handlePresenceSync);
    socket.on('user:online', handleUserOnline);
    socket.on('user:busy', handleUserBusy);

    return () => {
      connectionCount--;
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('presence:sync', handlePresenceSync);
      socket.off('user:online', handleUserOnline);
      socket.off('user:busy', handleUserBusy);

      if (connectionCount <= 0 && sharedSocketInstance) {
        console.log('[useUnifiedSocket] All active components unmounted. Closing shared socket.');
        sharedSocketInstance.disconnect();
        sharedSocketInstance = null;
      }
    };
  }, [autoConnect, getAuthToken, userId, userName]);

  // Helper to safely emit events over the single multiplexed socket connection
  const emit = useCallback((event: string, data: any) => {
    if (socketRef.current && socketRef.current.connected) {
      socketRef.current.emit(event, data);
    } else {
      console.warn(`[useUnifiedSocket] Cannot emit '${event}': Socket is disconnected.`);
    }
  }, []);

  // Helper to register event listeners
  const on = useCallback((event: string, callback: (...args: any[]) => void) => {
    const socket = socketRef.current || sharedSocketInstance;
    if (!socket) return () => {};

    socket.on(event, callback);
    return () => {
      socket.off(event, callback);
    };
  }, []);

  // ===========================================================================
  // MODULE 1: WEBRTC SIGNALING API
  // ===========================================================================
  const webrtc = {
    sendOffer: (payload: WebRtcOfferPayload) => emit('rtc:offer', payload),
    sendAnswer: (payload: WebRtcAnswerPayload) => emit('rtc:answer', payload),
    sendIceCandidate: (payload: WebRtcIceCandidatePayload) => emit('rtc:ice-candidate', payload),
    joinRoom: (roomId: string, uId: string, email?: string) => emit('join-room', { roomId, userId: uId, email }),
    leaveRoom: (roomId: string) => emit('leave-room', { roomId }),
    onOffer: (callback: (data: WebRtcOfferPayload) => void) => on('rtc:offer', callback),
    onAnswer: (callback: (data: WebRtcAnswerPayload) => void) => on('rtc:answer', callback),
    onIceCandidate: (callback: (data: WebRtcIceCandidatePayload) => void) => on('rtc:ice-candidate', callback)
  };

  // ===========================================================================
  // MODULE 2: CALENDAR & SCHEDULE UPDATES API
  // ===========================================================================
  const schedule = {
    updateSchedule: (payload: ScheduleUpdatedPayload) => emit('schedule:updated', payload),
    bookSlot: (payload: SlotBookedPayload) => emit('slot:booked', payload),
    onScheduleUpdated: (callback: (data: ScheduleUpdatedPayload) => void) => on('schedule:updated', callback),
    onSlotBooked: (callback: (data: SlotBookedPayload) => void) => on('slot:booked', callback)
  };

  // ===========================================================================
  // MODULE 3: USER PRESENCE / STATUS API
  // ===========================================================================
  const presence = {
    setOnline: (data?: { userId?: string; name?: string }) => emit('user:online', data || {}),
    setBusy: (data?: { userId?: string; name?: string; currentMeetingId?: string }) => emit('user:busy', data || {}),
    onUserOnline: (callback: (data: UserPresence) => void) => on('user:online', callback),
    onUserBusy: (callback: (data: UserPresence) => void) => on('user:busy', callback),
    onPresenceChange: (callback: (users: UserPresence[]) => void) => on('presence:sync', callback),
    activeUsers
  };

  return {
    socket: socketRef.current || sharedSocketInstance,
    isConnected,
    socketId,
    activeUsers,
    lastEvent,
    emit,
    on,
    webrtc,
    schedule,
    presence
  };
}
