import React, { useState, useMemo } from 'react';
import { 
  Calendar as CalendarIcon, 
  ChevronLeft, 
  ChevronRight, 
  Clock, 
  Plus, 
  Linkedin, 
  Instagram, 
  Facebook, 
  Twitter, 
  Share2 
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export interface CalendarPost {
  id: string;
  caption: string;
  platforms: string[];
  scheduledAt: string; // Formatted date & time string e.g., "Jun 29, 2026, 10:00 AM" or ISO string
  status: string;
  mediaUrl?: string;
  mediaName?: string;
}

interface WeeklyCalendarProps {
  posts: CalendarPost[];
  onQuickSchedule?: (dateString: string) => void;
  className?: string;
}

/**
 * WeeklyCalendar Component
 * Renders a highly-polished 7-day grid showing scheduled posts distributed across the week.
 * Users can spot gaps in their social media plan and click "+" to quickly schedule posts for empty days.
 */
export default function WeeklyCalendar({
  posts,
  onQuickSchedule,
  className = ''
}: WeeklyCalendarProps) {
  // Use today's date as the default focus
  const [currentDate, setCurrentDate] = useState<Date>(() => new Date());

  // Get the Sunday of the current week (start of week)
  const weekStart = useMemo(() => {
    const start = new Date(currentDate);
    const day = start.getDay(); // 0 (Sun) - 6 (Sat)
    start.setDate(start.getDate() - day);
    start.setHours(0, 0, 0, 0);
    return start;
  }, [currentDate]);

  // Generate 7 days of the week starting from Sunday
  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const day = new Date(weekStart);
      day.setDate(weekStart.getDate() + i);
      return day;
    });
  }, [weekStart]);

  // Navigate to previous week
  const handlePrevWeek = () => {
    setCurrentDate(prev => {
      const next = new Date(prev);
      next.setDate(prev.getDate() - 7);
      return next;
    });
  };

  // Navigate to next week
  const handleNextWeek = () => {
    setCurrentDate(prev => {
      const next = new Date(prev);
      next.setDate(prev.getDate() + 7);
      return next;
    });
  };

  // Reset to current week (today)
  const handleGoToToday = () => {
    setCurrentDate(new Date());
  };

  // Helper to parse post date safely and check if it matches a specific day
  const getPostsForDay = (day: Date) => {
    return posts.filter(post => {
      try {
        const postDate = new Date(post.scheduledAt);
        if (isNaN(postDate.getTime())) return false;
        
        return (
          postDate.getFullYear() === day.getFullYear() &&
          postDate.getMonth() === day.getMonth() &&
          postDate.getDate() === day.getDate()
        );
      } catch {
        return false;
      }
    });
  };

  // Format date range string for week header e.g. "Jun 28 - Jul 04, 2026"
  const weekHeaderRange = useMemo(() => {
    const firstDay = weekDays[0];
    const lastDay = weekDays[6];

    const firstMonth = firstDay.toLocaleDateString('en-US', { month: 'short' });
    const lastMonth = lastDay.toLocaleDateString('en-US', { month: 'short' });
    
    if (firstDay.getFullYear() !== lastDay.getFullYear()) {
      return `${firstMonth} ${firstDay.getDate()}, ${firstDay.getFullYear()} - ${lastMonth} ${lastDay.getDate()}, ${lastDay.getFullYear()}`;
    }
    
    if (firstMonth !== lastMonth) {
      return `${firstMonth} ${firstDay.getDate()} - ${lastMonth} ${lastDay.getDate()}, ${firstDay.getFullYear()}`;
    }

    return `${firstMonth} ${firstDay.getDate()} - ${lastDay.getDate()}, ${firstDay.getFullYear()}`;
  }, [weekDays]);

  // Icon mapping for social platforms
  const getPlatformIcon = (platform: string) => {
    const lower = platform.toLowerCase();
    if (lower.includes('linkedin')) return <Linkedin className="h-2.5 w-2.5 fill-current" />;
    if (lower.includes('instagram')) return <Instagram className="h-2.5 w-2.5" />;
    if (lower.includes('facebook')) return <Facebook className="h-2.5 w-2.5 fill-current" />;
    if (lower.includes('twitter') || lower.includes('x')) return <Twitter className="h-2.5 w-2.5" />;
    return <Share2 className="h-2.5 w-2.5" />;
  };

  // Badge background color for platforms
  const getPlatformClass = (platform: string) => {
    const lower = platform.toLowerCase();
    if (lower.includes('linkedin')) return 'bg-blue-50 text-blue-700 border-blue-150';
    if (lower.includes('instagram')) return 'bg-pink-50 text-pink-700 border-pink-150';
    if (lower.includes('facebook')) return 'bg-indigo-50 text-indigo-700 border-indigo-150';
    if (lower.includes('twitter') || lower.includes('x')) return 'bg-slate-900 text-white border-slate-850';
    return 'bg-slate-50 text-slate-500 border-slate-150';
  };

  const today = new Date();
  const isToday = (day: Date) => {
    return (
      day.getFullYear() === today.getFullYear() &&
      day.getMonth() === today.getMonth() &&
      day.getDate() === today.getDate()
    );
  };

  return (
    <div className={`space-y-5 bg-white p-6 rounded-2xl border border-slate-200/80 shadow-3xs ${className}`} id="weekly-calendar-root">
      {/* Calendar Header with Navigation controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-4">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 bg-emerald-50 rounded-xl flex items-center justify-center text-[var(--text)]">
            <CalendarIcon className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-xs font-black uppercase text-slate-400 tracking-wider">Plan & Coverage Optimizer</h3>
            <span className="text-sm font-black text-slate-800 block mt-0.5">{weekHeaderRange}</span>
          </div>
        </div>

        {/* Navigation Actions */}
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <button
            onClick={handleGoToToday}
            className="px-3 py-1.5 bg-slate-50 hover:bg-slate-100 text-slate-700 text-[10.5px] font-black uppercase tracking-wider rounded-lg border border-slate-200 transition-colors cursor-pointer"
          >
            Today
          </button>
          
          <div className="flex items-center border border-slate-200 rounded-lg bg-white overflow-hidden">
            <button
              onClick={handlePrevWeek}
              className="p-1.5 hover:bg-slate-50 text-slate-600 transition-colors border-r border-slate-200 cursor-pointer"
              title="Previous Week"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              onClick={handleNextWeek}
              className="p-1.5 hover:bg-slate-50 text-slate-600 transition-colors cursor-pointer"
              title="Next Week"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* 7-Day Weekly Grid */}
      <div className="grid grid-cols-1 md:grid-cols-7 gap-3.5 items-start">
        {weekDays.map((day, idx) => {
          const dayPosts = getPostsForDay(day);
          const hasPosts = dayPosts.length > 0;
          const dayName = day.toLocaleDateString('en-US', { weekday: 'short' });
          const dayNum = day.getDate();
          const formattedDateVal = day.toISOString().split('T')[0];

          return (
            <div 
              key={idx} 
              className={`flex flex-col rounded-xl border min-h-[170px] transition-all duration-300 ${
                isToday(day) 
                  ? 'bg-emerald-50/20 border-emerald-400/80 ring-1 ring-emerald-400/10' 
                  : 'bg-slate-50/10 border-slate-200/80'
              }`}
            >
              {/* Day column header */}
              <div className={`p-2.5 border-b flex items-center justify-between ${
                isToday(day) 
                  ? 'bg-emerald-50/50 border-emerald-150/60' 
                  : 'bg-slate-50/30 border-slate-100'
              }`}>
                <div className="flex items-baseline gap-1.5">
                  <span className={`text-[11px] font-black uppercase tracking-wider ${
                    isToday(day) ? 'text-emerald-850' : 'text-slate-400'
                  }`}>
                    {dayName}
                  </span>
                  <span className={`text-sm font-black ${
                    isToday(day) ? 'text-emerald-900 bg-emerald-400/20 px-1.5 py-0.5 rounded-md leading-none' : 'text-slate-700'
                  }`}>
                    {dayNum}
                  </span>
                </div>

                {onQuickSchedule && (
                  <button
                    onClick={() => onQuickSchedule(formattedDateVal)}
                    className="p-0.5 bg-slate-100 hover:bg-slate-200/80 text-slate-500 hover:text-emerald-700 rounded-md transition-colors cursor-pointer"
                    title={`Quick schedule for ${dayName}`}
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                )}
              </div>

              {/* Day Posts or empty state slot */}
              <div className="p-2 flex-1 flex flex-col gap-2 min-h-[120px]">
                {hasPosts ? (
                  dayPosts.map(post => {
                    const postTime = (() => {
                      try {
                        const dateObj = new Date(post.scheduledAt);
                        return dateObj.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
                      } catch {
                        return '';
                      }
                    })();

                    return (
                      <div 
                        key={post.id} 
                        className="bg-white rounded-lg border border-slate-150 p-2 shadow-4xs space-y-1.5 hover:border-slate-300 transition-colors group relative"
                      >
                        {/* Platforms summary bar */}
                        <div className="flex items-center justify-between">
                          <div className="flex gap-0.5">
                            {post.platforms.map(p => (
                              <span 
                                key={p} 
                                className={`p-0.5 rounded border text-[8px] flex items-center justify-center ${getPlatformClass(p)}`}
                                title={p}
                              >
                                {getPlatformIcon(p)}
                              </span>
                            ))}
                          </div>
                          <span className="text-[8px] font-bold text-slate-450 flex items-center gap-0.5 font-mono">
                            <Clock className="h-2 w-2" />
                            {postTime}
                          </span>
                        </div>

                        {/* Post caption teaser */}
                        <p className="text-[9.5px] font-semibold text-slate-600 line-clamp-2 leading-snug break-words">
                          {post.caption}
                        </p>

                        {/* Tiny image icon indicator if media exists */}
                        {post.mediaUrl && (
                          <div className="h-4.5 rounded overflow-hidden border border-slate-100 aspect-video w-full mt-1">
                            <img 
                              src={post.mediaUrl} 
                              alt="media preview" 
                              className="w-full h-full object-cover" 
                            />
                          </div>
                        )}
                      </div>
                    );
                  })
                ) : (
                  <div className="flex-1 border-2 border-dashed border-slate-200/50 rounded-lg flex flex-col items-center justify-center p-2 text-center text-slate-350 bg-slate-50/5">
                    <span className="text-[8.5px] font-bold leading-normal block">Planning Gap</span>
                    <span className="text-[7.5px] text-slate-400 mt-0.5">No posts queued</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
