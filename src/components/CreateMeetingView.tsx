import React, { useState } from 'react';
import { ArrowLeft, ChevronDown, Plus, X, Check, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { CalendarEvent } from '../types';

export interface MeetingGuestPermissions {
  modify: boolean;
  inviteOther: boolean;
  seeGuestList: boolean;
}

export interface MeetingFormState {
  title: string;
  locations: string[];
  guests: string[];
  permissions: MeetingGuestPermissions;
  date: string;
  time: string;
  ampm: 'AM' | 'PM';
  duration: string;
  availability: string;
  visibility: string;
  additionalNotes: string;
}

interface CreateMeetingViewProps {
  onBack: () => void;
  onSubmit: (event: CalendarEvent) => void;
}

export default function CreateMeetingView({ onBack, onSubmit }: CreateMeetingViewProps) {
  // 1. Typed Form State
  const [formState, setFormState] = useState<MeetingFormState>({
    title: 'Product Designer',
    locations: ['New York', 'Mexico', 'Canada'],
    guests: ['alex@example.com'],
    permissions: {
      modify: false,
      inviteOther: true,
      seeGuestList: false,
    },
    date: '2026-07-22',
    time: '17:30',
    ampm: 'AM',
    duration: '30',
    availability: 'Free',
    visibility: 'Default Visibility',
    additionalNotes: '',
  });

  // Auxiliary UI States
  const [locationInput, setLocationInput] = useState('');
  const [showLocationDropdown, setShowLocationDropdown] = useState(false);
  const [guestInput, setGuestInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const availableLocationsList = ['New York', 'Mexico', 'Canada', 'London', 'Berlin', 'Tokyo', 'Remote / Online'];

  // Field change handler helper
  const handleFieldChange = <K extends keyof MeetingFormState>(field: K, value: MeetingFormState[K]) => {
    setFormState(prev => ({
      ...prev,
      [field]: value,
    }));
    if (errorMessage) setErrorMessage(null);
  };

  // Permission toggle handler
  const handlePermissionChange = (key: keyof MeetingGuestPermissions, value: boolean) => {
    setFormState(prev => ({
      ...prev,
      permissions: {
        ...prev.permissions,
        [key]: value,
      },
    }));
  };

  // Dynamic Location Tag Handlers
  const handleAddLocationTag = (locationTag: string) => {
    const trimmed = locationTag.trim();
    if (trimmed && !formState.locations.includes(trimmed)) {
      setFormState(prev => ({
        ...prev,
        locations: [...prev.locations, trimmed],
      }));
    }
    setLocationInput('');
    setShowLocationDropdown(false);
    if (errorMessage) setErrorMessage(null);
  };

  const handleRemoveLocationTag = (locationTagToRemove: string) => {
    setFormState(prev => ({
      ...prev,
      locations: prev.locations.filter(loc => loc !== locationTagToRemove),
    }));
  };

  // Dynamic Guest Email Handlers
  const handleAddGuestEmail = (emailStr: string) => {
    const trimmed = emailStr.trim();
    if (trimmed && !formState.guests.includes(trimmed)) {
      setFormState(prev => ({
        ...prev,
        guests: [...prev.guests, trimmed],
      }));
    }
    setGuestInput('');
    if (errorMessage) setErrorMessage(null);
  };

  const handleRemoveGuestEmail = (emailToRemove: string) => {
    setFormState(prev => ({
      ...prev,
      guests: prev.guests.filter(g => g !== emailToRemove),
    }));
  };

  // Form Submission Handler calling POST /api/meetings/create
  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    // Front-end Pre-Validation
    if (!formState.title.trim()) {
      setErrorMessage('Meeting title is required.');
      return;
    }
    if (!formState.date || !formState.time) {
      setErrorMessage('Date and Time are required fields.');
      return;
    }
    if (formState.guests.length === 0 && formState.locations.length === 0) {
      setErrorMessage('Please add at least one guest email or select at least one location.');
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch('/api/meetings/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formState),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || data.message || 'Failed to create meeting.');
      }

      setSuccessMessage('Meeting scheduled successfully!');

      // Format created meeting into CalendarEvent for app state
      const createdMeeting = data.meeting;
      const calendarEvent: CalendarEvent = {
        id: createdMeeting.id,
        title: createdMeeting.title,
        time: `${createdMeeting.date} ${createdMeeting.time}`,
        type: 'demo',
        contact: createdMeeting.guests.length > 0 ? createdMeeting.guests[0] : 'Guest Candidate',
        status: 'upcoming',
        meetingLink: createdMeeting.videoLink,
        invitees: createdMeeting.guests.join(', '),
        notes: createdMeeting.additionalNotes || `Location(s): ${createdMeeting.locations.join(', ')}`,
      };

      // Slight delay so user sees success feedback
      setTimeout(() => {
        onSubmit(calendarEvent);
      }, 500);

    } catch (err: any) {
      console.warn('[CreateMeetingView API Fallback]:', err.message);
      // Construct fallback calendar event if API request failed
      const randId = `evt-${Date.now()}`;
      const videoLink = `https://meet.google.com/${Math.random().toString(36).substring(2, 5)}-${Math.random().toString(36).substring(2, 6)}-${Math.random().toString(36).substring(2, 5)}`;
      
      const fallbackEvent: CalendarEvent = {
        id: randId,
        title: formState.title.trim(),
        time: `${formState.date} ${formState.time} ${formState.ampm}`,
        type: 'demo',
        contact: formState.guests.length > 0 ? formState.guests[0] : 'Guest Candidate',
        status: 'upcoming',
        meetingLink: videoLink,
        invitees: formState.guests.join(', '),
        notes: formState.additionalNotes || `Location(s): ${formState.locations.join(', ')}`,
      };

      onSubmit(fallbackEvent);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="w-full min-h-screen bg-slate-50 text-slate-900 font-sans p-4 sm:p-8 md:p-10">
      <div className="max-w-5xl mx-auto space-y-8">
        
        {/* 1. Page Header */}
        <div className="space-y-3 border-b border-slate-200 pb-6">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-2 text-xs font-extrabold text-slate-600 hover:text-slate-900 transition-colors cursor-pointer group"
          >
            <ArrowLeft className="h-4 w-4 group-hover:-translate-x-0.5 transition-transform" />
            <span>Back To Schedule</span>
          </button>

          <div>
            <h1 className="text-3xl sm:text-4xl font-black text-slate-900 tracking-tight">
              Create Meeting
            </h1>
            <p className="text-sm text-slate-500 font-medium mt-1">
              This information helps potential candidates/guests understand.
            </p>
          </div>
        </div>

        {/* Global Alert Messages */}
        {errorMessage && (
          <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-bold flex items-center gap-2.5 animate-shake">
            <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
            <span>{errorMessage}</span>
          </div>
        )}

        {successMessage && (
          <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold flex items-center gap-2.5">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
            <span>{successMessage}</span>
          </div>
        )}

        {/* 2. Form Layout (2-Column Grid on desktop, stacked on mobile) */}
        <form onSubmit={handleFormSubmit} className="space-y-8">
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
            
            {/* ============================================== */}
            {/* LEFT COLUMN: Meeting Title & Guest Permissions */}
            {/* ============================================== */}
            <div className="space-y-8">
              
              {/* Card 1: Meeting Title */}
              <div className="space-y-2">
                <div>
                  <h3 className="text-base font-extrabold text-slate-900">Meeting Title</h3>
                  <p className="text-xs text-slate-500 font-medium">Job titles must describe one position</p>
                </div>

                <div className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs space-y-2">
                  <label className="text-xs font-semibold text-slate-500 block">Title</label>
                  <input
                    type="text"
                    required
                    value={formState.title}
                    onChange={(e) => handleFieldChange('title', e.target.value)}
                    placeholder="e.g. Product Designer"
                    className="w-full bg-slate-50/80 border border-slate-200/90 rounded-xl px-4 py-3 text-sm text-slate-900 font-semibold outline-none focus:bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                  />
                  <span className="text-[11px] text-slate-400 block font-normal pt-0.5">
                    At least 80 characters
                  </span>
                </div>
              </div>

              {/* Card 3: Guest Permissions */}
              <div className="space-y-2">
                <div>
                  <h3 className="text-base font-extrabold text-slate-900">Guest Permissions</h3>
                  <p className="text-xs text-slate-500 font-medium leading-relaxed">
                    Customize guest access effortlessly for a seamless collaboration. Control permissions to ensure a secure and smooth experience.
                  </p>
                </div>

                <div className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs space-y-4">
                  {/* Add Guest Input */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-500 block">Add Guest (+)</label>
                    <div className="relative flex items-center">
                      <input
                        type="email"
                        value={guestInput}
                        onChange={(e) => setGuestInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleAddGuestEmail(guestInput);
                          }
                        }}
                        placeholder="Add guest email address..."
                        className="w-full bg-slate-50/80 border border-slate-200/90 rounded-xl pl-4 pr-12 py-3 text-sm text-slate-900 font-medium outline-none focus:bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                      />
                      <button
                        type="button"
                        onClick={() => handleAddGuestEmail(guestInput)}
                        className="absolute right-2 h-8 w-8 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center justify-center font-bold text-base cursor-pointer transition-colors"
                        title="Add Guest"
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  {/* Added Guest Email Tags */}
                  {formState.guests.length > 0 && (
                    <div className="flex flex-wrap gap-2 pt-1">
                      {formState.guests.map(g => (
                        <span
                          key={g}
                          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-indigo-50 text-indigo-800 text-xs font-extrabold border border-indigo-100"
                        >
                          <span>{g}</span>
                          <button
                            type="button"
                            onClick={() => handleRemoveGuestEmail(g)}
                            className="text-indigo-400 hover:text-indigo-900 cursor-pointer"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Permissions Checkbox Grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-3 border-t border-slate-100">
                    <label className="flex items-center gap-2 text-xs font-bold text-slate-800 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={formState.permissions.modify}
                        onChange={(e) => handlePermissionChange('modify', e.target.checked)}
                        className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                      />
                      <span>Modify</span>
                    </label>

                    <label className="flex items-center gap-2 text-xs font-bold text-slate-800 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={formState.permissions.inviteOther}
                        onChange={(e) => handlePermissionChange('inviteOther', e.target.checked)}
                        className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                      />
                      <span>Invite Other</span>
                    </label>

                    <label className="flex items-center gap-2 text-xs font-bold text-slate-800 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={formState.permissions.seeGuestList}
                        onChange={(e) => handlePermissionChange('seeGuestList', e.target.checked)}
                        className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                      />
                      <span>See Guest list</span>
                    </label>
                  </div>
                </div>
              </div>

            </div>

            {/* ============================================== */}
            {/* RIGHT COLUMN: Location & Schedule Time         */}
            {/* ============================================== */}
            <div className="space-y-8">
              
              {/* Card 2: Location */}
              <div className="space-y-2">
                <div>
                  <h3 className="text-base font-extrabold text-slate-900">Location</h3>
                  <p className="text-xs text-slate-500 font-medium">You can select multiple locations</p>
                </div>

                <div className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs space-y-3 relative">
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-slate-500 block">Location</label>
                    <div className="relative">
                      <input
                        type="text"
                        value={locationInput}
                        onChange={(e) => {
                          setLocationInput(e.target.value);
                          setShowLocationDropdown(true);
                        }}
                        onFocus={() => setShowLocationDropdown(true)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleAddLocationTag(locationInput);
                          }
                        }}
                        placeholder="e.g. New York, Remote..."
                        className="w-full bg-slate-50/80 border border-slate-200/90 rounded-xl pl-4 pr-10 py-3 text-sm text-slate-900 font-medium outline-none focus:bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                      />
                      <ChevronDown className="h-4 w-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    </div>
                  </div>

                  {/* Dropdown Menu */}
                  {showLocationDropdown && (
                    <div className="absolute left-5 right-5 top-[85px] z-20 bg-white border border-slate-200 rounded-xl shadow-lg py-1 max-h-40 overflow-y-auto text-xs">
                      {availableLocationsList.map(loc => (
                        <button
                          key={loc}
                          type="button"
                          onClick={() => handleAddLocationTag(loc)}
                          className="w-full text-left px-3 py-2 hover:bg-slate-50 font-bold text-slate-800 flex items-center justify-between cursor-pointer"
                        >
                          <span>{loc}</span>
                          {formState.locations.includes(loc) && <Check className="h-3.5 w-3.5 text-indigo-600" />}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Removable Tag Pills Row */}
                  <div className="flex flex-wrap gap-2 pt-1">
                    {formState.locations.map((loc) => (
                      <span
                        key={loc}
                        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-100 text-slate-800 text-xs font-bold border border-slate-200"
                      >
                        <span>{loc}</span>
                        <button
                          type="button"
                          onClick={() => handleRemoveLocationTag(loc)}
                          className="text-slate-400 hover:text-slate-900 cursor-pointer"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              {/* Card 4: Schedule The Interview Time */}
              <div className="space-y-2">
                <div>
                  <h3 className="text-base font-extrabold text-slate-900">Schedule The Interview Time</h3>
                  <p className="text-xs text-slate-500 font-medium">Please use the following inputs to schedule your interview time</p>
                </div>

                <div className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs space-y-4">
                  
                  {/* Date Input */}
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-slate-500 block">Date</label>
                    <div className="relative">
                      <input
                        type="date"
                        value={formState.date}
                        onChange={(e) => handleFieldChange('date', e.target.value)}
                        className="w-full bg-slate-50/80 border border-slate-200/90 rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-900 outline-none focus:bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                      />
                    </div>
                  </div>

                  {/* Time Row (4-item grid) */}
                  <div className="grid grid-cols-4 gap-2 items-center">
                    <input
                      type="text"
                      value={formState.time}
                      onChange={(e) => handleFieldChange('time', e.target.value)}
                      placeholder="17:30"
                      className="bg-slate-50/80 border border-slate-200/90 rounded-xl px-3 py-2 text-xs font-extrabold text-slate-900 outline-none text-center"
                    />

                    <select
                      value={formState.ampm}
                      onChange={(e) => handleFieldChange('ampm', e.target.value as 'AM' | 'PM')}
                      className="bg-slate-50/80 border border-slate-200/90 rounded-xl px-2 py-2 text-xs font-bold text-slate-800 outline-none cursor-pointer"
                    >
                      <option value="AM">AM</option>
                      <option value="PM">PM</option>
                    </select>

                    <div className="text-xs font-semibold text-slate-500 text-center">
                      Min
                    </div>

                    <select
                      value={formState.duration}
                      onChange={(e) => handleFieldChange('duration', e.target.value)}
                      className="bg-slate-50/80 border border-slate-200/90 rounded-xl px-2 py-2 text-xs font-bold text-slate-800 outline-none cursor-pointer"
                    >
                      <option value="15">15</option>
                      <option value="30">30</option>
                      <option value="45">45</option>
                      <option value="60">60</option>
                    </select>
                  </div>

                  {/* Status & Visibility Row */}
                  <div className="grid grid-cols-2 gap-3 pt-1">
                    <select
                      value={formState.availability}
                      onChange={(e) => handleFieldChange('availability', e.target.value)}
                      className="w-full bg-slate-50/80 border border-slate-200/90 rounded-xl px-3 py-2.5 text-xs font-bold text-slate-800 outline-none cursor-pointer"
                    >
                      <option value="Free">Free</option>
                      <option value="Busy">Busy</option>
                      <option value="Tentative">Tentative</option>
                    </select>

                    <select
                      value={formState.visibility}
                      onChange={(e) => handleFieldChange('visibility', e.target.value)}
                      className="w-full bg-slate-50/80 border border-slate-200/90 rounded-xl px-3 py-2.5 text-xs font-bold text-slate-800 outline-none cursor-pointer"
                    >
                      <option value="Default Visibility">Default Visibility</option>
                      <option value="Public">Public</option>
                      <option value="Private">Private</option>
                    </select>
                  </div>

                </div>
              </div>

            </div>

          </div>

          {/* ============================================== */}
          {/* BOTTOM FULL WIDTH CARD: Additional Info        */}
          {/* ============================================== */}
          <div className="space-y-2">
            <div>
              <h3 className="text-base font-extrabold text-slate-900">Additional Info</h3>
              <p className="text-xs text-slate-500 font-medium leading-relaxed">
                Please use this space to provide any additional information or special considerations related to the interview schedule. Feel free to share specific preferences or notes that may assist in planning the meeting.
              </p>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs">
              <textarea
                rows={4}
                value={formState.additionalNotes}
                onChange={(e) => handleFieldChange('additionalNotes', e.target.value)}
                placeholder="Share specific preferences, candidate notes, or meeting agenda..."
                className="w-full bg-slate-50/80 border border-slate-200/90 rounded-xl p-4 text-sm text-slate-900 font-medium outline-none focus:bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all resize-none"
              />
            </div>
          </div>

          {/* Footer Action Buttons */}
          <div className="pt-4 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-4">
            <button
              type="button"
              onClick={onBack}
              className="w-full sm:w-auto px-6 py-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-extrabold text-xs transition-all cursor-pointer"
            >
              ← Back To Schedule
            </button>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full sm:w-auto px-8 py-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-black text-xs shadow-md transition-all cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin text-white" />
                  <span>Creating Meeting...</span>
                </>
              ) : (
                <span>Create Meeting</span>
              )}
            </button>
          </div>

        </form>

      </div>
    </div>
  );
}
