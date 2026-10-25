/**
 * WebRTC Event Bus & Global Call State Dispatcher
 */

export interface WebRTCCallPayload {
  peerName?: string;
  room?: string;
  callerId?: string;
  avatar?: string;
  duration?: number;
  timestamp?: number;
  [key: string]: any;
}

export type WebRTCCallState = 'incoming' | 'connected' | 'disconnected' | 'ringing' | 'rejected' | 'muted' | 'unmuted';

export function dispatchWebRTCCallState(state: WebRTCCallState, payload?: WebRTCCallPayload) {
  if (typeof window === 'undefined') return;

  const eventName = state === 'incoming' 
    ? 'webrtc:incoming-call' 
    : state === 'connected' 
    ? 'webrtc:call-connected' 
    : state === 'disconnected' 
    ? 'webrtc:call-ended' 
    : `webrtc:${state}`;

  const eventDetail = {
    state,
    callerName: payload?.peerName || 'Client Call',
    callerAvatar: payload?.avatar || '',
    callerNumber: payload?.callerId || '+1 (800) 555-0199',
    roomId: payload?.room || 'general-room',
    timestamp: payload?.timestamp || Date.now(),
    ...payload
  };

  window.dispatchEvent(new CustomEvent(eventName, { detail: eventDetail }));
  window.dispatchEvent(new CustomEvent('webrtc:state-change', { detail: eventDetail }));
}

export function onWebRTCStateChange(callback: (state: WebRTCCallState, payload: WebRTCCallPayload) => void) {
  if (typeof window === 'undefined') return () => {};

  const handler = (e: CustomEvent<WebRTCCallPayload & { state: WebRTCCallState }>) => {
    callback(e.detail.state, e.detail);
  };

  window.addEventListener('webrtc:state-change' as any, handler);
  return () => {
    window.removeEventListener('webrtc:state-change' as any, handler);
  };
}

export function dispatchScreenShareState(isSharing: boolean, stream?: MediaStream | null) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('webrtc:screenshare-change', {
    detail: { isSharing, stream }
  }));
}

export function onScreenShareStateChange(callback: (isSharing: boolean, stream?: MediaStream | null) => void) {
  if (typeof window === 'undefined') return () => {};
  const handler = (e: any) => {
    callback(e.detail?.isSharing ?? false, e.detail?.stream ?? null);
  };
  window.addEventListener('webrtc:screenshare-change', handler);
  return () => {
    window.removeEventListener('webrtc:screenshare-change', handler);
  };
}

export function requestToggleScreenShare() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('webrtc:request-toggle-screenshare'));
}

export function onRequestToggleScreenShare(callback: () => void) {
  if (typeof window === 'undefined') return () => {};
  const handler = () => {
    callback();
  };
  window.addEventListener('webrtc:request-toggle-screenshare', handler);
  return () => {
    window.removeEventListener('webrtc:request-toggle-screenshare', handler);
  };
}
