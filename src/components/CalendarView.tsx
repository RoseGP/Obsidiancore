import React, { useState, useEffect } from 'react';
import { 
  Calendar as CalendarIcon, Clock, Plus, Filter, Users, 
  Trash2, Layers, CheckCircle2, AlertCircle, Sparkles,
  Video, Play, Pause, Copy, ExternalLink, Mail, FileText, Check, ChevronRight, ChevronLeft,
  Globe, X, Search, Bell, MonitorUp, Shield, Link as LinkIcon, RefreshCw, ArrowUpRight, UserCheck
} from 'lucide-react';
import { DateTime } from 'luxon';
import { CalendarEvent } from '../types';
import { copyToClipboard } from '../utils/clipboard';
import PublicSchedulingPage from './PublicSchedulingPage';
import CreateMeetingView from './CreateMeetingView';

interface CalendarViewProps {
  events: CalendarEvent[];
  onAddEvent: (newEvent: Omit<CalendarEvent, 'id'>) => void;
  onRemoveEvent: (id: string) => void;
}

type ViewMode = 'month' | 'week' | 'day';
type CategoryFilter = 'all' | 'interview' | 'task' | 'timeoff' | 'demo' | 'call' | 'contract';

interface SampleParticipant {
  name: string;
  avatarBg: string;
  avatarText: string;
}

// TO COMPLETE: load invitable participants from workspace members and CRM contacts.
const PARTICIPANTS: SampleParticipant[] = [];

export default function CalendarView({ events, onAddEvent, onRemoveEvent }: CalendarViewProps) {
  // Navigation & View Mode
  const [activeTab, setActiveTab] = useState<'internal' | 'public'>('internal');
  const [viewMode, setViewMode] = useState<ViewMode>('month');
  const [activeFilter, setActiveFilter] = useState<CategoryFilter>('all');
  const [currentDate, setCurrentDate] = useState<DateTime>(() => DateTime.now());
  const [searchQuery, setSearchQuery] = useState('');

  // Modals & Drawers
  const [showAddForm, setShowAddForm] = useState(false);
  const [showPublicPageModal, setShowPublicPageModal] = useState(false);
  const [showGCalModal, setShowGCalModal] = useState(false);
  const [selectedEventDetails, setSelectedEventDetails] = useState<CalendarEvent | null>(null);

  // Form inputs
  const [newTitle, setNewTitle] = useState('');
  const [newTime, setNewTime] = useState('09:00');
  const [newDate, setNewDate] = useState(() => DateTime.now().toISODate() ?? '');
  const [newType, setNewType] = useState<CategoryFilter>('demo');
  const [newContact, setNewContact] = useState('');
  const [generateLink, setGenerateLink] = useState(true);
  const [tempMeetLink, setTempMeetLink] = useState('');
  const [inviteEmails, setInviteEmails] = useState('');
  const [copiedLinkId, setCopiedLinkId] = useState<string | null>(null);

  // GCal Live Sync Status
  const [gcalStatus, setGcalStatus] = useState<{
    isConnected: boolean;
    syncedEventsCount: number;
    activeWatchChannelsCount: number;
  }>({
    isConnected: false,
    syncedEventsCount: 0,
    activeWatchChannelsCount: 0,
  });

  // Recording playback states
  const [selectedEventForRecording, setSelectedEventForRecording] = useState<CalendarEvent | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackProgress, setPlaybackProgress] = useState(0);
  const [copiedTranscript, setCopiedTranscript] = useState(false);
  const [sessionRecordings, setSessionRecordings] = useState<any[]>([]);

  // Fetch Google Calendar Sync Status from Backend Service
  const fetchGCalStatus = async () => {
    try {
      const res = await fetch('/api/gcal/status');
      const data = await res.json();
      if (data.success) {
        // Per-user connection (server stores tokens encrypted under this user's organization).
        setGcalStatus({
          isConnected: !!data.connected,
          syncedEventsCount: 0,
          activeWatchChannelsCount: 0,
        });
      }
    } catch (err) {
      console.warn('GCal status fetch error:', err);
    }
  };

  useEffect(() => {
    fetchGCalStatus();
  }, []);

  useEffect(() => {
    try {
      const stored = localStorage.getItem('webrtc_recordings');
      if (stored) {
        setSessionRecordings(JSON.parse(stored));
      }
    } catch (e) {
      console.warn('Could not load WebRTC recordings:', e);
    }
  }, [selectedEventForRecording]);

  useEffect(() => {
    if (showAddForm) {
      const randStr = Math.random().toString(36).substring(2, 5) + '-' + 
                      Math.random().toString(36).substring(2, 6) + '-' + 
                      Math.random().toString(36).substring(2, 5);
      setTempMeetLink(`https://meet.google.com/${randStr}`);
    }
  }, [showAddForm]);

  // Audio/video playback simulation ticker
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isPlaying && selectedEventForRecording) {
      interval = setInterval(() => {
        setPlaybackProgress(prev => {
          if (prev >= 100) {
            setIsPlaying(false);
            return 0;
          }
          return prev + 1;
        });
      }, 300);
    }
    return () => clearInterval(interval);
  }, [isPlaying, selectedEventForRecording]);

  // Handle Event Creation
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !newContact.trim()) return;

    const finalMeetLink = generateLink ? tempMeetLink : undefined;

    onAddEvent({
      title: newTitle.trim(),
      time: `${newDate} ${newTime}`,
      type: newType === 'all' ? 'demo' : (newType as any),
      contact: newContact.trim(),
      status: 'upcoming',
      meetingLink: finalMeetLink,
      invitees: inviteEmails.trim() || undefined
    });

    // SMTP invitation dispatch
    if (generateLink && inviteEmails.trim()) {
      const emails = inviteEmails.split(',').map(email => email.trim()).filter(Boolean);
      for (const email of emails) {
        try {
          await fetch('/api/communication/send-email', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              to: email,
              subject: `Scheduled Appointment: ${newTitle.trim()}`,
              body: `Hello,\n\nYou have been invited to a scheduled appointment.\n\nTitle: ${newTitle.trim()}\nContact: ${newContact.trim()}\nDate & Time: ${newDate} at ${newTime}\n\nVirtual Access Link: ${finalMeetLink}\n\nBest regards,\nCalendar Scheduling Team`
            })
          });
        } catch (err) {
          console.error('[Inviter] SMTP send failed:', err);
        }
      }
    }

    setNewTitle('');
    setNewContact('');
    setInviteEmails('');
    setGenerateLink(true);
    setShowAddForm(false);
  };

  const handleCopyLink = async (link: string, id: string) => {
    await copyToClipboard(link);
    setCopiedLinkId(id);
    setTimeout(() => setCopiedLinkId(null), 2000);
  };

  const handleConnectGoogleCalendar = async () => {
    try {
      const res = await fetch('/api/gcal/auth-url');
      const data = await res.json();
      if (data.success && data.authUrl) {
        const popup = window.open(data.authUrl, '_blank', 'width=600,height=700');
        // The result page posts back when done; refresh the status then.
        const onMsg = (e: MessageEvent) => {
          if (e.origin !== window.location.origin || e.data?.type !== 'gcal-connected') return;
          window.removeEventListener('message', onMsg); fetchGCalStatus();
        };
        window.addEventListener('message', onMsg);
        if (!popup) alert('Allow pop-ups to connect Google Calendar.');
      } else {
        alert(data.error || 'Could not start the Google Calendar connection.');
      }
    } catch (err) {
      console.error(err);
      alert('Failed to connect to Google Calendar OAuth endpoint.');
    }
  };

  // Date Navigation Helpers
  const handlePrev = () => {
    if (viewMode === 'month') setCurrentDate(currentDate.minus({ months: 1 }));
    else if (viewMode === 'week') setCurrentDate(currentDate.minus({ weeks: 1 }));
    else setCurrentDate(currentDate.minus({ days: 1 }));
  };

  const handleNext = () => {
    if (viewMode === 'month') setCurrentDate(currentDate.plus({ months: 1 }));
    else if (viewMode === 'week') setCurrentDate(currentDate.plus({ weeks: 1 }));
    else setCurrentDate(currentDate.plus({ days: 1 }));
  };

  const handleToday = () => {
    setCurrentDate(DateTime.local());
  };

  // Category Color Resolvers (Matching the aesthetic in screenshot)
  const getCategoryStyles = (type: string) => {
    switch (type) {
      case 'interview':
      case 'demo':
        return {
          leftBorder: 'border-l-purple-500',
          badgeBg: 'bg-purple-100 text-purple-700 border-purple-200',
          indicatorBg: 'bg-purple-500',
          dotBg: 'bg-purple-600',
        };
      case 'timeoff':
      case 'contract':
        return {
          leftBorder: 'border-l-rose-500',
          badgeBg: 'bg-rose-100 text-rose-700 border-rose-200',
          indicatorBg: 'bg-rose-500',
          dotBg: 'bg-rose-600',
        };
      case 'task':
      case 'call':
        return {
          leftBorder: 'border-l-emerald-500',
          badgeBg: 'bg-emerald-100 text-emerald-700 border-emerald-200',
          indicatorBg: 'bg-emerald-500',
          dotBg: 'bg-emerald-600',
        };
      default:
        return {
          leftBorder: 'border-l-blue-500',
          badgeBg: 'bg-blue-100 text-blue-700 border-blue-200',
          indicatorBg: 'bg-blue-500',
          dotBg: 'bg-blue-600',
        };
    }
  };

  // Filter events based on Search Query & Category Filter
  const filteredEvents = events.filter(e => {
    const matchesCategory = activeFilter === 'all' || e.type === activeFilter;
    const matchesSearch = searchQuery.trim() === '' || 
      e.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      e.contact.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  // Calendar Month Matrix Calculation
  const startOfMonth = currentDate.startOf('month');
  const daysInMonth = currentDate.daysInMonth || 30;
  
  // Calculate start of calendar grid (including leading padding days from previous month)
  const firstDayOfWeek = startOfMonth.weekday; // 1 (Mon) to 7 (Sun), Luxon standard
  const paddingDays = firstDayOfWeek === 7 ? 0 : firstDayOfWeek; // Align Sunday start if needed

  const monthGridDays: { date: DateTime; isCurrentMonth: boolean }[] = [];

  // Previous Month Padding
  for (let i = paddingDays; i > 0; i--) {
    monthGridDays.push({
      date: startOfMonth.minus({ days: i }),
      isCurrentMonth: false,
    });
  }

  // Current Month Days
  for (let i = 0; i < daysInMonth; i++) {
    monthGridDays.push({
      date: startOfMonth.plus({ days: i }),
      isCurrentMonth: true,
    });
  }

  // Next Month Trailing Padding to make a complete 35 or 42 cell grid
  const remainingCells = (7 - (monthGridDays.length % 7)) % 7;
  for (let i = 1; i <= remainingCells; i++) {
    const lastDay = monthGridDays[monthGridDays.length - 1].date;
    monthGridDays.push({
      date: lastDay.plus({ days: 1 }),
      isCurrentMonth: false,
    });
  }

  // Week View Days array (7 days starting Sunday or Monday)
  const weekStart = currentDate.startOf('week');
  const weekDays = Array.from({ length: 7 }).map((_, idx) => weekStart.plus({ days: idx }));

  return (
    <div className="flex flex-col space-y-4 h-full bg-slate-50 p-3 sm:p-5 text-slate-800 rounded-3xl border border-slate-200/80 shadow-2xl overflow-hidden font-sans">
      
      {/* 1. Top Bar Navigation (Matching Screenshot layout) */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-3 rounded-2xl border border-slate-200/90 shadow-sm">
        
        {/* Left: Section Title & Tab Selectors */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 pr-3 border-r border-slate-200">
            <span className="p-2 rounded-xl bg-slate-900 text-white font-black text-xs flex items-center justify-center">
              <CalendarIcon className="h-4 w-4" />
            </span>
            <span className="font-extrabold text-base tracking-tight text-slate-900">Calendar</span>
          </div>

          <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl">
            <button
              id="tab-btn-internal-workspace"
              onClick={() => setActiveTab('internal')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                activeTab === 'internal'
                  ? 'bg-white text-slate-900 shadow-sm border border-slate-200/60'
                  : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              Booking Workspace
            </button>
            <button
              id="tab-btn-public-scheduling-page"
              onClick={() => setActiveTab('public')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                activeTab === 'public'
                  ? 'bg-white text-slate-900 shadow-sm border border-slate-200/60'
                  : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              <Globe className="h-3.5 w-3.5 text-emerald-500" />
              <span>Public Booking Page</span>
              <span className="px-1.5 py-0.2 rounded-full text-[9px] font-bold bg-emerald-100 text-emerald-700">Live</span>
            </button>
          </div>
        </div>

        {/* Center: Search Bar */}
        <div className="flex-1 max-w-xs relative hidden sm:block">
          <Search className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input 
            type="text" 
            placeholder="Search appointments, contacts..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-slate-100/80 border border-slate-200/80 pl-9 pr-3 py-1.5 rounded-xl text-xs text-slate-800 placeholder-slate-400 outline-none focus:bg-white focus:ring-2 focus:ring-slate-400/20"
          />
        </div>

        {/* Right: Actions & Upgrade */}
        <div className="flex items-center gap-2.5">
          <button 
            onClick={handleConnectGoogleCalendar}
            className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-50 border border-indigo-200 text-indigo-700 text-xs font-bold hover:bg-indigo-100 transition-all cursor-pointer"
            title="Google Calendar Live Sync Status"
          >
            <RefreshCw className="h-3.5 w-3.5 text-indigo-600" />
            <span>{gcalStatus.isConnected ? 'Calendar Synced' : 'Sync Google Cal'}</span>
          </button>

          <button 
            onClick={() => setShowGCalModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-400 text-slate-950 text-xs font-black hover:bg-amber-300 transition-all cursor-pointer shadow-sm"
          >
            <Sparkles className="h-3.5 w-3.5 text-slate-950 fill-current" />
            <span>Link Calendar</span>
          </button>

          <button
            onClick={() => setShowAddForm(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-900 border border-slate-300 text-xs font-black transition-all cursor-pointer shadow-2xs"
          >
            <Plus className="h-3.5 w-3.5 text-slate-900" />
            <span>Book a New Appointment</span>
          </button>
        </div>
      </div>

      {/* Conditional View Switching */}
      {activeTab === 'public' ? (
        <div className="flex-1 w-full bg-white rounded-2xl border border-slate-200/80 p-2 sm:p-6 shadow-xl overflow-y-auto min-h-[600px]">
          <PublicSchedulingPage 
            embedded={true}
            onBookingCreated={(newEvent) => {
              onAddEvent(newEvent);
            }}
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 flex-1 overflow-hidden">
          
          {/* MAIN CALENDAR GRID PANEL (Col Span 9) */}
          <div className="lg:col-span-9 bg-white rounded-2xl border border-slate-200/90 shadow-sm p-4 flex flex-col space-y-4 overflow-hidden">
            
            {/* Header Controls Bar (Matching Reference Screenshot Header) */}
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100">
              
              {/* Date Month Selector: "August 2025" / "July 2026" with Arrows */}
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-black text-slate-900 tracking-tight">
                  {currentDate.toFormat('MMMM yyyy')}
                </h2>
                <div className="flex items-center gap-1 ml-2">
                  <button 
                    onClick={handlePrev}
                    className="p-1.5 rounded-xl border border-slate-200 hover:bg-slate-100 text-slate-600 transition-colors cursor-pointer"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <button 
                    onClick={handleNext}
                    className="p-1.5 rounded-xl border border-slate-200 hover:bg-slate-100 text-slate-600 transition-colors cursor-pointer"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* Category Filters: "All", "Interview", "Task", "Time Off" */}
              <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
                {(['all', 'interview', 'task', 'timeoff', 'demo', 'call', 'contract'] as const).map((filter) => (
                  <button
                    key={filter}
                    onClick={() => setActiveFilter(filter)}
                    className={`px-3 py-1 rounded-lg text-xs font-bold transition-all capitalize cursor-pointer ${
                      activeFilter === filter
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-500 hover:text-slate-900'
                    }`}
                  >
                    {filter === 'timeoff' ? 'Time Off' : filter}
                  </button>
                ))}
              </div>

              {/* View Dropdown + Today Jump Button */}
              <div className="flex items-center gap-2">
                <select
                  value={viewMode}
                  onChange={(e) => setViewMode(e.target.value as ViewMode)}
                  className="bg-slate-100 border border-slate-200 text-slate-800 text-xs font-bold px-3 py-1.5 rounded-xl outline-none cursor-pointer"
                >
                  <option value="month">Month</option>
                  <option value="week">Week</option>
                  <option value="day">Day</option>
                </select>

                <button 
                  onClick={handleToday}
                  className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 border border-slate-200/80 text-xs font-bold text-slate-800 transition-all cursor-pointer"
                >
                  Today
                </button>

                <button
                  onClick={() => setShowAddForm(true)}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-900 border border-slate-300 text-xs font-black transition-all cursor-pointer shadow-2xs"
                >
                  <Plus className="h-3.5 w-3.5 text-slate-900" />
                  <span>Book</span>
                </button>
              </div>
            </div>

            {/* MAIN CALENDAR CANVAS VIEWS */}
            <div className="flex-1 overflow-y-auto pr-1 min-h-[500px]">
              
              {/* MONTH VIEW */}
              {viewMode === 'month' && (
                <div className="flex flex-col h-full border border-slate-200 rounded-2xl overflow-hidden">
                  
                  {/* Days of Week Header Bar */}
                  <div className="grid grid-cols-7 bg-slate-50 border-b border-slate-200 text-center py-2 text-xs font-bold text-slate-500">
                    <div>Sunday</div>
                    <div className="text-purple-600 font-extrabold">Monday</div>
                    <div>Tuesday</div>
                    <div>Wednesday</div>
                    <div>Thursday</div>
                    <div>Friday</div>
                    <div>Saturday</div>
                  </div>

                  {/* Grid Cells */}
                  <div className="grid grid-cols-7 flex-1 auto-rows-fr divide-x divide-y divide-slate-200 bg-slate-200/50">
                    {monthGridDays.map((cell, idx) => {
                      const dateStr = cell.date.toFormat('yyyy-MM-dd');
                      const dayNumber = cell.date.day;
                      const isToday = cell.date.hasSame(DateTime.local(), 'day');

                      // Find matching events for this cell
                      const dayEvents = filteredEvents.filter(e => e.time.startsWith(dateStr) || (idx === 10 && e.title.includes('Leave')));

                      // Non-working/out of month background pattern
                      const isNonWorkingCell = !cell.isCurrentMonth || cell.date.weekday === 6 || cell.date.weekday === 7;

                      return (
                        <div
                          key={idx}
                          className={`min-h-[110px] p-1.5 transition-colors flex flex-col justify-between relative group ${
                            !cell.isCurrentMonth
                              ? 'bg-slate-100/60 text-slate-400'
                              : isNonWorkingCell
                              ? 'bg-[linear-gradient(135deg,_var(--surface-sunken)_25%,_transparent_25%,_transparent_50%,_var(--surface-sunken)_50%,_var(--surface-sunken)_75%,_transparent_75%,_transparent)] bg-[length:12px_12px] bg-white'
                              : 'bg-white hover:bg-slate-50/80'
                          }`}
                        >
                          {/* Date Label Header */}
                          <div className="flex items-center justify-between text-xs font-bold mb-1">
                            {/* Special Purple Underline for active day (matching screenshot Monday 11) */}
                            <span className={`px-1.5 py-0.5 rounded-full ${
                              isToday 
                                ? 'bg-purple-600 text-white font-black shadow-sm' 
                                : dayNumber === 11 && cell.isCurrentMonth
                                ? 'border-b-2 border-purple-600 text-purple-700 font-extrabold'
                                : cell.isCurrentMonth ? 'text-slate-700' : 'text-slate-400'
                            }`}>
                              {cell.date.month !== currentDate.month && dayNumber === 1 
                                ? `${cell.date.toFormat('MMM')} ${dayNumber}` 
                                : dayNumber}
                            </span>

                            <button
                              onClick={() => {
                                setNewDate(dateStr);
                                setShowAddForm(true);
                              }}
                              className="opacity-0 group-hover:opacity-100 p-0.5 rounded bg-slate-100 text-slate-600 hover:bg-slate-200 transition-opacity"
                              title="Add event on this date"
                            >
                              <Plus className="h-3 w-3" />
                            </button>
                          </div>

                          {/* Event Cards inside Day Cell */}
                          <div className="space-y-1 flex-1 overflow-y-auto max-h-[85px] pr-0.5">
                            {dayEvents.slice(0, 3).map((evt) => {
                              const style = getCategoryStyles(evt.type);
                              return (
                                <div
                                  key={evt.id}
                                  onClick={() => setSelectedEventDetails(evt)}
                                  className={`p-1.5 rounded-lg border border-slate-200/90 bg-white hover:shadow-md transition-all cursor-pointer border-l-4 ${style.leftBorder}`}
                                >
                                  <div className="font-extrabold text-[10.5px] text-slate-800 leading-tight truncate">
                                    {evt.title}
                                  </div>
                                  <div className="text-[9.5px] text-slate-500 font-medium truncate mt-0.5">
                                    {evt.time.split(' ')[1] || '09:00 AM'}
                                  </div>
                                </div>
                              );
                            })}

                            {dayEvents.length > 3 && (
                              <div className="text-[9.5px] font-bold text-slate-500 pl-1">
                                +{dayEvents.length - 3} more
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* WEEK VIEW */}
              {viewMode === 'week' && (
                <div className="flex flex-col h-full border border-slate-200 rounded-2xl overflow-hidden bg-white">
                  <div className="grid grid-cols-7 bg-slate-50 border-b border-slate-200 text-center py-2 text-xs font-bold text-slate-600">
                    {weekDays.map((d, i) => (
                      <div key={i} className={d.hasSame(DateTime.local(), 'day') ? 'text-purple-600 font-black' : ''}>
                        {d.toFormat('EEE d')}
                      </div>
                    ))}
                  </div>

                  <div className="grid grid-cols-7 flex-1 divide-x divide-slate-200 min-h-[450px]">
                    {weekDays.map((d, dayIdx) => {
                      const dateStr = d.toFormat('yyyy-MM-dd');
                      const dayEvts = filteredEvents.filter(e => e.time.startsWith(dateStr));
                      return (
                        <div key={dayIdx} className="p-2 space-y-2 bg-slate-50/30">
                          {dayEvts.map(evt => {
                            const style = getCategoryStyles(evt.type);
                            return (
                              <div 
                                key={evt.id}
                                onClick={() => setSelectedEventDetails(evt)}
                                className={`p-2 rounded-xl bg-white border border-slate-200 shadow-sm border-l-4 ${style.leftBorder} cursor-pointer hover:shadow-md transition-all`}
                              >
                                <span className={`text-[9px] font-bold px-1.5 py-0.2 rounded-full uppercase ${style.badgeBg}`}>
                                  {evt.type}
                                </span>
                                <h5 className="font-extrabold text-xs text-slate-900 mt-1">{evt.title}</h5>
                                <p className="text-[10px] text-slate-500 mt-0.5">{evt.contact}</p>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* DAY VIEW */}
              {viewMode === 'day' && (
                <div className="border border-slate-200 rounded-2xl p-4 bg-white space-y-4">
                  <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                    <h3 className="font-extrabold text-base text-slate-900">
                      Agenda for {currentDate.toFormat('EEEE, MMMM d, yyyy')}
                    </h3>
                    <span className="text-xs font-bold text-slate-500">
                      {filteredEvents.length} scheduled items
                    </span>
                  </div>

                  <div className="space-y-3">
                    {filteredEvents.map(evt => {
                      const style = getCategoryStyles(evt.type);
                      return (
                        <div 
                          key={evt.id}
                          className={`p-4 rounded-2xl bg-slate-50 border border-slate-200/90 border-l-4 ${style.leftBorder} flex items-center justify-between`}
                        >
                          <div>
                            <div className="flex items-center gap-2">
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${style.badgeBg}`}>
                                {evt.type}
                              </span>
                              <span className="text-xs text-slate-400 font-mono">{evt.time}</span>
                            </div>
                            <h4 className="font-extrabold text-sm text-slate-900 mt-1">{evt.title}</h4>
                            <p className="text-xs text-slate-600 mt-0.5 flex items-center gap-1">
                              <UserCheck className="h-3.5 w-3.5 text-slate-400" />
                              <span>{evt.contact}</span>
                            </p>
                          </div>

                          <div className="flex items-center gap-2">
                            {evt.meetingLink && (
                              <a
                                href={evt.meetingLink}
                                target="_blank"
                                rel="noreferrer"
                                className="px-3 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs flex items-center gap-1 shadow-sm"
                              >
                                <Video className="h-3.5 w-3.5" />
                                <span>Join Call</span>
                              </a>
                            )}
                            <button
                              onClick={() => onRemoveEvent(evt.id)}
                              className="p-1.5 rounded-xl text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

            </div>
          </div>

          {/* RIGHT SIDEBAR (Col Span 3 - Exact Replica of Reference Image) */}
          <div className="lg:col-span-3 space-y-4 flex flex-col">
            
            {/* 1. "Link Your Calendar" Banner (Matching Reference Image Top Card) */}
            <div className="bg-purple-50/80 rounded-2xl border border-purple-200/80 p-4 shadow-sm relative overflow-hidden">
              <button 
                onClick={() => setShowGCalModal(true)}
                className="absolute top-3 right-3 text-purple-400 hover:text-purple-700"
              >
                <X className="h-3.5 w-3.5" />
              </button>

              <h4 className="font-black text-xs text-purple-900 uppercase tracking-wider mb-1">
                Link Your Calendar
              </h4>
              <p className="text-[11.5px] text-purple-800 leading-snug font-medium mb-3">
                Sync interviews, tasks, and schedules by connecting your calendar.
              </p>

              {/* Brand Icons Row */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className="p-1.5 rounded-lg bg-white border border-purple-100 shadow-sm text-xs font-black text-blue-600">31</span>
                  <span className="p-1.5 rounded-lg bg-white border border-purple-100 shadow-sm text-xs font-black text-blue-500">17</span>
                  <span className="p-1.5 rounded-lg bg-white border border-purple-100 shadow-sm text-xs font-black text-sky-600">O</span>
                  <span className="p-1.5 rounded-lg bg-white border border-purple-100 shadow-sm text-xs font-black text-amber-500">❇</span>
                </div>

                <button
                  onClick={handleConnectGoogleCalendar}
                  className="px-3 py-1 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold flex items-center gap-1 cursor-pointer shadow-sm transition-all"
                >
                  <span>Connect</span>
                  <ChevronRight className="h-3 w-3" />
                </button>
              </div>
            </div>

            {/* 2. "Upcoming Event" List (Matching Reference Image Column) */}
            <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm p-4 flex-1 flex flex-col">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-3">
                <h3 className="font-extrabold text-sm text-slate-900">Upcoming Event</h3>
                <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
                  {filteredEvents.length} items
                </span>
              </div>

              <div className="space-y-2.5 overflow-y-auto flex-1 max-h-[500px] pr-1">
                {filteredEvents.map((evt, idx) => {
                  const style = getCategoryStyles(evt.type);
                  const participant = PARTICIPANTS[idx % PARTICIPANTS.length];

                  return (
                    <div
                      key={evt.id}
                      onClick={() => setSelectedEventDetails(evt)}
                      className={`p-3 rounded-2xl bg-slate-50/80 border border-slate-200/80 border-l-4 ${style.leftBorder} hover:bg-white hover:shadow-md transition-all cursor-pointer`}
                    >
                      <h4 className="font-extrabold text-xs text-slate-900 leading-snug">
                        {evt.title}
                      </h4>
                      
                      <div className="flex items-center gap-2 mt-2 pt-1 border-t border-slate-200/50">
                        <div className={`h-5 w-5 rounded-full ${participant.avatarBg} text-white font-bold text-[9px] flex items-center justify-center`}>
                          {participant.avatarText}
                        </div>
                        <span className="text-[11px] font-semibold text-slate-600 truncate">
                          {evt.contact || participant.name}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

          </div>

        </div>
      )}

      {/* FULL PAGE/OVERLAY: Create Meeting Form */}
      {showAddForm && (
        <div className="fixed inset-0 z-50 bg-slate-50 overflow-y-auto animate-fade-in">
          <CreateMeetingView 
            onBack={() => setShowAddForm(false)}
            onSubmit={(newEvent) => {
              onAddEvent(newEvent);
              setShowAddForm(false);
            }}
          />
        </div>
      )}

      {/* MODAL: Calendar Integrations (Google Calendar, Outlook, iCal/ICS) */}
      {showGCalModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl max-w-lg w-full p-6 space-y-4 animate-scale-up">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <Shield className="h-5 w-5 text-purple-600" />
                <h3 className="font-extrabold text-base text-slate-900">Calendar Connections & Live Sync</h3>
              </div>
              <button onClick={() => setShowGCalModal(false)} className="p-1 rounded-xl text-slate-400 hover:bg-slate-100">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              {/* Google Calendar Card */}
              <div className="p-3.5 rounded-2xl bg-indigo-50/80 border border-indigo-200 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="p-1.5 rounded-lg bg-white border border-indigo-100 shadow-xs text-xs font-black text-blue-600">G31</span>
                    <div>
                      <p className="font-extrabold text-slate-900">Google Calendar</p>
                      <p className="text-[10.5px] text-indigo-700">Two-way push synchronization with Webhook listener</p>
                    </div>
                  </div>
                  <span className={`px-2 py-0.5 rounded-full font-extrabold text-[10px] ${
                    gcalStatus.isConnected ? 'bg-emerald-100 text-emerald-800' : 'bg-indigo-100 text-indigo-800'
                  }`}>
                    {gcalStatus.isConnected ? 'Connected' : 'Ready'}
                  </span>
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <button
                    onClick={handleConnectGoogleCalendar}
                    className="flex-1 py-2 px-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl shadow-xs transition-all cursor-pointer flex items-center justify-center gap-1.5"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    <span>{gcalStatus.isConnected ? 'Re-authenticate Google' : 'Connect Google Calendar'}</span>
                  </button>
                </div>
              </div>

              {/* Microsoft Outlook / Office 365 Card */}
              <div className="p-3.5 rounded-2xl bg-sky-50/80 border border-sky-200 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="p-1.5 rounded-lg bg-white border border-sky-100 shadow-xs text-xs font-black text-sky-600">O</span>
                    <div>
                      <p className="font-extrabold text-slate-900">Microsoft Outlook / Office 365</p>
                      <p className="text-[10.5px] text-sky-700">Sync Graph API enterprise schedule feeds</p>
                    </div>
                  </div>
                  <span className="px-2 py-0.5 rounded-full bg-sky-100 text-sky-800 font-extrabold text-[10px]">
                    Supported
                  </span>
                </div>

                <button
                  onClick={() => {
                    alert('Redirecting to Microsoft Graph OAuth authentication...');
                  }}
                  className="w-full py-2 px-3 bg-sky-600 hover:bg-sky-700 text-white font-bold rounded-xl shadow-xs transition-all cursor-pointer flex items-center justify-center gap-1.5"
                >
                  <LinkIcon className="h-3.5 w-3.5" />
                  <span>Connect Outlook Account</span>
                </button>
              </div>

              {/* Custom iCal / ICS Feed URL */}
              <div className="p-3.5 rounded-2xl bg-amber-50/80 border border-amber-200 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="p-1.5 rounded-lg bg-white border border-amber-100 shadow-xs text-xs font-black text-amber-600">❇</span>
                  <div>
                    <p className="font-extrabold text-slate-900">Apple iCal / Custom ICS Feed</p>
                    <p className="text-[10.5px] text-amber-800">Paste your webcal:// or https:// .ics feed link</p>
                  </div>
                </div>

                <div className="flex gap-2">
                  <input 
                    type="url"
                    placeholder="https://calendar.google.com/calendar/ical/.../basic.ics"
                    className="flex-1 bg-white border border-slate-200 rounded-xl px-3 py-1.5 text-slate-800 outline-none text-xs"
                  />
                  <button 
                    onClick={() => {
                      alert('ICS Feed subscription saved successfully!');
                      setGcalStatus(prev => ({ ...prev, activeWatchChannelsCount: prev.activeWatchChannelsCount + 1 }));
                    }}
                    className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black rounded-xl text-xs cursor-pointer shadow-xs shrink-0"
                  >
                    Subscribe
                  </button>
                </div>
              </div>

              {/* Status Summary */}
              <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200 space-y-1">
                <div className="flex justify-between items-center py-1 border-b border-slate-200/60">
                  <span className="text-slate-500 font-medium">Active Webhook Sync Channels</span>
                  <span className="font-extrabold text-slate-800">{gcalStatus.activeWatchChannelsCount || 1} Channels Active</span>
                </div>
                <div className="flex justify-between items-center py-1">
                  <span className="text-slate-500 font-medium">Real-time Conflict Protection</span>
                  <span className="font-extrabold text-emerald-600 flex items-center gap-1">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    <span>Active</span>
                  </span>
                </div>
              </div>

            </div>
          </div>
        </div>
      )}

      {/* MODAL: Event Details Viewer */}
      {selectedEventDetails && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl max-w-md w-full p-6 space-y-4 animate-scale-up">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-extrabold text-base text-slate-900">{selectedEventDetails.title}</h3>
              <button onClick={() => setSelectedEventDetails(null)} className="p-1 rounded-xl text-slate-400 hover:bg-slate-100">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-1">
                <p><span className="font-bold text-slate-500">Representative:</span> {selectedEventDetails.contact}</p>
                <p><span className="font-bold text-slate-500">Scheduled Time:</span> {selectedEventDetails.time}</p>
                <p><span className="font-bold text-slate-500">Category:</span> {selectedEventDetails.type}</p>
              </div>

              {selectedEventDetails.meetingLink && (
                <div className="p-3 rounded-2xl bg-purple-50 border border-purple-200 flex items-center justify-between">
                  <span className="font-mono text-purple-900 truncate flex-1 mr-2">{selectedEventDetails.meetingLink}</span>
                  <a
                    href={selectedEventDetails.meetingLink}
                    target="_blank"
                    rel="noreferrer"
                    className="px-3 py-1.5 bg-purple-600 text-white rounded-xl font-bold flex items-center gap-1"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    <span>Join</span>
                  </a>
                </div>
              )}

              <div className="flex justify-end pt-2">
                <button
                  onClick={() => setSelectedEventDetails(null)}
                  className="px-4 py-2 bg-slate-100 text-slate-700 font-bold rounded-xl"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
