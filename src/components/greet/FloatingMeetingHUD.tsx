import React from 'react';
import { Video, Mic, MicOff, PhoneOff, ArrowUpRight, Users, Clock, Shield } from 'lucide-react';
import { useMeetingSession } from '../../context/MeetingSessionContext';

interface FloatingMeetingHUDProps {
  onReturnToMeeting: () => void;
}

export default function FloatingMeetingHUD({ onReturnToMeeting }: FloatingMeetingHUDProps) {
  const {
    activeMeeting,
    isCallActive,
    isMicMuted,
    isCamOff,
    toggleMic,
    toggleCam,
    leaveMeeting,
    returnToMeeting
  } = useMeetingSession();

  if (!isCallActive || !activeMeeting) {
    return null;
  }

  const formatTimer = (totalSeconds: number) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handleReturn = () => {
    returnToMeeting();
    onReturnToMeeting();
  };

  return (
    <div className="fixed bottom-6 left-6 z-50 animate-in fade-in slide-in-from-bottom-4 duration-200">
      <div className="flex items-center gap-3 px-4 py-2.5 rounded-2xl bg-slate-900/95 border border-indigo-500/40 shadow-2xl shadow-black/80 backdrop-blur-xl text-white">
        
        {/* Pulsing Live Call Dot */}
        <div className="flex items-center gap-2">
          <span className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
          </span>
          <div className="flex flex-col">
            <span className="text-xs font-bold text-white truncate max-w-[160px] sm:max-w-[200px]">
              {activeMeeting.title}
            </span>
            <div className="flex items-center gap-1.5 text-[10px] text-neutral-400 font-mono">
              <Clock className="h-2.5 w-2.5 text-indigo-400" />
              <span>{formatTimer(activeMeeting.durationSeconds)}</span>
              <span>•</span>
              <Users className="h-2.5 w-2.5 text-indigo-400" />
              <span>{activeMeeting.participants.length + 1}</span>
            </div>
          </div>
        </div>

        {/* Quick Media Hardware Controls */}
        <div className="flex items-center gap-1.5 pl-2 border-l border-white/10">
          <button
            onClick={toggleMic}
            className={`p-1.5 rounded-lg text-xs transition-colors cursor-pointer ${
              isMicMuted ? 'bg-rose-600 text-white' : 'bg-neutral-800 hover:bg-neutral-700 text-emerald-400'
            }`}
            title={isMicMuted ? "Unmute Mic" : "Mute Mic"}
          >
            {isMicMuted ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
          </button>

          <button
            onClick={toggleCam}
            className={`p-1.5 rounded-lg text-xs transition-colors cursor-pointer ${
              isCamOff ? 'bg-rose-600 text-white' : 'bg-neutral-800 hover:bg-neutral-700 text-indigo-400'
            }`}
            title={isCamOff ? "Turn On Cam" : "Turn Off Cam"}
          >
            <Video className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Action: Return to Meeting */}
        <button
          onClick={handleReturn}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs shadow-md transition-all cursor-pointer active:scale-95 ml-1"
        >
          <span>Return</span>
          <ArrowUpRight className="h-3.5 w-3.5" />
        </button>

        {/* Action: Leave */}
        <button
          onClick={leaveMeeting}
          className="p-1.5 rounded-lg bg-neutral-800 hover:bg-rose-600 text-neutral-400 hover:text-white transition-colors cursor-pointer"
          title="Leave Meeting"
        >
          <PhoneOff className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
