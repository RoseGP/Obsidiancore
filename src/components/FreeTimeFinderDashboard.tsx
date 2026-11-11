import React, { useState, useMemo, useEffect } from 'react';
import { 
  ScheduleInterval, 
  FreeTimeSlot, 
  findMutualFreeTime, 
  minsToTimeStr 
} from '../utils/employeeFreeTimeSweepline';
import { 
  CalendarDays, 
  Clock, 
  Users, 
  Sparkles, 
  Plus, 
  CheckCircle2, 
  MapPin, 
  Sliders, 
  Zap, 
  Code, 
  Play, 
  Pause, 
  ChevronRight,
  ShieldCheck,
  Video
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface FreeTimeFinderDashboardProps {
  onAddCalendarEvent?: (newEvent: any) => void;
}

const INITIAL_TEAM_SCHEDULES: Record<string, ScheduleInterval[]> = {
  u1: [
    { id: "u1-1", userId: "u1", userName: "Camelia Rose (Host)", title: "SLA Client Alignment", start: 540, end: 630 }, // 09:00 - 10:30
    { id: "u1-2", userId: "u1", userName: "Camelia Rose (Host)", title: "Product Strategy Sync", start: 720, end: 810 }, // 12:00 - 01:30
    { id: "u1-3", userId: "u1", userName: "Camelia Rose (Host)", title: "Architecture Review", start: 930, end: 1020 }, // 03:30 - 05:00
  ],
  u2: [
    { id: "u2-1", userId: "u2", userName: "Dr. Marcus Aurelius", title: "Contract Legal Audit", start: 510, end: 600 }, // 08:30 - 10:00
    { id: "u2-2", userId: "u2", userName: "Dr. Marcus Aurelius", title: "Enterprise Executive Call", start: 660, end: 750 }, // 11:00 - 12:30
    { id: "u2-3", userId: "u2", userName: "Dr. Marcus Aurelius", title: "Compliance Review", start: 840, end: 900 }, // 02:00 - 03:00
  ],
  u3: [
    { id: "u3-1", userId: "u3", userName: "Kate Smith", title: "Client Onboarding Demo", start: 570, end: 690 }, // 09:30 - 11:30
    { id: "u3-2", userId: "u3", userName: "Kate Smith", title: "Sales Pipeline Handoff", start: 810, end: 870 }, // 01:30 - 02:30
    { id: "u3-3", userId: "u3", userName: "Kate Smith", title: "WebRTC Demo Pre-Check", start: 960, end: 1050 }, // 04:00 - 05:30
  ],
  u4: [
    { id: "u4-1", userId: "u4", userName: "Rochelle Vance", title: "UX Wireframe Critique", start: 600, end: 660 }, // 10:00 - 11:00
    { id: "u4-2", userId: "u4", userName: "Rochelle Vance", title: "Design System Sprint", start: 780, end: 840 }, // 01:00 - 02:00
  ]
};

// TO COMPLETE: load team members and their calendars (Google Calendar free/busy API).
const TEAM_MEMBERS = [] as any[];

export default function FreeTimeFinderDashboard({ onAddCalendarEvent }: FreeTimeFinderDashboardProps) {
  // Starts empty; members come from your team store (see TEAM_MEMBERS).
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [minDuration, setMinDuration] = useState<number>(30); // 30 mins, 45 mins, 60 mins
  const [isSweeping, setIsSweeping] = useState<boolean>(true);
  const [sweepPosition, setSweepPosition] = useState<number>(480); // 480 mins = 08:00 AM
  const [bookedSlotIds, setBookedSlotIds] = useState<string[]>([]);
  const [bookingToast, setBookingToast] = useState<string | null>(null);

  const WORK_START = 480;  // 08:00 AM
  const WORK_END = 1080;   // 06:00 PM
  const TOTAL_WORK_MINS = WORK_END - WORK_START; // 600 minutes

  // Filter schedules based on selected team members
  const filteredSchedules = useMemo(() => {
    const activeSchedules: Record<string, ScheduleInterval[]> = {};
    selectedUserIds.forEach(id => {
      if (INITIAL_TEAM_SCHEDULES[id]) {
        activeSchedules[id] = INITIAL_TEAM_SCHEDULES[id];
      }
    });
    return activeSchedules;
  }, [selectedUserIds]);

  // Run Sweepline algorithm O(N log N)
  const result = useMemo(() => {
    return findMutualFreeTime(
      filteredSchedules, 
      { start: WORK_START, end: WORK_END }, 
      minDuration
    );
  }, [filteredSchedules, minDuration]);

  // Animated Sweepline Scanner effect across time timeline
  useEffect(() => {
    if (!isSweeping) return;

    const interval = setInterval(() => {
      setSweepPosition(prev => {
        if (prev >= WORK_END) return WORK_START;
        return prev + 10;
      });
    }, 120);

    return () => clearInterval(interval);
  }, [isSweeping]);

  // Toggle user inclusion in mutual availability sweep
  const toggleUser = (userId: string) => {
    if (selectedUserIds.includes(userId)) {
      if (selectedUserIds.length > 1) {
        setSelectedUserIds(prev => prev.filter(id => id !== userId));
      }
    } else {
      setSelectedUserIds(prev => [...prev, userId]);
    }
  };

  // 1-Click Booking of Mutual Free Time Slot
  const handleBookSlot = (slot: FreeTimeSlot) => {
    const title = `Mutual Sync (${selectedUserIds.length} Team Members)`;
    const timeStr = `${minsToTimeStr(slot.start)} - ${minsToTimeStr(slot.end)}`;
    // Booked as a GREET meeting on the server (the join link comes from the server, not made up here).
    const d = new Date(); const pad = (n: number) => String(n).padStart(2, '0');
    const today = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const newEvent = {
      title,
      date: today,
      time: `${today} ${minsToTimeStr(slot.start)}`,
      duration: Math.max(5, slot.end - slot.start),
      type: "call",
      contact: "Selected Team Members",
      status: "upcoming",
      invitees: selectedUserIds.map(id => TEAM_MEMBERS.find(m => m.id === id)?.name).join(", "),
      notes: `Booked from the free time finder (${timeStr}).`
    };

    if (onAddCalendarEvent) {
      onAddCalendarEvent(newEvent);
    }

    setBookedSlotIds(prev => [...prev, slot.id]);
    setBookingToast(`GREET meeting requested for ${timeStr}.`);
    setTimeout(() => setBookingToast(null), 4500);
  };

  return (
    <div className="bg-white rounded-3xl border border-neutral-200 p-6 shadow-xl space-y-6 text-left font-sans">
      
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-neutral-200 pb-5">
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 rounded-2xl bg-emerald-600 text-white flex items-center justify-center shadow-md shadow-emerald-600/20 shrink-0">
            <CalendarDays className="h-6 w-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-extrabold text-neutral-900 tracking-tight">
                Multi-User Meeting Room Search & Free Time Finder
              </h2>
              <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-mono font-bold px-2 py-0.5 rounded-md">
                Sweepline O(N log N)
              </span>
            </div>
            <p className="text-xs text-neutral-500 font-medium mt-0.5">
              Multi-User Calendar Interval Boundary Sweepline Algorithm
            </p>
          </div>
        </div>

        {/* Action controls */}
        <div className="flex items-center gap-2">
          {bookingToast && (
            <motion.div 
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-emerald-600 text-white text-xs font-bold px-3 py-1.5 rounded-xl flex items-center gap-1.5 shadow-sm"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span>{bookingToast}</span>
            </motion.div>
          )}

          <button 
            onClick={() => setIsSweeping(!isSweeping)}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl font-bold text-xs border transition-all cursor-pointer ${
              isSweeping 
                ? "bg-amber-50 border-amber-200 text-amber-800" 
                : "bg-emerald-50 border-emerald-200 text-emerald-800"
            }`}
          >
            {isSweeping ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            <span>{isSweeping ? "Pause Sweepline" : "Run Sweepline"}</span>
          </button>
        </div>
      </div>

      {/* Team Filter & Duration Selector */}
      <div className="bg-neutral-50 border border-neutral-200 rounded-2xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
        
        {/* Team Member Toggle Chips */}
        <div className="space-y-1">
          <span className="text-[10px] font-extrabold text-neutral-400 uppercase tracking-wider block font-mono">
            Include Team Schedules in Availability Sweep:
          </span>
          <div className="flex flex-wrap items-center gap-2">
            {TEAM_MEMBERS.map((member) => {
              const isSelected = selectedUserIds.includes(member.id);
              return (
                <button
                  key={member.id}
                  onClick={() => toggleUser(member.id)}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                    isSelected 
                      ? "bg-white border-neutral-300 text-neutral-900 shadow-xs" 
                      : "bg-neutral-200/60 border-transparent text-neutral-400 line-through"
                  }`}
                >
                  <div className={`h-4 w-4 rounded-full ${member.color} text-white text-[9px] font-black flex items-center justify-center`}>
                    {member.avatar[0]}
                  </div>
                  <span>{member.name}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Meeting Duration Picker */}
        <div className="space-y-1 shrink-0">
          <span className="text-[10px] font-extrabold text-neutral-400 uppercase tracking-wider block font-mono">
            Required Free Window:
          </span>
          <div className="flex bg-white p-1 rounded-xl border border-neutral-250 shadow-2xs">
            {[30, 45, 60, 90].map((dur) => (
              <button
                key={dur}
                onClick={() => setMinDuration(dur)}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  minDuration === dur 
                    ? "bg-emerald-600 text-white shadow" 
                    : "text-neutral-500 hover:text-neutral-900"
                }`}
              >
                {dur}m
              </button>
            ))}
          </div>
        </div>

      </div>

      {/* Visual Sweepline Timeline Display */}
      <div className="bg-neutral-900 text-white rounded-2xl p-5 shadow-lg space-y-4 relative overflow-hidden">
        
        {/* Timeline Header Hour Markers */}
        <div className="flex justify-between border-b border-neutral-800 pb-2 text-[10px] font-mono text-neutral-400">
          <span>08:00 AM</span>
          <span>10:00 AM</span>
          <span>12:00 PM</span>
          <span>02:00 PM</span>
          <span>04:00 PM</span>
          <span>06:00 PM</span>
        </div>

        {/* User Schedule Timeline Tracks */}
        <div className="space-y-3 relative">
          
          {/* Animated Sweepline Vertical Scanner Line */}
          <div 
            className="absolute top-0 bottom-0 w-0.5 bg-emerald-400 shadow-[0_0_12px_#34d399] z-20 pointer-events-none transition-all duration-75"
            style={{
              left: `${((sweepPosition - WORK_START) / TOTAL_WORK_MINS) * 100}%`
            }}
          >
            <div className="bg-emerald-400 text-neutral-950 text-[9px] font-mono font-black px-1.5 py-0.5 rounded-md -translate-x-1/2 -top-5 absolute whitespace-nowrap shadow-sm">
              {minsToTimeStr(sweepPosition)}
            </div>
          </div>

          {selectedUserIds.map((userId) => {
            const member = TEAM_MEMBERS.find(m => m.id === userId);
            if (!member) return null;
            const intervals = filteredSchedules[userId] || [];

            return (
              <div key={userId} className="space-y-1">
                <div className="flex items-center justify-between text-[11px] font-mono">
                  <span className="text-neutral-300 font-bold flex items-center gap-1.5">
                    <div className={`h-2 w-2 rounded-full ${member.color}`} />
                    {member.name} ({member.role})
                  </span>
                  <span className="text-neutral-500 text-[10px]">
                    {intervals.length} Busy Blocks
                  </span>
                </div>

                {/* Timeline Bar Track */}
                <div className="w-full bg-neutral-800/80 h-7 rounded-xl relative overflow-hidden border border-neutral-700/50">
                  {intervals.map((inv) => {
                    const leftPct = ((inv.start - WORK_START) / TOTAL_WORK_MINS) * 100;
                    const widthPct = ((inv.end - inv.start) / TOTAL_WORK_MINS) * 100;

                    return (
                      <div
                        key={inv.id}
                        className="absolute top-1 bottom-1 bg-rose-500/30 border border-rose-500/60 rounded-lg flex items-center px-2 text-[10px] font-mono text-rose-200 truncate"
                        style={{
                          left: `${leftPct}%`,
                          width: `${widthPct}%`
                        }}
                        title={`${inv.title}: ${minsToTimeStr(inv.start)} - ${minsToTimeStr(inv.end)}`}
                      >
                        <span className="truncate">{inv.title}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}

        </div>

      </div>

      {/* Sweepline Output: Suggested Mutual Free Time Slots */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-extrabold text-neutral-800 uppercase tracking-wider flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-emerald-600" />
            Auto-Suggested Mutual Free Slots ({result.freeSlots.length} Available)
          </span>
          <span className="text-[10px] text-neutral-400 font-mono">
            Boundary Comparisons: <strong className="text-emerald-600">{result.comparisonsCount}</strong>
          </span>
        </div>

        {result.freeSlots.length === 0 ? (
          <div className="text-center py-8 px-4 bg-neutral-50 rounded-2xl border border-dashed border-neutral-300">
            <Clock className="h-8 w-8 text-neutral-400 mx-auto mb-2" />
            <span className="text-xs font-bold text-neutral-700 block">No mutual free windows found for selected duration</span>
            <p className="text-[11px] text-neutral-500 mt-1">
              Try reducing required duration to 30m or deselecting a team member to expand availability.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {result.freeSlots.map((slot) => {
              const isBooked = bookedSlotIds.includes(slot.id);

              return (
                <div 
                  key={slot.id} 
                  className={`p-4 rounded-2xl border transition-all flex flex-col justify-between space-y-3 ${
                    isBooked 
                      ? "bg-emerald-50 border-emerald-300 shadow-xs" 
                      : "bg-white border-neutral-200 hover:border-emerald-500 shadow-sm"
                  }`}
                >
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-extrabold text-neutral-900 font-mono">
                        {minsToTimeStr(slot.start)} - {minsToTimeStr(slot.end)}
                      </span>
                      <span className="bg-emerald-100 text-emerald-800 text-[10px] font-bold px-2.5 py-0.5 rounded-full">
                        {slot.durationMins} Mins Free
                      </span>
                    </div>

                    <p className="text-[11px] text-neutral-500 font-sans leading-relaxed">
                      All {selectedUserIds.length} team members are mutually available.
                    </p>
                  </div>

                  {/* Available Room Badges */}
                  <div className="space-y-1 pt-1 border-t border-neutral-100">
                    <span className="text-[9px] font-bold text-neutral-400 uppercase tracking-wider block font-mono">
                      Suggested Room:
                    </span>
                    <span className="text-[10px] font-semibold text-neutral-700 flex items-center gap-1">
                      <MapPin className="h-3 w-3 text-emerald-600" />
                      {slot.availableRooms[0]}
                    </span>
                  </div>

                  <button
                    onClick={() => handleBookSlot(slot)}
                    disabled={isBooked}
                    className={`w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl font-extrabold text-xs transition-all cursor-pointer ${
                      isBooked
                        ? "bg-emerald-600 text-white opacity-80 cursor-default"
                        : "bg-neutral-900 hover:bg-neutral-800 text-white shadow-xs active:scale-95"
                    }`}
                  >
                    {isBooked ? (
                      <>
                        <CheckCircle2 className="h-3.5 w-3.5 text-white" />
                        <span>Slot Reserved</span>
                      </>
                    ) : (
                      <>
                        <Video className="h-3.5 w-3.5 text-emerald-400" />
                        <span>1-Click Book Meeting</span>
                      </>
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Algorithmic Complexity Benchmark Card */}
      <div className="bg-neutral-900 text-white rounded-2xl p-4 font-mono space-y-2 text-xs">
        <div className="flex items-center justify-between border-b border-neutral-800 pb-2">
          <span className="text-amber-400 font-bold flex items-center gap-1.5">
            <Zap className="h-4 w-4" />
            Sweepline Availability Engine Benchmark Analysis
          </span>
          <span className="text-[10px] text-neutral-400">Interval Boundary Sorting</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 text-sans font-sans">
          <div className="bg-neutral-800 p-2.5 rounded-xl border border-neutral-700">
            <span className="text-[10px] font-mono text-neutral-400 block uppercase">Sweepline Time Complexity</span>
            <strong className="text-emerald-400 font-mono text-sm">O(N log N)</strong>
            <p className="text-[11px] text-neutral-300 mt-1">
              Sorts {result.totalBusyIntervalsCount * 2} start/end event boundary points. Fast and scalable for large teams.
            </p>
          </div>

          <div className="bg-neutral-800 p-2.5 rounded-xl border border-neutral-700">
            <span className="text-[10px] font-mono text-neutral-400 block uppercase">Naive Minute Grid Search</span>
            <strong className="text-rose-400 font-mono text-sm">O(N • T)</strong>
            <p className="text-[11px] text-neutral-300 mt-1">
              Checks every 1-minute interval slice independently. Very slow on large calendar spans.
            </p>
          </div>
        </div>
      </div>

    </div>
  );
}
