import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  TopKSpeakerHeap, 
  SpeakerParticipant, 
  selectTopKActiveSpeakers 
} from '../utils/activeSpeakerMinHeap';
import { 
  Volume2, 
  VolumeX, 
  Mic, 
  MicOff, 
  Grid, 
  Zap, 
  Cpu, 
  Activity, 
  Play, 
  Pause, 
  User, 
  Crown, 
  Sparkles,
  Sliders,
  Maximize2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// TO COMPLETE: participants come from the live meeting room (LiveKit room.participants).
const INITIAL_PARTICIPANTS: SpeakerParticipant[] = [];

export default function ActiveSpeakerGalleryGrid() {
  const [participants, setParticipants] = useState<SpeakerParticipant[]>(INITIAL_PARTICIPANTS);
  const [kGridSize, setKGridSize] = useState<number>(4); // K = 4 or K = 9
  const [isSimulatingAudio, setIsSimulatingAudio] = useState<boolean>(true);
  const [frameCounter, setFrameCounter] = useState<number>(0);

  // Audio decibel streaming simulation loop
  useEffect(() => {
    if (!isSimulatingAudio) return;

    const interval = setInterval(() => {
      setParticipants(prev => 
        prev.map(p => {
          if (p.isMuted) return p;
          // Random decibel fluctuation simulating WebRTC AudioWorklet meter frames
          const noise = Math.floor(Math.random() * 40) - 20;
          const newLevel = Math.max(0, Math.min(100, p.audioLevel + noise));
          return { ...p, audioLevel: newLevel };
        })
      );
      setFrameCounter(f => f + 1);
    }, 600); // 600ms audio stream interval

    return () => clearInterval(interval);
  }, [isSimulatingAudio]);

  // Execute Size-K Min-Heap algorithm on every audio frame
  const topKResult = useMemo(() => {
    return selectTopKActiveSpeakers(participants, kGridSize);
  }, [participants, kGridSize]);

  const topKSpeakers = topKResult.topKSpeakers;
  const heapState = topKResult.heapState;

  // Toggle Mute
  const handleToggleMute = (id: string) => {
    setParticipants(prev => 
      prev.map(p => p.id === id ? { ...p, isMuted: !p.isMuted, audioLevel: p.isMuted ? 50 : 0 } : p)
    );
  };

  return (
    <div className="bg-neutral-900 text-white rounded-3xl p-6 shadow-2xl border border-neutral-800 space-y-6 text-left font-sans">
      
      {/* Header Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-neutral-800 pb-5">
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-600 text-white flex items-center justify-center shadow-md shadow-blue-500/20 shrink-0">
            <Volume2 className="h-6 w-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-extrabold text-white tracking-tight">
                Real-Time Active Speaker Gallery Engine
              </h2>
              <span className="bg-blue-500/20 border border-blue-500/40 text-blue-400 text-[10px] font-mono font-bold px-2 py-0.5 rounded-md">
                Min-Heap Size K={kGridSize} • O(N log K)
              </span>
            </div>
            <p className="text-xs text-neutral-400 font-medium mt-0.5">
              Bounded Size-K Min-Heap • WebRTC AudioWorklet Decibel Grid
            </p>
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-2.5">
          <div className="flex bg-neutral-800 p-1 rounded-xl border border-neutral-700">
            <button 
              onClick={() => setKGridSize(4)}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                kGridSize === 4 ? "bg-blue-600 text-white shadow" : "text-neutral-400 hover:text-white"
              }`}
            >
              Top 4 Grid
            </button>
            <button 
              onClick={() => setKGridSize(6)}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                kGridSize === 6 ? "bg-blue-600 text-white shadow" : "text-neutral-400 hover:text-white"
              }`}
            >
              Top 6 Grid
            </button>
          </div>

          <button 
            onClick={() => setIsSimulatingAudio(!isSimulatingAudio)}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl font-bold text-xs border transition-all cursor-pointer ${
              isSimulatingAudio 
                ? "bg-amber-500/20 border-amber-500/40 text-amber-300" 
                : "bg-emerald-500/20 border-emerald-500/40 text-emerald-300"
            }`}
          >
            {isSimulatingAudio ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            <span>{isSimulatingAudio ? "Pause Stream" : "Live Stream"}</span>
          </button>
        </div>
      </div>

      {/* Main Grid View: Active Top-K Gallery Cards */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-extrabold text-neutral-300 uppercase tracking-wider flex items-center gap-2 font-mono">
            <Grid className="h-4 w-4 text-blue-400" />
            Active Video Gallery Grid (Top {kGridSize} Loudest Speakers)
          </span>
          <span className="text-[10px] text-neutral-400 font-mono">
            Audio Stream Frames Evaluated: <strong className="text-blue-400">{frameCounter}</strong>
          </span>
        </div>

        {/* Dynamic Video Tiles (Layout animations powered by motion) */}
        <div className={`grid gap-4 ${kGridSize === 4 ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"}`}>
          <AnimatePresence mode="popLayout">
            {topKSpeakers.map((speaker, rankIdx) => (
              <motion.div
                key={speaker.id}
                layout
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ type: "spring", stiffness: 300, damping: 25 }}
                className="bg-neutral-800/80 border border-neutral-700/80 rounded-2xl p-4 relative overflow-hidden flex flex-col justify-between h-44 shadow-lg group hover:border-blue-500/60 transition-colors"
              >
                {/* Active Speaker Glow Border when decibels high */}
                <div 
                  className="absolute inset-0 rounded-2xl border-2 border-emerald-500/0 pointer-events-none transition-all duration-300"
                  style={{
                    borderColor: speaker.audioLevel > 60 ? `rgba(16, 185, 129, ${speaker.audioLevel / 100})` : 'transparent',
                    boxShadow: speaker.audioLevel > 60 ? `0 0 15px rgba(16, 185, 129, 0.3)` : 'none'
                  }}
                />

                {/* Top Badge Info */}
                <div className="flex items-center justify-between relative z-10">
                  <span className="bg-neutral-900/80 backdrop-blur-sm text-neutral-300 text-[10px] font-mono font-bold px-2.5 py-1 rounded-full border border-neutral-700/60 flex items-center gap-1.5">
                    {rankIdx === 0 && <Crown className="h-3 w-3 text-amber-400 fill-amber-400" />}
                    Rank #{rankIdx + 1}
                  </span>

                  <button 
                    onClick={() => handleToggleMute(speaker.id)}
                    className={`p-1.5 rounded-lg border transition-all cursor-pointer ${
                      speaker.isMuted 
                        ? "bg-rose-500/20 border-rose-500/40 text-rose-400" 
                        : "bg-neutral-900/80 border-neutral-700 text-neutral-300 hover:text-white"
                    }`}
                  >
                    {speaker.isMuted ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
                  </button>
                </div>

                {/* Avatar & Participant Info */}
                <div className="flex items-center gap-3 relative z-10 my-auto">
                  <div className={`h-12 w-12 rounded-2xl ${speaker.avatarColor || 'bg-blue-600'} text-white font-black text-sm flex items-center justify-center shadow-md shrink-0`}>
                    {speaker.img}
                  </div>
                  <div className="min-w-0">
                    <h4 className="text-sm font-extrabold text-white truncate">
                      {speaker.name}
                    </h4>
                    <span className="text-[11px] text-neutral-400 font-medium truncate block">
                      {speaker.role}
                    </span>
                  </div>
                </div>

                {/* Decibel Audio Meter Bar */}
                <div className="space-y-1 relative z-10">
                  <div className="flex justify-between text-[10px] font-mono text-neutral-400">
                    <span className="flex items-center gap-1">
                      <Activity className="h-3 w-3 text-emerald-400" />
                      Audio Level
                    </span>
                    <span className="font-bold text-emerald-400">{speaker.audioLevel} dB</span>
                  </div>
                  <div className="w-full bg-neutral-900 h-2 rounded-full overflow-hidden p-0.5 border border-neutral-700/50">
                    <div 
                      className={`h-full rounded-full transition-all duration-300 ${
                        speaker.audioLevel > 75 
                          ? "bg-gradient-to-r from-emerald-500 to-amber-400" 
                          : "bg-emerald-500"
                      }`}
                      style={{ width: `${speaker.audioLevel}%` }}
                    />
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>

      {/* Heap State & Algorithmic Telemetry */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
        
        {/* Min-Heap Raw Structure */}
        <div className="bg-neutral-950 border border-neutral-800 rounded-2xl p-4 font-mono space-y-2.5">
          <div className="flex items-center justify-between border-b border-neutral-800 pb-2">
            <span className="text-xs font-bold text-blue-400 flex items-center gap-1.5">
              <Cpu className="h-4 w-4" />
              Size-K Min-Heap Internal Array
            </span>
            <span className="text-[10px] text-neutral-400">
              Heap Root = K-th Speaker
            </span>
          </div>

          <div className="space-y-1.5">
            {heapState.map((hItem, hIdx) => (
              <div 
                key={hItem.id}
                className={`p-2 rounded-xl text-xs flex items-center justify-between border ${
                  hIdx === 0 
                    ? "bg-blue-500/10 border-blue-500/40 text-blue-300 font-bold" 
                    : "bg-neutral-900 border-neutral-800 text-neutral-300"
                }`}
              >
                <span className="truncate max-w-[180px]">
                  {hIdx === 0 ? "👑 Root (Min K-th Loudest): " : `Node [${hIdx}]: `}{hItem.name}
                </span>
                <span className="font-bold text-emerald-400">{hItem.audioLevel} dB</span>
              </div>
            ))}
          </div>
        </div>

        {/* Algorithm Complexity Analysis Box */}
        <div className="bg-neutral-950 border border-neutral-800 rounded-2xl p-4 font-mono space-y-2.5">
          <span className="text-xs font-bold text-amber-400 flex items-center gap-1.5 border-b border-neutral-800 pb-2">
            <Zap className="h-4 w-4" />
            Top-K Active Speaker Benchmark vs Full Sort
          </span>

          <div className="space-y-2 text-xs text-neutral-300 font-sans">
            <div className="flex justify-between items-center bg-neutral-900 p-2 rounded-xl border border-neutral-800">
              <span className="text-neutral-400 font-mono text-[11px]">Min-Heap Time:</span>
              <strong className="text-emerald-400 font-mono">O(N log K)</strong>
            </div>

            <div className="flex justify-between items-center bg-neutral-900 p-2 rounded-xl border border-neutral-800">
              <span className="text-neutral-400 font-mono text-[11px]">Naive Array Sort:</span>
              <strong className="text-rose-400 font-mono">O(N log N)</strong>
            </div>

            <p className="text-[11px] text-neutral-400 leading-relaxed font-sans pt-1">
              For a 100-participant WebRTC call at 60 FPS, Min-Heap requires only <strong className="text-white">~200 operations/frame</strong> compared to <strong className="text-white">~664 operations/frame</strong> with standard array sorting.
            </p>
          </div>
        </div>

      </div>

    </div>
  );
}
