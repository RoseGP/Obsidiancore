import React, { useState, useEffect } from 'react';
import { 
  Calendar as CalendarIcon, Clock, Phone, Video, Globe, ChevronLeft, ChevronRight,
  User, Mail, Building, Sparkles, CheckCircle2, ArrowRight, ArrowLeft,
  Download, ExternalLink, ShieldCheck, X, FileText, Check, Copy
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { CalendarEvent } from '../types';

interface MeetingTypeOption {
  id: string;
  name: string;
  duration: string;
  durationMinutes: number;
  location: string;
  locationType: 'phone' | 'video';
  description: string;
}

const MEETING_TYPES: MeetingTypeOption[] = [
  {
    id: '30-min-reservation',
    name: 'Reservation Page',
    duration: '30 min',
    durationMinutes: 30,
    location: 'Phone call',
    locationType: 'phone',
    description: 'This is an example of a meeting you would have with a potential customer to demonstrate your product.'
  },
  {
    id: '15-min-intro',
    name: '15-Min Quick Intro',
    duration: '15 min',
    durationMinutes: 15,
    location: 'Google Meet',
    locationType: 'video',
    description: 'A rapid 15-minute discovery call to discuss high-level goals and see if our product is a strong fit.'
  },
  {
    id: '60-min-deep-dive',
    name: '60-Min Product Deep-Dive',
    duration: '60 min',
    durationMinutes: 60,
    location: 'Google Meet / HD Video',
    locationType: 'video',
    description: 'An in-depth technical walkthrough and strategy session for engineering and operations teams.'
  }
];

const TIMEZONES = [
  { code: 'CET', name: 'Central European Time', tz: 'Europe/Paris' },
  { code: 'EST', name: 'Eastern Time (US & Canada)', tz: 'America/New_York' },
  { code: 'PST', name: 'Pacific Time (US & Canada)', tz: 'America/Los_Angeles' },
  { code: 'CST', name: 'Central Time (US & Canada)', tz: 'America/Chicago' },
  { code: 'GMT', name: 'Greenwich Mean Time (London)', tz: 'Europe/London' },
  { code: 'JST', name: 'Japan Standard Time (Tokyo)', tz: 'Asia/Tokyo' }
];

interface PublicSchedulingPageProps {
  onBookingCreated?: (event: CalendarEvent) => void;
  onClose?: () => void;
  embedded?: boolean;
}

export default function PublicSchedulingPage({
  onBookingCreated,
  onClose,
  embedded = false
}: PublicSchedulingPageProps) {
  // Company Logo & Branding State
  const [companyName, setCompanyName] = useState<string>(() => {
    return localStorage.getItem('obsidian_branding_company_name') || 'ACME Inc.';
  });
  const [companyLogoUrl, setCompanyLogoUrl] = useState<string | null>(() => {
    return localStorage.getItem('obsidian_branding_logo_url') || null;
  });
  const [selectedBadgePreset, setSelectedBadgePreset] = useState<'diamond' | 'layers' | 'hexagon' | 'star'>(() => {
    return (localStorage.getItem('obsidian_branding_badge_preset') as any) || 'diamond';
  });
  const [showEditBrandingModal, setShowEditBrandingModal] = useState<boolean>(false);
  const [tempCompanyName, setTempCompanyName] = useState<string>(companyName);
  const [tempLogoUrl, setTempLogoUrl] = useState<string>(companyLogoUrl || '');

  // Save branding changes
  const handleSaveBranding = (e: React.FormEvent) => {
    e.preventDefault();
    setCompanyName(tempCompanyName);
    setCompanyLogoUrl(tempLogoUrl.trim() ? tempLogoUrl.trim() : null);
    localStorage.setItem('obsidian_branding_company_name', tempCompanyName);
    if (tempLogoUrl.trim()) {
      localStorage.setItem('obsidian_branding_logo_url', tempLogoUrl.trim());
    } else {
      localStorage.removeItem('obsidian_branding_logo_url');
    }
    localStorage.setItem('obsidian_branding_badge_preset', selectedBadgePreset);
    setShowEditBrandingModal(false);
  };

  // Image Upload Handler
  const handleLogoFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        if (typeof reader.result === 'string') {
          setTempLogoUrl(reader.result);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  // 1. Meeting Type & Timezone
  const [selectedMeetingType, setSelectedMeetingType] = useState<MeetingTypeOption>(MEETING_TYPES[0]);
  const [userTimezone, setUserTimezone] = useState<string>('Europe/Paris');
  const [currentTimeFormatted, setCurrentTimeFormatted] = useState<string>('');

  // Update live timezone clock
  useEffect(() => {
    const updateClock = () => {
      try {
        const now = new Date();
        const timeString = new Intl.DateTimeFormat('en-US', {
          timeZone: userTimezone,
          hour: 'numeric',
          minute: '2-digit',
          hour12: true
        }).format(now);
        setCurrentTimeFormatted(timeString.toLowerCase());
      } catch (e) {
        setCurrentTimeFormatted('8:11pm');
      }
    };
    updateClock();
    const interval = setInterval(updateClock, 30000);
    return () => clearInterval(interval);
  }, [userTimezone]);

  // 2. Date & Time Slot Picker States
  const [currentMonth, setCurrentMonth] = useState<Date>(new Date(2026, 7, 1)); // August 2026 context
  const [selectedDate, setSelectedDate] = useState<string>('2026-08-25');
  const [selectedTimeSlot, setSelectedTimeSlot] = useState<string | null>('10:00 AM');
  
  // Phase Workflow: 'slot_select' | 'booking_form' | 'confirmation'
  const [phase, setPhase] = useState<'slot_select' | 'booking_form' | 'confirmation'>('slot_select');

  // 3. Visitor Form Input States
  const [fullName, setFullName] = useState<string>('');
  const [email, setEmail] = useState<string>('');
  const [company, setCompany] = useState<string>('');
  const [phone, setPhone] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [guestEmails, setGuestEmails] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [formError, setFormError] = useState<string | null>(null);

  // 4. Confirmation & Share States
  const [confirmedBooking, setConfirmedBooking] = useState<any | null>(null);
  const [copiedLink, setCopiedLink] = useState<boolean>(false);

  // Time Slots matrix
  const timeSlots = [
    '09:00 AM',
    '09:30 AM',
    '10:00 AM',
    '10:30 AM',
    '11:00 AM',
    '01:30 PM',
    '02:00 PM',
    '02:30 PM',
    '03:00 PM',
    '04:00 PM'
  ];

  // Month navigation
  const handlePrevMonth = () => {
    setCurrentMonth(prev => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
  };

  const handleNextMonth = () => {
    setCurrentMonth(prev => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
  };

  // Generate Calendar Grid Days (Monday start to match the reference image: MON TUE WED THU FRI SAT SUN)
  const getDaysInMonth = (date: Date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    
    // Day of week index for 1st of month: 0 (Sun) .. 6 (Sat)
    let firstDayIndex = new Date(year, month, 1).getDay();
    // Convert to Monday = 0, Tuesday = 1, ..., Sunday = 6
    let monStartIndex = firstDayIndex === 0 ? 6 : firstDayIndex - 1;

    const totalDays = new Date(year, month + 1, 0).getDate();

    const days: { dayNumber: number; dateString: string; isCurrentMonth: boolean; isDisabled: boolean; isAvailable: boolean }[] = [];

    // Empty padding slots
    for (let i = 0; i < monStartIndex; i++) {
      days.push({ dayNumber: 0, dateString: `prev-${i}`, isCurrentMonth: false, isDisabled: true, isAvailable: false });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let day = 1; day <= totalDays; day++) {
      const dayDate = new Date(year, month, day);
      const yearStr = year;
      const monthStr = String(month + 1).padStart(2, '0');
      const dayStr = String(day).padStart(2, '0');
      const dateString = `${yearStr}-${monthStr}-${dayStr}`;

      const dayOfWeek = dayDate.getDay(); // 0 = Sun, 6 = Sat
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
      const isPast = dayDate < today;

      // Available days on business weekdays (Mon-Fri)
      const isAvailable = !isWeekend && !isPast;

      days.push({
        dayNumber: day,
        dateString,
        isCurrentMonth: true,
        isDisabled: !isAvailable,
        isAvailable
      });
    }

    return days;
  };

  const currentDaysInMonth = getDaysInMonth(currentMonth);

  // Date selection
  const handleDateClick = (dateString: string) => {
    setSelectedDate(dateString);
    if (!selectedTimeSlot) {
      setSelectedTimeSlot('10:00 AM');
    }
  };

  // Submit Booking
  const handleSubmitBooking = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim()) {
      setFormError('Please enter your full name.');
      return;
    }
    if (!email.trim() || !email.includes('@')) {
      setFormError('Please enter a valid work email address.');
      return;
    }

    setFormError(null);
    setIsSubmitting(true);

    // Latency simulation
    await new Promise(resolve => setTimeout(resolve, 600));

    const meetingId = `booking-${Date.now()}`;
    const randMeetCode = Math.random().toString(36).substring(2, 5) + '-' + 
                         Math.random().toString(36).substring(2, 6) + '-' + 
                         Math.random().toString(36).substring(2, 5);
    const meetingLink = `https://meet.google.com/${randMeetCode}`;

    const formattedDateObj = new Date(selectedDate);
    const dateReadable = formattedDateObj.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric'
    });

    const bookingPayload = {
      id: meetingId,
      title: `${selectedMeetingType.name} w/ ${fullName}`,
      hostName: 'ACME Inc.',
      visitorName: fullName,
      visitorEmail: email,
      visitorPhone: phone,
      company: company || 'ACME Inc.',
      meetingType: selectedMeetingType,
      dateString: selectedDate,
      dateReadable,
      timeSlot: selectedTimeSlot,
      timezone: userTimezone,
      meetingLink,
      notes: notes || 'Product Demonstration & Strategy Audit',
      createdAt: new Date().toISOString()
    };

    setConfirmedBooking(bookingPayload);

    // Save locally
    try {
      const existing = JSON.parse(localStorage.getItem('obsidian_public_bookings') || '[]');
      localStorage.setItem('obsidian_public_bookings', JSON.stringify([bookingPayload, ...existing]));
    } catch (err) {
      console.warn('Could not cache booking locally', err);
    }

    // Pass event back to parent calendar
    const newCalendarEvent: CalendarEvent = {
      id: meetingId,
      title: `${selectedMeetingType.name} - ${fullName}`,
      time: `${selectedDate} ${selectedTimeSlot}`,
      type: selectedMeetingType.durationMinutes <= 15 ? 'call' : 'demo',
      contact: fullName,
      status: 'upcoming',
      meetingLink,
      invitees: email + (guestEmails ? `, ${guestEmails}` : '')
    };

    if (onBookingCreated) {
      onBookingCreated(newCalendarEvent);
    }

    setIsSubmitting(false);
    setPhase('confirmation');
  };

  // Download ICS
  const handleDownloadICS = () => {
    if (!confirmedBooking) return;
    const icsData = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Calendly Reservation Page//EN
BEGIN:VEVENT
UID:${confirmedBooking.id}@calendly.reservation
DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').split('.')[0]}Z
SUMMARY:${confirmedBooking.title}
DESCRIPTION:${confirmedBooking.meetingType.description}\\n\\nMeeting Link: ${confirmedBooking.meetingLink}
LOCATION:${confirmedBooking.meetingLink}
STATUS:CONFIRMED
END:VEVENT
END:VCALENDAR`;

    const blob = new Blob([icsData], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `${confirmedBooking.meetingType.name.toLowerCase().replace(/\s+/g, '_')}.ics`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const getGoogleCalendarUrl = () => {
    if (!confirmedBooking) return '#';
    const text = encodeURIComponent(confirmedBooking.title);
    const details = encodeURIComponent(`Meeting Link: ${confirmedBooking.meetingLink}\n\nHost: ACME Inc.\nDescription: ${confirmedBooking.notes}`);
    const location = encodeURIComponent(confirmedBooking.meetingLink);
    return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${text}&details=${details}&location=${location}`;
  };

  const selectedTzObj = TIMEZONES.find(t => t.tz === userTimezone) || TIMEZONES[0];

  return (
    <div 
      id="obsidian-reservation-page-root" 
      className={`w-full font-sans antialiased text-slate-800 ${
        embedded ? 'p-1 sm:p-4 bg-transparent' : 'p-4 sm:p-10 min-h-screen bg-slate-50 flex flex-col items-center justify-center'
      }`}
    >
      {/* 1. Header Branding Top Bar */}
      <div className="w-full max-w-4xl mx-auto mb-6 text-center space-y-2">
        <div className="inline-flex items-center justify-center gap-2">
          <div className="h-7 w-7 rounded-lg bg-blue-600 flex items-center justify-center shadow-md shadow-blue-500/20 text-white font-black text-xs">
            <Sparkles className="h-4 w-4" />
          </div>
          <span className="font-extrabold text-lg text-slate-800 tracking-tight">Obsidian Core Calendar</span>
        </div>
        <h1 className="text-2xl sm:text-3xl font-black text-slate-800 tracking-tight">
          Reservation & Scheduling Page
        </h1>
      </div>

      {/* 2. Main Reservation White Card */}
      <div className="w-full max-w-4xl mx-auto bg-white rounded-3xl border border-slate-200/90 shadow-xl overflow-hidden grid grid-cols-1 md:grid-cols-12 min-h-[580px]">
        
        {/* ============================================== */}
        {/* LEFT COLUMN (md:col-span-5): Host Branding & Details */}
        {/* ============================================== */}
        <div className="md:col-span-5 p-6 sm:p-8 border-b md:border-b-0 md:border-r border-slate-100 flex flex-col justify-between bg-white relative">
          <div className="space-y-6">
            
            {/* Logo folded badge or Custom Uploaded Logo */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {companyLogoUrl ? (
                  <img 
                    src={companyLogoUrl} 
                    alt={companyName}
                    className="h-12 w-12 rounded-2xl object-cover border border-slate-200 shadow-md"
                  />
                ) : (
                  <div className="h-12 w-12 rounded-2xl bg-blue-600 flex items-center justify-center text-white shadow-lg shadow-blue-500/20">
                    {selectedBadgePreset === 'diamond' && <Sparkles className="h-6 w-6" />}
                    {selectedBadgePreset === 'layers' && (
                      <svg className="h-7 w-7 fill-current" viewBox="0 0 24 24">
                        <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    )}
                    {selectedBadgePreset === 'hexagon' && <Building className="h-6 w-6" />}
                    {selectedBadgePreset === 'star' && <CheckCircle2 className="h-6 w-6" />}
                  </div>
                )}
              </div>

              {/* Edit Logo & Branding Button */}
              <button
                type="button"
                onClick={() => {
                  setTempCompanyName(companyName);
                  setTempLogoUrl(companyLogoUrl || '');
                  setShowEditBrandingModal(true);
                }}
                className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-extrabold text-[11px] flex items-center gap-1 transition-all cursor-pointer shadow-2xs"
                title="Edit Company Logo & Branding Name"
              >
                <Sparkles className="h-3 w-3 text-blue-600" />
                <span>Edit Logo</span>
              </button>
            </div>

            {/* Company Name & Page Title */}
            <div>
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">
                {companyName}
              </p>
              <h2 className="text-2xl font-black text-slate-800 tracking-tight leading-snug">
                {selectedMeetingType.name}
              </h2>
            </div>

            {/* Metadata Badges (Duration + Location Type) */}
            <div className="space-y-3 font-medium text-slate-600 text-sm">
              <div className="flex items-center gap-2.5">
                <Clock className="h-4.5 w-4.5 text-slate-500 shrink-0" />
                <span className="font-semibold text-slate-700">{selectedMeetingType.duration}</span>
              </div>

              <div className="flex items-center gap-2.5">
                {selectedMeetingType.locationType === 'phone' ? (
                  <Phone className="h-4.5 w-4.5 text-slate-500 shrink-0" />
                ) : (
                  <Video className="h-4.5 w-4.5 text-slate-500 shrink-0" />
                )}
                <span className="font-semibold text-slate-700">{selectedMeetingType.location}</span>
              </div>
            </div>

            {/* Description Paragraph */}
            <p className="text-xs sm:text-sm text-slate-600 leading-relaxed font-normal">
              {selectedMeetingType.description}
            </p>

            {/* Meeting Type Selector Buttons */}
            <div className="pt-2">
              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
                Switch Meeting Type
              </label>
              <div className="space-y-1.5">
                {MEETING_TYPES.map((type) => {
                  const isSelected = selectedMeetingType.id === type.id;
                  return (
                    <button
                      key={type.id}
                      onClick={() => {
                        setSelectedMeetingType(type);
                        setPhase('slot_select');
                      }}
                      className={`w-full text-left px-3 py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-between cursor-pointer border ${
                        isSelected 
                          ? 'bg-blue-50 border-blue-600/40 text-blue-600' 
                          : 'bg-slate-50/80 border-slate-200/80 text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      <span className="truncate pr-2">{type.name}</span>
                      <span className="text-[10px] font-mono font-extrabold px-2 py-0.5 rounded-md bg-white border border-slate-200/60 shadow-2xs">
                        {type.duration}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

          </div>

          {/* Footer Security Badge */}
          <div className="pt-6 border-t border-slate-100 mt-6 flex items-center justify-between text-[11px] text-slate-400">
            <span className="flex items-center gap-1 font-semibold">
              <ShieldCheck className="h-3.5 w-3.5 text-blue-600" />
              Obsidian Core Verified Booking
            </span>
            {onClose && (
              <button onClick={onClose} className="text-slate-500 hover:text-slate-900 underline cursor-pointer">
                Close
              </button>
            )}
          </div>
        </div>

        {/* ============================================== */}
        {/* RIGHT COLUMN (md:col-span-7): Calendar & Form  */}
        {/* ============================================== */}
        <div className="md:col-span-7 p-6 sm:p-8 flex flex-col justify-between bg-white">
          <AnimatePresence mode="wait">
            
            {/* PHASE 1: Date & Time Slot Picker */}
            {phase === 'slot_select' && (
              <motion.div
                key="phase-slot-select"
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                transition={{ duration: 0.15 }}
                className="flex-1 flex flex-col justify-between space-y-6"
              >
                <div>
                  {/* Heading: Select a Date & Time */}
                  <h3 className="text-lg font-extrabold text-slate-800 tracking-tight mb-4">
                    Select a Date & Time
                  </h3>

                  {/* Month Navigation Row */}
                  <div className="flex items-center justify-between mb-4 px-1">
                    <button
                      onClick={handlePrevMonth}
                      className="p-1.5 text-slate-400 hover:text-slate-800 transition-colors cursor-pointer"
                      title="Previous month"
                    >
                      <ChevronLeft className="h-5 w-5" />
                    </button>

                    <span className="text-sm font-bold text-slate-800">
                      {currentMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                    </span>

                    <button
                      onClick={handleNextMonth}
                      className="h-9 w-9 rounded-full bg-blue-50 text-blue-600 border border-blue-100 flex items-center justify-center hover:bg-blue-100 transition-all cursor-pointer shadow-2xs"
                      title="Next month"
                    >
                      <ChevronRight className="h-5 w-5" />
                    </button>
                  </div>

                  {/* Days of Week Header (MON TUE WED THU FRI SAT SUN) */}
                  <div className="grid grid-cols-7 text-center text-[10px] font-extrabold text-slate-400 tracking-wider uppercase mb-3">
                    <span>MON</span>
                    <span>TUE</span>
                    <span>WED</span>
                    <span>THU</span>
                    <span>FRI</span>
                    <span>SAT</span>
                    <span>SUN</span>
                  </div>

                  {/* Date Grid Matrix */}
                  <div className="grid grid-cols-7 gap-2 text-center place-items-center">
                    {currentDaysInMonth.map((dayItem, idx) => {
                      if (!dayItem.isCurrentMonth) {
                        return <div key={`empty-${idx}`} className="h-9 w-9" />;
                      }

                      const isSelected = selectedDate === dayItem.dateString;

                      return (
                        <button
                          key={dayItem.dateString}
                          disabled={dayItem.isDisabled}
                          onClick={() => handleDateClick(dayItem.dateString)}
                          className={`h-9 w-9 rounded-full text-xs font-bold transition-all duration-150 flex flex-col items-center justify-center relative cursor-pointer ${
                            isSelected
                              ? 'bg-blue-600 text-white font-extrabold shadow-md shadow-blue-500/20 scale-105'
                              : dayItem.isAvailable
                              ? 'bg-blue-50/90 text-blue-600 font-bold hover:bg-blue-600 hover:text-white'
                              : 'text-slate-300 cursor-not-allowed font-normal'
                          }`}
                        >
                          <span>{dayItem.dayNumber}</span>
                          {isSelected && (
                            <span className="h-1 w-1 rounded-full bg-white mt-0.2" />
                          )}
                          {!isSelected && dayItem.dayNumber === 22 && (
                            <span className="h-1 w-1 rounded-full bg-blue-600 absolute bottom-1" />
                          )}
                        </button>
                      );
                    })}
                  </div>

                  {/* Time Zone Selector Dropdown (Matching Screenshot: 🌐 Central European Time (8:11pm) v) */}
                  <div className="mt-6 pt-4 border-t border-slate-100">
                    <label className="block text-[11px] font-bold text-slate-900 mb-1.5">
                      Time zone
                    </label>
                    <div className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
                      <Globe className="h-4 w-4 text-slate-600 shrink-0" />
                      <select
                        value={userTimezone}
                        onChange={(e) => setUserTimezone(e.target.value)}
                        className="bg-transparent text-xs font-bold text-slate-800 border-none outline-none cursor-pointer pr-4 hover:text-blue-600 transition-colors"
                      >
                        {TIMEZONES.map(t => (
                          <option key={t.tz} value={t.tz} className="bg-white text-slate-900">
                            {t.name} ({currentTimeFormatted})
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Available Time Slots Section (Appears below when date selected) */}
                  {selectedDate && (
                    <motion.div 
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="mt-5 pt-4 border-t border-slate-100 space-y-2"
                    >
                      <div className="flex items-center justify-between text-xs mb-2">
                        <span className="font-extrabold text-slate-900">Available Slots</span>
                        <span className="font-bold text-blue-600 font-mono">
                          {new Date(selectedDate).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {timeSlots.map(slot => {
                          const isSelectedSlot = selectedTimeSlot === slot;
                          return (
                            <button
                              key={slot}
                              onClick={() => setSelectedTimeSlot(slot)}
                              className={`py-2 px-3 rounded-xl text-xs font-bold transition-all border cursor-pointer ${
                                isSelectedSlot
                                  ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                                  : 'bg-white text-blue-600 border-blue-200 hover:border-blue-600 hover:bg-blue-50/50'
                              }`}
                            >
                              {slot}
                            </button>
                          );
                        })}
                      </div>
                    </motion.div>
                  )}

                </div>

                {/* Continue to Booking Form Button */}
                <div className="pt-4 border-t border-slate-100">
                  <button
                    onClick={() => setPhase('booking_form')}
                    disabled={!selectedDate || !selectedTimeSlot}
                    className="w-full py-3 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-extrabold text-xs shadow-md shadow-blue-500/20 transition-all flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <span>Next: Enter Details</span>
                    <ArrowRight className="h-4 w-4" />
                  </button>
                </div>
              </motion.div>
            )}

            {/* PHASE 2: Visitor Details Form */}
            {phase === 'booking_form' && (
              <motion.div
                key="phase-booking-form"
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                transition={{ duration: 0.15 }}
                className="flex-1 flex flex-col justify-between space-y-4"
              >
                <div>
                  <button
                    onClick={() => setPhase('slot_select')}
                    className="inline-flex items-center gap-1.5 text-xs font-bold text-blue-600 hover:underline mb-3 cursor-pointer"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" />
                    <span>Back to Date & Time Selection</span>
                  </button>

                  <h3 className="text-lg font-extrabold text-slate-800 tracking-tight mb-1">
                    Enter Details
                  </h3>
                  <p className="text-xs text-slate-500 mb-4">
                    📅 {new Date(selectedDate).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })} at {selectedTimeSlot} ({selectedTzObj.code})
                  </p>

                  <form onSubmit={handleSubmitBooking} className="space-y-3 text-xs">
                    {formError && (
                      <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 font-bold text-xs">
                        {formError}
                      </div>
                    )}

                    <div>
                      <label className="font-bold text-slate-700 block mb-1">Full Name *</label>
                      <input 
                        type="text" 
                        required
                        placeholder="John Doe"
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-slate-900 outline-none focus:bg-white focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
                      />
                    </div>

                    <div>
                      <label className="font-bold text-slate-700 block mb-1">Work Email Address *</label>
                      <input 
                        type="email" 
                        required
                        placeholder="john@company.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-slate-900 outline-none focus:bg-white focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="font-bold text-slate-700 block mb-1">Company / Org</label>
                        <input 
                          type="text" 
                          placeholder="Acme Corp"
                          value={company}
                          onChange={(e) => setCompany(e.target.value)}
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2 text-slate-900 outline-none"
                        />
                      </div>
                      <div>
                        <label className="font-bold text-slate-700 block mb-1">Phone Number</label>
                        <input 
                          type="text" 
                          placeholder="+1 (555) 019-2834"
                          value={phone}
                          onChange={(e) => setPhone(e.target.value)}
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2 text-slate-900 outline-none"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="font-bold text-slate-700 block mb-1">Additional Notes / Preparation Goals</label>
                      <textarea 
                        rows={2}
                        placeholder="Please share anything that will help prepare for our meeting..."
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2 text-slate-900 outline-none resize-none"
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={isSubmitting}
                      className="w-full py-3 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-extrabold text-xs shadow-md shadow-blue-500/20 transition-all flex items-center justify-center gap-2 cursor-pointer mt-2"
                    >
                      {isSubmitting ? (
                        <span>Confirming Reservation...</span>
                      ) : (
                        <>
                          <span>Schedule Event</span>
                          <CheckCircle2 className="h-4 w-4" />
                        </>
                      )}
                    </button>
                  </form>
                </div>
              </motion.div>
            )}

            {/* PHASE 3: Confirmation Screen */}
            {phase === 'confirmation' && confirmedBooking && (
              <motion.div
                key="phase-confirmation"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.2 }}
                className="flex-1 flex flex-col justify-between space-y-4"
              >
                <div className="text-center space-y-3">
                  <div className="h-12 w-12 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto shadow-sm">
                    <CheckCircle2 className="h-7 w-7" />
                  </div>

                  <h3 className="text-xl font-black text-slate-800 tracking-tight">
                    You are Scheduled!
                  </h3>
                  <p className="text-xs text-slate-600">
                    A calendar invitation has been sent to <span className="font-bold text-slate-900">{confirmedBooking.visitorEmail}</span>.
                  </p>

                  <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 text-left space-y-2 text-xs">
                    <p><span className="font-bold text-slate-500">Event:</span> {confirmedBooking.title}</p>
                    <p><span className="font-bold text-slate-500">Date:</span> {confirmedBooking.dateReadable}</p>
                    <p><span className="font-bold text-slate-500">Time:</span> {confirmedBooking.timeSlot} ({selectedTzObj.code})</p>
                    <p><span className="font-bold text-slate-500">Location:</span> {confirmedBooking.meetingType.location}</p>
                    <div className="pt-2 border-t border-slate-200/80 flex items-center justify-between">
                      <span className="font-mono text-[11px] text-blue-600 truncate mr-2">{confirmedBooking.meetingLink}</span>
                      <a 
                        href={confirmedBooking.meetingLink} 
                        target="_blank" 
                        rel="noreferrer"
                        className="px-2.5 py-1 rounded-lg bg-blue-600 text-white font-bold text-[11px] flex items-center gap-1 shrink-0"
                      >
                        <span>Join</span>
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row gap-2 pt-2">
                    <a
                      href={getGoogleCalendarUrl()}
                      target="_blank"
                      rel="noreferrer"
                      className="flex-1 py-2.5 px-3 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 text-slate-800 font-extrabold text-xs shadow-2xs flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <CalendarIcon className="h-4 w-4 text-blue-600" />
                      <span>Add to Google Calendar</span>
                    </a>

                    <button
                      onClick={handleDownloadICS}
                      className="flex-1 py-2.5 px-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-extrabold text-xs shadow-2xs flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <Download className="h-4 w-4" />
                      <span>Download iCal (.ics)</span>
                    </button>
                  </div>
                </div>

                <div className="pt-4 border-t border-slate-100 text-center">
                  <button
                    onClick={() => {
                      setPhase('slot_select');
                      setConfirmedBooking(null);
                    }}
                    className="text-xs font-bold text-blue-600 hover:underline cursor-pointer"
                  >
                    Schedule Another Appointment
                  </button>
                </div>
              </motion.div>
            )}

          </AnimatePresence>
        </div>

      </div>

      {/* 3. MODAL: Edit Company Logo & Branding */}
      {showEditBrandingModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl max-w-md w-full p-6 space-y-4 animate-scale-up">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-blue-600" />
                <h3 className="font-extrabold text-base text-slate-800">Customize Company Logo & Branding</h3>
              </div>
              <button 
                onClick={() => setShowEditBrandingModal(false)}
                className="p-1 rounded-xl text-slate-400 hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSaveBranding} className="space-y-4 text-xs">
              <div>
                <label className="font-extrabold text-slate-700 block mb-1">Company / Organization Name</label>
                <input 
                  type="text" 
                  required
                  value={tempCompanyName}
                  onChange={(e) => setTempCompanyName(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-slate-900 font-bold outline-none focus:bg-white focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
                  placeholder="e.g. Acme Corp"
                />
              </div>

              <div>
                <label className="font-extrabold text-slate-700 block mb-1">Company Logo Image (URL or Upload)</label>
                <div className="space-y-2">
                  <input 
                    type="url" 
                    value={tempLogoUrl}
                    onChange={(e) => setTempLogoUrl(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-slate-900 outline-none focus:bg-white focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
                    placeholder="https://example.com/logo.png"
                  />
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-slate-400 font-bold">OR UPLOAD FILE:</span>
                    <input 
                      type="file" 
                      accept="image/*"
                      onChange={handleLogoFileUpload}
                      className="text-xs text-slate-500 file:mr-2 file:py-1 file:px-3 file:rounded-xl file:border-0 file:text-xs file:font-extrabold file:bg-blue-50 file:text-blue-600 hover:file:bg-blue-100 cursor-pointer"
                    />
                  </div>
                </div>
              </div>

              {tempLogoUrl && (
                <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200 flex items-center gap-3">
                  <img src={tempLogoUrl} alt="Logo preview" className="h-10 w-10 object-cover rounded-xl border border-slate-200" />
                  <div className="flex-1">
                    <p className="font-bold text-slate-800 text-xs">Custom Logo Loaded</p>
                    <button 
                      type="button" 
                      onClick={() => setTempLogoUrl('')}
                      className="text-[10px] font-bold text-rose-600 hover:underline cursor-pointer"
                    >
                      Remove custom logo
                    </button>
                  </div>
                </div>
              )}

              <div>
                <label className="font-extrabold text-slate-700 block mb-1">Or Choose Preset Icon Badge</label>
                <div className="grid grid-cols-4 gap-2">
                  {(['diamond', 'layers', 'hexagon', 'star'] as const).map(preset => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => {
                        setSelectedBadgePreset(preset);
                        setTempLogoUrl('');
                      }}
                      className={`p-3 rounded-2xl border flex flex-col items-center justify-center gap-1 transition-all cursor-pointer ${
                        selectedBadgePreset === preset && !tempLogoUrl
                          ? 'bg-blue-50 border-blue-600 text-blue-600 font-bold'
                          : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      {preset === 'diamond' && <Sparkles className="h-5 w-5" />}
                      {preset === 'layers' && (
                        <svg className="h-5 w-5 fill-current" viewBox="0 0 24 24">
                          <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      )}
                      {preset === 'hexagon' && <Building className="h-5 w-5" />}
                      {preset === 'star' && <CheckCircle2 className="h-5 w-5" />}
                      <span className="text-[10px] capitalize font-bold">{preset}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
                <button
                  type="submit"
                  className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-extrabold rounded-xl shadow-md cursor-pointer transition-all text-xs"
                >
                  Save Branding
                </button>
                <button
                  type="button"
                  onClick={() => setShowEditBrandingModal(false)}
                  className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl cursor-pointer text-xs"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
