import React, { useState, useEffect } from 'react';
import { Phone, PhoneOff, PhoneIncoming, Mic, MicOff, Video, ShieldCheck, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export interface CallToastEventDetail {
  id?: string;
  callerName?: string;
  callerAvatar?: string;
  callerNumber?: string;
  type?: 'incoming' | 'connected' | 'ended' | 'missed';
  roomId?: string;
}

export default function WebRTCCallToast() {
  const [activeCall, setActiveCall] = useState<CallToastEventDetail | null>(null);
  const [callDuration, setCallDuration] = useState<number>(0);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [isVideoActive, setIsVideoActive] = useState<boolean>(true);

  useEffect(() => {
    const handleIncomingCall = (e: CustomEvent<CallToastEventDetail>) => {
      setActiveCall({
        id: e.detail?.id || 'call-' + Date.now(),
        callerName: e.detail?.callerName || 'Incoming Client Call',
        callerAvatar: e.detail?.callerAvatar || '',
        callerNumber: e.detail?.callerNumber || '+1 (800) 555-0199',
        type: e.detail?.type || 'incoming',
        roomId: e.detail?.roomId || 'general-room'
      });
      setCallDuration(0);
    };

    const handleCallConnected = (e: CustomEvent<CallToastEventDetail>) => {
      setActiveCall(prev => (prev ? { ...prev, type: 'connected' } : null));
    };

    const handleCallEnded = () => {
      setActiveCall(null);
      setCallDuration(0);
    };

    window.addEventListener('webrtc:incoming-call' as any, handleIncomingCall);
    window.addEventListener('webrtc:call-connected' as any, handleCallConnected);
    window.addEventListener('webrtc:call-ended' as any, handleCallEnded);

    return () => {
      window.removeEventListener('webrtc:incoming-call' as any, handleIncomingCall);
      window.removeEventListener('webrtc:call-connected' as any, handleCallConnected);
      window.removeEventListener('webrtc:call-ended' as any, handleCallEnded);
    };
  }, []);

  useEffect(() => {
    let timer: NodeJS.Timeout | null = null;
    if (activeCall?.type === 'connected') {
      timer = setInterval(() => {
        setCallDuration(prev => prev + 1);
      }, 1000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [activeCall?.type]);

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handleAccept = () => {
    if (activeCall) {
      setActiveCall({ ...activeCall, type: 'connected' });
      window.dispatchEvent(new CustomEvent('webrtc:accept-call', { detail: activeCall }));
    }
  };

  const handleDecline = () => {
    if (activeCall) {
      window.dispatchEvent(new CustomEvent('webrtc:decline-call', { detail: activeCall }));
      setActiveCall(null);
    }
  };

  const handleEnd = () => {
    if (activeCall) {
      window.dispatchEvent(new CustomEvent('webrtc:end-call', { detail: activeCall }));
      setActiveCall(null);
    }
  };

  const toggleMute = () => {
    setIsMuted(prev => !prev);
    window.dispatchEvent(new CustomEvent('webrtc:toggle-mute', { detail: { isMuted: !isMuted } }));
  };

  const toggleVideo = () => {
    setIsVideoActive(prev => !prev);
    window.dispatchEvent(new CustomEvent('webrtc:toggle-video', { detail: { isVideoActive: !isVideoActive } }));
  };

  if (!activeCall) return null;

  return (
    <AnimatePresence>
      <motion.div
        id="webrtc-call-toast-container"
        initial={{ opacity: 0, y: 50, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 20, scale: 0.95 }}
        className="fixed bottom-6 right-6 z-50 max-w-sm w-full bg-neutral-900 border border-neutral-700/70 rounded-2xl p-4 shadow-2xl backdrop-blur-xl text-white select-none"
      >
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-2.5">
            {activeCall.callerAvatar ? (
              <img
                src={activeCall.callerAvatar}
                alt={activeCall.callerName}
                className="w-10 h-10 rounded-full object-cover border border-neutral-700"
              />
            ) : (
              <div className="w-10 h-10 rounded-full bg-blue-600/30 border border-blue-500/40 flex items-center justify-center text-blue-400">
                <PhoneIncoming className="w-5 h-5 animate-pulse" />
              </div>
            )}
            <div>
              <div className="flex items-center gap-1.5">
                <h4 className="font-semibold text-xs text-neutral-100">{activeCall.callerName}</h4>
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              </div>
              <p className="text-[11px] text-neutral-400 font-mono">
                {activeCall.type === 'connected' ? `Live Session • ${formatDuration(callDuration)}` : activeCall.callerNumber}
              </p>
            </div>
          </div>
          <button
            onClick={() => setActiveCall(null)}
            className="p-1 text-neutral-400 hover:text-neutral-200 rounded-lg hover:bg-neutral-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {activeCall.type === 'incoming' ? (
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={handleAccept}
              className="flex-1 flex items-center justify-center gap-2 py-2 px-3 bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs rounded-xl shadow-lg transition-all"
            >
              <Phone className="w-3.5 h-3.5" />
              <span>Accept Call</span>
            </button>
            <button
              onClick={handleDecline}
              className="flex-1 flex items-center justify-center gap-2 py-2 px-3 bg-rose-600 hover:bg-rose-500 text-white font-medium text-xs rounded-xl shadow-lg transition-all"
            >
              <PhoneOff className="w-3.5 h-3.5" />
              <span>Decline</span>
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2 pt-1 border-t border-neutral-800 mt-2">
            <div className="flex items-center gap-1.5">
              <button
                onClick={toggleMute}
                className={`p-2 rounded-xl transition-colors ${
                  isMuted ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30' : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
                }`}
                title={isMuted ? 'Unmute microphone' : 'Mute microphone'}
              >
                {isMuted ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
              </button>
              <button
                onClick={toggleVideo}
                className={`p-2 rounded-xl transition-colors ${
                  !isVideoActive ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30' : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
                }`}
                title={!isVideoActive ? 'Turn on video' : 'Turn off video'}
              >
                <Video className="w-3.5 h-3.5" />
              </button>
            </div>
            <button
              onClick={handleEnd}
              className="flex items-center gap-1.5 py-1.5 px-3 bg-rose-600 hover:bg-rose-500 text-white font-medium text-xs rounded-xl transition-all shadow-md"
            >
              <PhoneOff className="w-3.5 h-3.5" />
              <span>End Call</span>
            </button>
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  );
}
