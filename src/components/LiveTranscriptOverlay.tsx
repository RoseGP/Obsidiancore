import React, { useState, useEffect } from 'react';
import { Sparkles, Volume2, Mic } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { onLiveTranscriptReceived } from '../utils/app';

interface LiveTranscriptOverlayProps {
  position?: 'bottom-center' | 'top-center' | 'bottom-left' | 'bottom-right';
  activeSpeaker?: string;
  className?: string;
}

export interface LiveTranscriptItem {
  id: string;
  speaker: string;
  text: string;
  timestamp: string;
  confidence?: number;
}

export default function LiveTranscriptOverlay({
  position = 'bottom-center',
  activeSpeaker = 'Speaker',
  className = ''
}: LiveTranscriptOverlayProps) {
  const [currentCaption, setCurrentCaption] = useState<LiveTranscriptItem | null>({
    id: 'initial',
    speaker: activeSpeaker,
    text: "Let's ensure the WebRTC encrypted telemetry and real-time audio sync smoothly.",
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    confidence: 0.98
  });
  const [isVisible, setIsVisible] = useState<boolean>(true);

  useEffect(() => {
    // Listen to real-time socket-streamed transcripts if available
    const unsubscribe = onLiveTranscriptReceived?.((data: any) => {
      if (data && data.text) {
        setCurrentCaption({
          id: `trans-${Date.now()}`,
          speaker: data.speaker || activeSpeaker,
          text: data.text,
          timestamp: data.timestamp || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          confidence: data.confidence || 0.95
        });
        setIsVisible(true);
      }
    });

    // Also support window custom events for flexibility
    const handleTranscriptEvent = (e: CustomEvent<any>) => {
      if (e.detail && e.detail.text) {
        setCurrentCaption({
          id: `trans-${Date.now()}`,
          speaker: e.detail.speaker || activeSpeaker,
          text: e.detail.text,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          confidence: e.detail.confidence || 0.96
        });
        setIsVisible(true);
      }
    };

    window.addEventListener('webrtc:live-transcript' as any, handleTranscriptEvent);

    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
      window.removeEventListener('webrtc:live-transcript' as any, handleTranscriptEvent);
    };
  }, [activeSpeaker]);

  // Position class mapping
  const positionClasses = {
    'bottom-center': 'bottom-6 left-1/2 -translate-x-1/2',
    'top-center': 'top-6 left-1/2 -translate-x-1/2',
    'bottom-left': 'bottom-6 left-6',
    'bottom-right': 'bottom-6 right-6'
  }[position] || 'bottom-6 left-1/2 -translate-x-1/2';

  if (!currentCaption || !isVisible) return null;

  return (
    <div className={`absolute z-20 pointer-events-none ${positionClasses} ${className}`}>
      <AnimatePresence mode="wait">
        <motion.div
          key={currentCaption.id + currentCaption.text}
          initial={{ opacity: 0, y: 8, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -4, scale: 0.98 }}
          transition={{ duration: 0.2 }}
          className="max-w-xl mx-auto px-4 py-2 rounded-2xl bg-neutral-950/80 border border-white/10 backdrop-blur-xl shadow-2xl text-center select-none"
        >
          <div className="flex items-center justify-center gap-2 mb-1">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 font-bold text-[10px] uppercase tracking-wider border border-blue-500/30">
              <Sparkles className="w-2.5 h-2.5" />
              <span>AI Live Captions</span>
            </span>
            <span className="text-[11px] font-semibold text-neutral-300 flex items-center gap-1">
              <Mic className="w-3 h-3 text-emerald-400 animate-pulse" />
              {currentCaption.speaker}
            </span>
          </div>
          <p className="text-xs md:text-sm font-medium text-white/95 leading-relaxed tracking-wide drop-shadow-sm">
            {currentCaption.text}
          </p>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
