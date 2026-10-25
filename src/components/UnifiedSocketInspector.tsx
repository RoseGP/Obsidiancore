import React, { useState, useEffect } from 'react';
import { useUnifiedSocket, UserPresence } from '../hooks/useUnifiedSocket';
import { Wifi, Radio, Calendar, UserCheck, Activity, Send, CheckCircle2, ShieldCheck, Zap } from 'lucide-react';

export const UnifiedSocketInspector: React.FC = () => {
  const {
    isConnected,
    socketId,
    activeUsers,
    webrtc,
    schedule,
    presence
  } = useUnifiedSocket();

  const [activeTab, setActiveTab] = useState<'webrtc' | 'schedule' | 'presence' | 'logs'>('webrtc');
  const [logs, setLogs] = useState<{ id: string; time: string; type: string; message: string }[]>([]);

  // WebRTC form state
  const [targetSocket, setTargetSocket] = useState('');
  const [roomId, setRoomId] = useState('crm-room-101');
  const [offerSdp, setOfferSdp] = useState('v=0\r\no=- 42 2 IN IP4 127.0.0.1\r\ns=MultiplexedWebRTC');

  // Schedule form state
  const [meetingId, setMeetingId] = useState('meet_2026_x101');
  const [slotDate, setSlotDate] = useState(new Date().toISOString().split('T')[0]);
  const [slotTime, setSlotTime] = useState('14:30');

  // Presence form state
  const [customStatus, setCustomStatus] = useState<'online' | 'busy'>('online');
  const [meetingNote, setMeetingNote] = useState('Executive Strategy Review');

  const addLog = (type: string, message: string) => {
    const entry = {
      id: Math.random().toString(36).substring(2, 9),
      time: new Date().toLocaleTimeString(),
      type,
      message
    };
    setLogs(prev => [entry, ...prev].slice(0, 50));
  };

  useEffect(() => {
    // Listen to WebRTC events
    const unsubOffer = webrtc.onOffer((data) => {
      addLog('WEBRTC:OFFER', `Received SDP Offer from ${data.senderUserId || data.senderSocketId}`);
    });
    const unsubAnswer = webrtc.onAnswer((data) => {
      addLog('WEBRTC:ANSWER', `Received SDP Answer from ${data.senderUserId || data.senderSocketId}`);
    });
    const unsubIce = webrtc.onIceCandidate((data) => {
      addLog('WEBRTC:ICE', `Received ICE Candidate from ${data.senderUserId || data.senderSocketId}`);
    });

    // Listen to Schedule events
    const unsubSched = schedule.onScheduleUpdated((data) => {
      addLog('SCHEDULE:UPDATED', `Meeting ${data.meetingId} updated by ${data.updatedBy}`);
    });
    const unsubSlot = schedule.onSlotBooked((data) => {
      addLog('SCHEDULE:SLOT_BOOKED', `Slot ${data.slotId} booked on ${data.date} at ${data.time}`);
    });

    // Listen to Presence events
    const unsubOnline = presence.onUserOnline((data) => {
      addLog('PRESENCE:ONLINE', `User ${data.name} (${data.userId}) is ONLINE`);
    });
    const unsubBusy = presence.onUserBusy((data) => {
      addLog('PRESENCE:BUSY', `User ${data.name} (${data.userId}) is BUSY`);
    });

    return () => {
      unsubOffer();
      unsubAnswer();
      unsubIce();
      unsubSched();
      unsubSlot();
      unsubOnline();
      unsubBusy();
    };
  }, [webrtc, schedule, presence]);

  // Actions
  const handleSendOffer = () => {
    webrtc.sendOffer({
      roomId,
      targetSocketId: targetSocket || undefined,
      offer: { type: 'offer', sdp: offerSdp }
    });
    addLog('EMIT:rtc:offer', `Dispatched SDP offer for room ${roomId}`);
  };

  const handleSendAnswer = () => {
    webrtc.sendAnswer({
      roomId,
      targetSocketId: targetSocket || undefined,
      answer: { type: 'answer', sdp: 'v=0\r\no=- 99 2 IN IP4 127.0.0.1' }
    });
    addLog('EMIT:rtc:answer', `Dispatched SDP answer for room ${roomId}`);
  };

  const handleSendIce = () => {
    webrtc.sendIceCandidate({
      roomId,
      targetSocketId: targetSocket || undefined,
      candidate: { candidate: 'candidate:1 1 UDP 2013266431 127.0.0.1 50000 typ host', sdpMid: '0' }
    });
    addLog('EMIT:rtc:ice-candidate', `Dispatched ICE candidate for room ${roomId}`);
  };

  const handleUpdateSchedule = () => {
    schedule.updateSchedule({
      meetingId,
      updatedBy: 'Unified Agent',
      changes: { status: 'RESCHEDULED', date: slotDate, time: slotTime }
    });
    addLog('EMIT:schedule:updated', `Dispatched schedule update for ${meetingId}`);
  };

  const handleBookSlot = () => {
    schedule.bookSlot({
      slotId: `slot_${Date.now().toString().slice(-4)}`,
      date: slotDate,
      time: slotTime,
      bookedBy: 'Lead Prospect'
    });
    addLog('EMIT:slot:booked', `Dispatched slot booking for ${slotDate} ${slotTime}`);
  };

  const handleSetOnline = () => {
    presence.setOnline();
    addLog('EMIT:user:online', `Marked current user ONLINE`);
  };

  const handleSetBusy = () => {
    presence.setBusy({ currentMeetingId: meetingNote });
    addLog('EMIT:user:busy', `Marked current user BUSY [${meetingNote}]`);
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 max-w-5xl mx-auto my-6 text-slate-800">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between border-b border-slate-100 pb-4 mb-6 gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 bg-indigo-50 text-indigo-600 rounded-lg">
              <Zap className="w-5 h-5" />
            </span>
            <h2 className="text-xl font-bold tracking-tight text-slate-900">Unified Real-Time Connection Multiplexer</h2>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Collapses WebRTC Signaling, Schedule Updates, and User Presence into 1 single Socket.io connection.
          </p>
        </div>

        {/* Connection Status Badge */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            {isConnected ? `Connected: ${socketId?.substring(0, 10)}...` : 'Connecting...'}
          </div>

          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600">
            <ShieldCheck className="w-3.5 h-3.5 text-indigo-500" />
            JWT Authenticated Handshake
          </div>
        </div>
      </div>

      {/* Feature Module Tabs */}
      <div className="flex border-b border-slate-200 mb-6 gap-2">
        <button
          onClick={() => setActiveTab('webrtc')}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'webrtc'
              ? 'border-indigo-600 text-indigo-600 bg-indigo-50/50 rounded-t-lg'
              : 'border-transparent text-slate-600 hover:text-slate-900'
          }`}
        >
          <Radio className="w-4 h-4" />
          WebRTC Signaling
        </button>

        <button
          onClick={() => setActiveTab('schedule')}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'schedule'
              ? 'border-indigo-600 text-indigo-600 bg-indigo-50/50 rounded-t-lg'
              : 'border-transparent text-slate-600 hover:text-slate-900'
          }`}
        >
          <Calendar className="w-4 h-4" />
          Calendar & Schedule
        </button>

        <button
          onClick={() => setActiveTab('presence')}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'presence'
              ? 'border-indigo-600 text-indigo-600 bg-indigo-50/50 rounded-t-lg'
              : 'border-transparent text-slate-600 hover:text-slate-900'
          }`}
        >
          <UserCheck className="w-4 h-4" />
          User Presence ({activeUsers.length})
        </button>

        <button
          onClick={() => setActiveTab('logs')}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'logs'
              ? 'border-indigo-600 text-indigo-600 bg-indigo-50/50 rounded-t-lg'
              : 'border-transparent text-slate-600 hover:text-slate-900'
          }`}
        >
          <Activity className="w-4 h-4" />
          Event Stream Log ({logs.length})
        </button>
      </div>

      {/* Tab 1: WebRTC Signaling */}
      {activeTab === 'webrtc' && (
        <div className="space-y-4">
          <p className="text-xs text-slate-500">
            Multiplexes WebRTC SDP offers, answers, and ICE candidate events over the single socket session.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Target Room ID</label>
              <input
                type="text"
                value={roomId}
                onChange={(e) => setRoomId(e.target.value)}
                className="w-full text-xs p-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Target Socket ID (Optional)</label>
              <input
                type="text"
                placeholder="Direct socket peer targeting"
                value={targetSocket}
                onChange={(e) => setTargetSocket(e.target.value)}
                className="w-full text-xs p-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">SDP Payload</label>
            <textarea
              rows={2}
              value={offerSdp}
              onChange={(e) => setOfferSdp(e.target.value)}
              className="w-full text-xs p-2.5 border border-slate-200 rounded-lg font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div className="flex flex-wrap gap-3 pt-2">
            <button
              onClick={handleSendOffer}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-xs font-semibold hover:bg-indigo-700 transition-colors"
            >
              <Send className="w-3.5 h-3.5" />
              Emit rtc:offer
            </button>

            <button
              onClick={handleSendAnswer}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg text-xs font-semibold hover:bg-emerald-700 transition-colors"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              Emit rtc:answer
            </button>

            <button
              onClick={handleSendIce}
              className="flex items-center gap-2 px-4 py-2 bg-slate-800 text-white rounded-lg text-xs font-semibold hover:bg-slate-900 transition-colors"
            >
              <Radio className="w-3.5 h-3.5" />
              Emit rtc:ice-candidate
            </button>
          </div>
        </div>
      )}

      {/* Tab 2: Calendar & Schedule Updates */}
      {activeTab === 'schedule' && (
        <div className="space-y-4">
          <p className="text-xs text-slate-500">
            Real-time schedule mutations and calendar slot bookings broadcasted over the same socket connection.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Meeting Transaction ID</label>
              <input
                type="text"
                value={meetingId}
                onChange={(e) => setMeetingId(e.target.value)}
                className="w-full text-xs p-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Date</label>
              <input
                type="date"
                value={slotDate}
                onChange={(e) => setSlotDate(e.target.value)}
                className="w-full text-xs p-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Time Slot</label>
              <input
                type="time"
                value={slotTime}
                onChange={(e) => setSlotTime(e.target.value)}
                className="w-full text-xs p-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-3 pt-2">
            <button
              onClick={handleUpdateSchedule}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-xs font-semibold hover:bg-indigo-700 transition-colors"
            >
              <Calendar className="w-3.5 h-3.5" />
              Emit schedule:updated
            </button>

            <button
              onClick={handleBookSlot}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg text-xs font-semibold hover:bg-emerald-700 transition-colors"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              Emit slot:booked
            </button>
          </div>
        </div>
      )}

      {/* Tab 3: User Presence */}
      {activeTab === 'presence' && (
        <div className="space-y-4">
          <p className="text-xs text-slate-500">
            Tracks user online/busy presence status dynamically across connected agents and prospects.
          </p>

          <div className="flex flex-wrap items-center gap-3 bg-slate-50 p-4 rounded-lg border border-slate-200">
            <button
              onClick={handleSetOnline}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg text-xs font-semibold hover:bg-emerald-700 transition-colors"
            >
              <span className="w-2 h-2 rounded-full bg-white animate-pulse"></span>
              Set Status: user:online
            </button>

            <button
              onClick={handleSetBusy}
              className="flex items-center gap-2 px-4 py-2 bg-amber-600 text-white rounded-lg text-xs font-semibold hover:bg-amber-700 transition-colors"
            >
              <span className="w-2 h-2 rounded-full bg-white"></span>
              Set Status: user:busy
            </button>

            <input
              type="text"
              placeholder="Active meeting note (e.g. In Executive Review)"
              value={meetingNote}
              onChange={(e) => setMeetingNote(e.target.value)}
              className="flex-1 text-xs p-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          {/* Connected Presence Roster */}
          <div className="border border-slate-200 rounded-lg overflow-hidden mt-4">
            <div className="bg-slate-100 px-4 py-2 text-xs font-bold text-slate-700 border-b border-slate-200 flex justify-between items-center">
              <span>Active Agent Presence Roster ({activeUsers.length})</span>
              <span className="text-[10px] font-normal text-slate-500">Live Socket Sync</span>
            </div>
            <div className="divide-y divide-slate-100 max-h-48 overflow-y-auto">
              {activeUsers.length === 0 ? (
                <div className="p-4 text-xs text-slate-400 text-center">No active users in presence state map</div>
              ) : (
                activeUsers.map((usr) => (
                  <div key={usr.userId} className="p-3 flex items-center justify-between text-xs hover:bg-slate-50">
                    <div className="flex items-center gap-2.5">
                      <span
                        className={`w-2.5 h-2.5 rounded-full ${
                          usr.status === 'online' ? 'bg-emerald-500' : usr.status === 'busy' ? 'bg-amber-500' : 'bg-slate-300'
                        }`}
                      ></span>
                      <div>
                        <p className="font-semibold text-slate-800">{usr.name}</p>
                        <p className="text-[10px] text-slate-400">{usr.userId}</p>
                      </div>
                    </div>

                    <div className="text-right">
                      <span className="text-[11px] font-medium capitalize text-slate-600">{usr.status}</span>
                      {usr.currentMeetingId && (
                        <p className="text-[10px] text-indigo-600 truncate max-w-[150px]">{usr.currentMeetingId}</p>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Tab 4: Logs */}
      {activeTab === 'logs' && (
        <div className="space-y-2">
          <div className="flex justify-between items-center mb-2">
            <p className="text-xs text-slate-500">Real-time event stream intercepted over single socket stream:</p>
            <button
              onClick={() => setLogs([])}
              className="text-xs text-indigo-600 hover:underline font-medium"
            >
              Clear Log History
            </button>
          </div>

          <div className="bg-slate-900 text-slate-200 rounded-lg p-4 font-mono text-xs max-h-64 overflow-y-auto divide-y divide-slate-800">
            {logs.length === 0 ? (
              <p className="text-slate-500 italic">No events intercepted yet. Trigger an action above.</p>
            ) : (
              logs.map((log) => (
                <div key={log.id} className="py-1.5 flex items-start gap-3">
                  <span className="text-slate-500 text-[10px] shrink-0">{log.time}</span>
                  <span
                    className={`font-semibold shrink-0 ${
                      log.type.startsWith('WEBRTC')
                        ? 'text-cyan-400'
                        : log.type.startsWith('SCHEDULE')
                        ? 'text-amber-400'
                        : 'text-emerald-400'
                    }`}
                  >
                    [{log.type}]
                  </span>
                  <span className="text-slate-300 break-all">{log.message}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};
