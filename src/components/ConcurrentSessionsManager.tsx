import React, { useState, useMemo } from 'react';
import { 
  MeetingMinHeap, 
  ActiveMeetingSession, 
  calculateConcurrentRooms 
} from '../utils/meetingMinHeap';
import { 
  Server, 
  Activity, 
  Layers, 
  Plus, 
  Play, 
  Trash2, 
  Cpu, 
  Wifi, 
  CheckCircle2, 
  Zap, 
  Clock, 
  Code,
  Sliders
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

const INITIAL_SESSIONS: ActiveMeetingSession[] = [
  {
    id: "session-101",
    title: "Gamma Project Tech SLA Review",
    host: "Camelia Rose",
    startTime: 900,  // 09:00 AM
    endTime: 1030,   // 10:30 AM
    bandwidthMbps: 45,
    serverNode: "sfu-us-east-01",
    participantsCount: 8
  },
  {
    id: "session-102",
    title: "Enterprise Sales Pitch & Demo",
    host: "Kate Smith",
    startTime: 930,  // 09:30 AM
    endTime: 1100,   // 11:00 AM
    bandwidthMbps: 60,
    serverNode: "sfu-us-east-02",
    participantsCount: 14
  },
  {
    id: "session-103",
    title: "All-Hands Operations Briefing",
    host: "Marcus Aurelius",
    startTime: 1000, // 10:00 AM
    endTime: 1130,   // 11:30 AM
    bandwidthMbps: 120,
    serverNode: "sfu-us-east-01",
    participantsCount: 32
  },
  {
    id: "session-104",
    title: "Design System Handoff Sync",
    host: "Rochelle",
    startTime: 1115, // 11:15 AM
    endTime: 1215,   // 12:15 PM
    bandwidthMbps: 30,
    serverNode: "sfu-eu-central-01",
    participantsCount: 6
  }
];

export default function ConcurrentSessionsManager() {
  const [sessions, setSessions] = useState<ActiveMeetingSession[]>(INITIAL_SESSIONS);
  const [newSessionTitle, setNewSessionTitle] = useState("");
  const [newSessionHost, setNewSessionHost] = useState("Team Lead");
  const [newStartMins, setNewStartMins] = useState(1015);
  const [newDurationMins, setNewDurationMins] = useState(60);
  const [newBandwidth, setNewBandwidth] = useState(50);
  const [selectedServerNode, setSelectedServerNode] = useState("sfu-us-east-01");

  // Format minutes into HH:MM string
  const formatMins = (mins: number) => {
    const hours = Math.floor(mins / 100);
    const m = mins % 100;
    const hStr = hours < 10 ? `0${hours}` : `${hours}`;
    const mStr = m < 10 ? `0${m}` : `${m}`;
    return `${hStr}:${mStr}`;
  };

  // Algorithmic calculation using Min-Heap priority queue
  const metrics = useMemo(() => {
    return calculateConcurrentRooms(sessions);
  }, [sessions]);

  // Build Min-Heap representation
  const heapInstance = useMemo(() => {
    return new MeetingMinHeap(sessions);
  }, [sessions]);

  const heapArray = useMemo(() => {
    return heapInstance.toArray();
  }, [heapInstance]);

  // Handle adding new meeting session
  const handleAddSession = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSessionTitle.trim()) return;

    const startVal = Number(newStartMins);
    const durationVal = Number(newDurationMins);
    
    // Calculate end time logically
    let endMins = startVal + durationVal;
    if (endMins % 100 >= 60) {
      endMins = endMins + 40; // Convert 60 mins overflow to hour increment
    }

    const newMeeting: ActiveMeetingSession = {
      id: `session-${Date.now()}`,
      title: newSessionTitle,
      host: newSessionHost,
      startTime: startVal,
      endTime: endMins,
      bandwidthMbps: Number(newBandwidth),
      serverNode: selectedServerNode,
      participantsCount: Math.floor(Math.random() * 15) + 3
    };

    setSessions(prev => [...prev, newMeeting]);
    setNewSessionTitle("");
  };

  const handleRemoveSession = (id: string) => {
    setSessions(prev => prev.filter(s => s.id !== id));
  };

  return (
    <div className="bg-white rounded-3xl border border-neutral-200 p-6 shadow-xl space-y-6 text-left font-sans">
      
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-neutral-200 pb-5">
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 rounded-2xl bg-indigo-600 text-white flex items-center justify-center shadow-md shadow-indigo-600/20 shrink-0">
            <Server className="h-6 w-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-extrabold text-neutral-900 tracking-tight">
                Concurrent Sessions & Media Server Load Balancer
              </h2>
              <span className="bg-indigo-50 text-indigo-700 border border-indigo-200 text-[10px] font-mono font-bold px-2 py-0.5 rounded-md">
                Min-Heap O(log N)
              </span>
            </div>
            <p className="text-xs text-neutral-500 font-medium mt-0.5">
              Real-time WebRTC SFU Media Node Allocation & Dynamic Priority Queue
            </p>
          </div>
        </div>

        {/* Real-time Telemetry Cards */}
        <div className="flex items-center gap-3">
          <div className="bg-neutral-50 border border-neutral-250 px-3.5 py-2 rounded-2xl text-center shadow-2xs">
            <span className="text-[9px] font-black text-neutral-400 uppercase tracking-widest block font-mono">
              Peak Rooms Req.
            </span>
            <span className="text-lg font-black text-indigo-600 font-mono">
              {metrics.minRoomsRequired} <span className="text-xs font-normal text-neutral-500">Rooms</span>
            </span>
          </div>

          <div className="bg-neutral-50 border border-neutral-250 px-3.5 py-2 rounded-2xl text-center shadow-2xs">
            <span className="text-[9px] font-black text-neutral-400 uppercase tracking-widest block font-mono">
              Peak Bandwidth
            </span>
            <span className="text-lg font-black text-emerald-600 font-mono">
              {metrics.peakBandwidthMbps} <span className="text-xs font-normal text-neutral-500">Mbps</span>
            </span>
          </div>
        </div>
      </div>

      {/* Main Grid Section */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Column: Session Simulator & Min-Heap State */}
        <div className="lg:col-span-7 space-y-5">
          
          {/* Add Session Form */}
          <div className="bg-neutral-50 rounded-2xl border border-neutral-200 p-4 space-y-3">
            <div className="flex items-center justify-between border-b border-neutral-200 pb-2">
              <span className="text-xs font-extrabold text-neutral-800 uppercase tracking-wider flex items-center gap-1.5">
                <Plus className="h-4 w-4 text-indigo-600" />
                Simulate Concurrent Session
              </span>
              <span className="text-[10px] text-neutral-500 font-semibold">
                Inserts into Min-Heap Queue
              </span>
            </div>

            <form onSubmit={handleAddSession} className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <input 
                  type="text" 
                  value={newSessionTitle}
                  onChange={e => setNewSessionTitle(e.target.value)}
                  placeholder="Meeting Title (e.g. SLA Sync)"
                  className="w-full bg-white border border-neutral-250 rounded-xl px-3 py-1.5 text-xs font-medium text-neutral-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                  required
                />
              </div>

              <div>
                <select 
                  value={selectedServerNode}
                  onChange={e => setSelectedServerNode(e.target.value)}
                  className="w-full bg-white border border-neutral-250 rounded-xl px-2.5 py-1.5 text-xs font-semibold text-neutral-800 cursor-pointer"
                >
                  <option value="sfu-us-east-01">SFU US East 01</option>
                  <option value="sfu-us-east-02">SFU US East 02</option>
                  <option value="sfu-eu-central-01">SFU EU Central 01</option>
                </select>
              </div>

              <div>
                <label className="text-[9px] font-bold text-neutral-500 uppercase block mb-0.5">Start Time (24h)</label>
                <input 
                  type="number" 
                  value={newStartMins}
                  onChange={e => setNewStartMins(Number(e.target.value))}
                  placeholder="0930"
                  className="w-full bg-white border border-neutral-250 rounded-xl px-2.5 py-1.5 text-xs font-mono font-bold text-neutral-900"
                />
              </div>

              <div>
                <label className="text-[9px] font-bold text-neutral-500 uppercase block mb-0.5">Duration (Mins)</label>
                <input 
                  type="number" 
                  value={newDurationMins}
                  onChange={e => setNewDurationMins(Number(e.target.value))}
                  placeholder="60"
                  className="w-full bg-white border border-neutral-250 rounded-xl px-2.5 py-1.5 text-xs font-mono font-bold text-neutral-900"
                />
              </div>

              <div>
                <label className="text-[9px] font-bold text-neutral-500 uppercase block mb-0.5">Bandwidth (Mbps)</label>
                <button 
                  type="submit"
                  className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs py-1.5 rounded-xl shadow transition-all cursor-pointer flex items-center justify-center gap-1"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Add Session</span>
                </button>
              </div>
            </form>
          </div>

          {/* Active Sessions List */}
          <div className="space-y-2.5">
            <span className="text-xs font-extrabold text-neutral-700 uppercase tracking-wider block">
              Active Meeting Schedule Blocks ({sessions.length})
            </span>

            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {sessions.map((s) => (
                <div key={s.id} className="bg-neutral-50 border border-neutral-200 p-3 rounded-2xl flex items-center justify-between gap-3 hover:border-indigo-300 transition-colors">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="h-8 w-8 rounded-xl bg-indigo-100 border border-indigo-200 text-indigo-700 font-mono text-xs font-bold flex items-center justify-center shrink-0">
                      <Clock className="h-4 w-4 text-indigo-600" />
                    </div>
                    <div className="min-w-0">
                      <span className="text-xs font-bold text-neutral-900 truncate block">
                        {s.title}
                      </span>
                      <span className="text-[10px] text-neutral-500 font-mono font-semibold">
                        {formatMins(s.startTime)} - {formatMins(s.endTime)} • {s.bandwidthMbps} Mbps • {s.serverNode}
                      </span>
                    </div>
                  </div>

                  <button 
                    onClick={() => handleRemoveSession(s.id)}
                    className="p-1.5 rounded-lg text-neutral-400 hover:text-rose-600 hover:bg-rose-50 transition-colors shrink-0 cursor-pointer"
                    title="Remove session"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>

        </div>

        {/* Right Column: Priority Queue Min-Heap Visualizer & Server Distribution */}
        <div className="lg:col-span-5 space-y-5">
          
          {/* Min-Heap Priority Queue View */}
          <div className="bg-neutral-900 text-white rounded-2xl p-4 shadow-lg space-y-3 font-mono">
            <div className="flex items-center justify-between border-b border-neutral-800 pb-2">
              <span className="text-xs font-bold text-teal-400 flex items-center gap-1.5">
                <Cpu className="h-4 w-4 text-teal-400" />
                Min-Heap Priority Queue Root
              </span>
              <span className="text-[10px] text-neutral-400">
                Next Ending: {heapInstance.peek() ? formatMins(heapInstance.peek()!.endTime) : "None"}
              </span>
            </div>

            <div className="space-y-2">
              <span className="text-[10px] text-neutral-400 block uppercase">
                Heap Elements (Ordered by Earliest End Time):
              </span>

              {heapArray.length === 0 ? (
                <span className="text-xs text-neutral-500 italic block">Heap is empty</span>
              ) : (
                heapArray.map((elem, idx) => (
                  <div 
                    key={elem.id} 
                    className={`p-2 rounded-xl text-xs border flex items-center justify-between ${
                      idx === 0 
                        ? 'bg-teal-500/10 border-teal-500/40 text-teal-300 font-bold' 
                        : 'bg-neutral-800/60 border-neutral-700/50 text-neutral-300'
                    }`}
                  >
                    <span className="truncate max-w-[160px]">
                      {idx === 0 ? '👑 Root: ' : `#${idx}: `}{elem.title}
                    </span>
                    <span className="text-[11px] font-bold">
                      End: {formatMins(elem.endTime)}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Server Node Load Distribution */}
          <div className="bg-neutral-50 border border-neutral-200 rounded-2xl p-4 space-y-3">
            <span className="text-xs font-extrabold text-neutral-800 uppercase tracking-wider block">
              Media Server Node Distribution
            </span>

            <div className="space-y-2">
              {Object.entries(metrics.serverNodeDistribution).map(([node, count]) => (
                <div key={node} className="space-y-1">
                  <div className="flex justify-between text-xs font-semibold">
                    <span className="text-neutral-700 font-mono">{node}</span>
                    <span className="text-indigo-600 font-bold">{count} Streams</span>
                  </div>
                  <div className="w-full bg-neutral-200 h-2 rounded-full overflow-hidden">
                    <div 
                      className="bg-indigo-600 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${Math.min(100, (count / sessions.length) * 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

        </div>

      </div>

    </div>
  );
}
