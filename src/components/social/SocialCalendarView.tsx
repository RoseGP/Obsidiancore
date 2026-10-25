import React, { useState, useMemo } from 'react';
import { 
  Calendar as CalendarIcon, ChevronLeft, ChevronRight, Plus
} from 'lucide-react';
import { SocialPost, SocialPlatform } from './SocialTypes';

interface SocialCalendarViewProps {
  posts: SocialPost[];
  onSelectPost?: (post: SocialPost) => void;
  onQuickSchedule: (dateString: string) => void;
  onDeletePost?: (postId: string) => void;
  onPublishNow?: (postId: string) => void;
  className?: string;
}

export default function SocialCalendarView({
  posts,
  onSelectPost,
  onQuickSchedule,
  className = ''
}: SocialCalendarViewProps) {
  const [viewMode, setViewMode] = useState<'month' | 'week'>('month');
  const [currentDate, setCurrentDate] = useState<Date>(() => new Date());

  const currentYear = currentDate.getFullYear();
  const currentMonth = currentDate.getMonth();

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  const handlePrev = () => {
    setCurrentDate(prev => {
      const d = new Date(prev);
      if (viewMode === 'month') {
        d.setMonth(d.getMonth() - 1);
      } else {
        d.setDate(d.getDate() - 7);
      }
      return d;
    });
  };

  const handleNext = () => {
    setCurrentDate(prev => {
      const d = new Date(prev);
      if (viewMode === 'month') {
        d.setMonth(d.getMonth() + 1);
      } else {
        d.setDate(d.getDate() + 7);
      }
      return d;
    });
  };

  const handleGoToday = () => {
    setCurrentDate(new Date());
  };

  // Month Grid Calculation (42 cells: 6 weeks x 7 days)
  const monthDays = useMemo(() => {
    const firstDayOfMonth = new Date(currentYear, currentMonth, 1);
    const startingDayOfWeek = firstDayOfMonth.getDay();
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();

    const days: { date: Date; isCurrentMonth: boolean; dateString: string }[] = [];

    const prevMonthDays = new Date(currentYear, currentMonth, 0).getDate();
    for (let i = startingDayOfWeek - 1; i >= 0; i--) {
      const d = new Date(currentYear, currentMonth - 1, prevMonthDays - i);
      days.push({
        date: d,
        isCurrentMonth: false,
        dateString: d.toISOString().split('T')[0]
      });
    }

    for (let i = 1; i <= daysInMonth; i++) {
      const d = new Date(currentYear, currentMonth, i);
      days.push({
        date: d,
        isCurrentMonth: true,
        dateString: d.toISOString().split('T')[0]
      });
    }

    const remaining = (7 - (days.length % 7)) % 7;
    for (let i = 1; i <= remaining; i++) {
      const d = new Date(currentYear, currentMonth + 1, i);
      days.push({
        date: d,
        isCurrentMonth: false,
        dateString: d.toISOString().split('T')[0]
      });
    }

    return days;
  }, [currentYear, currentMonth]);

  // Week Grid Calculation (7 days from Sunday)
  const weekDays = useMemo(() => {
    const start = new Date(currentDate);
    const day = start.getDay();
    start.setDate(start.getDate() - day);
    start.setHours(0, 0, 0, 0);

    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return {
        date: d,
        isCurrentMonth: d.getMonth() === currentMonth,
        dateString: d.toISOString().split('T')[0]
      };
    });
  }, [currentDate, currentMonth]);

  const getPostsForDay = (targetDate: Date) => {
    return posts.filter(post => {
      try {
        const pDate = new Date(post.scheduledAt);
        if (isNaN(pDate.getTime())) return false;
        return (
          pDate.getFullYear() === targetDate.getFullYear() &&
          pDate.getMonth() === targetDate.getMonth() &&
          pDate.getDate() === targetDate.getDate()
        );
      } catch {
        return false;
      }
    });
  };

  const isToday = (d: Date) => {
    const today = new Date();
    return (
      d.getDate() === today.getDate() &&
      d.getMonth() === today.getMonth() &&
      d.getFullYear() === today.getFullYear()
    );
  };

  const renderPlatformBadge = (platform: SocialPlatform) => {
    switch (platform) {
      case 'linkedin':
        return <span key={platform} className="h-4 w-4 rounded-full bg-[#0A66C2] flex items-center justify-center text-white text-[9px] font-bold">in</span>;
      case 'twitter':
        return <span key={platform} className="h-4 w-4 rounded-full bg-neutral-900 flex items-center justify-center text-white text-[9px] font-mono font-bold">𝕏</span>;
      case 'instagram':
        return <span key={platform} className="h-4 w-4 rounded-full bg-gradient-to-tr from-amber-500 via-rose-500 to-purple-600 flex items-center justify-center text-white text-[8px] font-bold">ig</span>;
      case 'facebook':
        return <span key={platform} className="h-4 w-4 rounded-full bg-blue-600 flex items-center justify-center text-white text-[9px] font-bold">f</span>;
      default:
        return <span key={platform} className="h-4 w-4 rounded-full bg-indigo-600 flex items-center justify-center text-white text-[8px] font-bold">#</span>;
    }
  };

  const displayedDays = viewMode === 'month' ? monthDays : weekDays;

  return (
    <div className={`bg-white border border-neutral-200/80 rounded-2xl p-5 space-y-4 shadow-xs ${className}`}>
      {/* Calendar Header Controls */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-3 border-b border-neutral-200">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 shadow-2xs">
            <CalendarIcon className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-neutral-900 tracking-tight">
              {monthNames[currentMonth]} {currentYear}
            </h3>
            <p className="text-xs text-neutral-500">
              {posts.filter(p => p.status === 'SCHEDULED').length} scheduled posts queued
            </p>
          </div>
        </div>

        {/* Navigation & View Modes */}
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-neutral-100 p-1 rounded-xl border border-neutral-200">
            <button
              onClick={() => setViewMode('month')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                viewMode === 'month' ? 'bg-white text-neutral-900 shadow-2xs' : 'text-neutral-600 hover:text-neutral-900'
              }`}
            >
              Month
            </button>
            <button
              onClick={() => setViewMode('week')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                viewMode === 'week' ? 'bg-white text-neutral-900 shadow-2xs' : 'text-neutral-600 hover:text-neutral-900'
              }`}
            >
              Week
            </button>
          </div>

          <div className="flex items-center gap-1 bg-neutral-100 p-1 rounded-xl border border-neutral-200">
            <button
              onClick={handlePrev}
              className="p-1.5 rounded-lg text-neutral-600 hover:text-neutral-900 hover:bg-white transition-colors cursor-pointer"
              title="Previous"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              onClick={handleGoToday}
              className="px-2.5 py-1 text-xs font-semibold text-neutral-700 hover:text-neutral-900 transition-colors cursor-pointer"
            >
              Today
            </button>
            <button
              onClick={handleNext}
              className="p-1.5 rounded-lg text-neutral-600 hover:text-neutral-900 hover:bg-white transition-colors cursor-pointer"
              title="Next"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Week Day Labels */}
      <div className="grid grid-cols-7 gap-2 text-center text-xs font-bold uppercase tracking-wider text-neutral-500 py-1">
        <span>Sun</span>
        <span>Mon</span>
        <span>Tue</span>
        <span>Wed</span>
        <span>Thu</span>
        <span>Fri</span>
        <span>Sat</span>
      </div>

      {/* Calendar Cells Grid */}
      <div className="grid grid-cols-7 gap-2">
        {displayedDays.map(({ date, isCurrentMonth, dateString }) => {
          const dayPosts = getPostsForDay(date);
          const currentDay = isToday(date);

          return (
            <div
              key={dateString}
              className={`min-h-[120px] rounded-xl border p-2 flex flex-col justify-between transition-all group relative ${
                currentDay
                  ? 'bg-indigo-50/40 border-indigo-300 shadow-2xs ring-1 ring-indigo-300/30'
                  : isCurrentMonth
                  ? 'bg-neutral-50/60 border-neutral-200/80 hover:border-indigo-200 hover:bg-neutral-50'
                  : 'bg-neutral-100/40 border-neutral-200/40 opacity-50 hover:opacity-80'
              }`}
            >
              {/* Day Header */}
              <div className="flex items-center justify-between mb-1.5">
                <span
                  className={`text-xs font-bold h-6 w-6 rounded-full flex items-center justify-center ${
                    currentDay
                      ? 'bg-indigo-600 text-white font-bold'
                      : 'text-neutral-700'
                  }`}
                >
                  {date.getDate()}
                </span>

                {/* Quick Add Button on Hover */}
                <button
                  type="button"
                  onClick={() => onQuickSchedule(dateString)}
                  className="opacity-0 group-hover:opacity-100 p-1 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white transition-all cursor-pointer shadow-2xs"
                  title="Schedule post for this date"
                >
                  <Plus className="h-3 w-3" />
                </button>
              </div>

              {/* Day Posts List */}
              <div className="flex-1 space-y-1.5 overflow-y-auto max-h-[100px] scrollbar-none">
                {dayPosts.map((post) => {
                  const isPublished = post.status === 'PUBLISHED';
                  const isFailed = post.status === 'FAILED';

                  return (
                    <div
                      key={post.id}
                      onClick={() => onSelectPost && onSelectPost(post)}
                      className={`p-1.5 rounded-lg border text-left cursor-pointer transition-all hover:scale-[1.01] ${
                        isPublished
                          ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                          : isFailed
                          ? 'bg-rose-50 border-rose-200 text-rose-900'
                          : 'bg-white border-neutral-200 text-neutral-800 shadow-2xs'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1 mb-1">
                        <div className="flex items-center -space-x-1">
                          {post.platforms.map(p => renderPlatformBadge(p))}
                        </div>
                        <span className="text-[9px] font-mono text-neutral-500">
                          {(() => {
                            try {
                              const d = new Date(post.scheduledAt);
                              return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                            } catch {
                              return '';
                            }
                          })()}
                        </span>
                      </div>
                      <p className="text-[11px] font-medium leading-tight truncate text-neutral-700">
                        {post.caption}
                      </p>
                    </div>
                  );
                })}
              </div>

              {/* Empty state shortcut placeholder */}
              {dayPosts.length === 0 && (
                <div 
                  onClick={() => onQuickSchedule(dateString)}
                  className="h-full flex items-center justify-center opacity-0 group-hover:opacity-60 cursor-pointer"
                >
                  <span className="text-[10px] text-neutral-400 font-semibold">+ Schedule</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
