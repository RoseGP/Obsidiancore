import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Globe, Plus, Calendar, Clock, Sparkles, Trash2, CheckCircle2, 
  ChevronLeft, ChevronRight, Filter, AlertCircle, Share2, Eye,
  Instagram, Linkedin, Facebook, Twitter, Send, RefreshCw, Upload, Image as ImageIcon, X
} from 'lucide-react';
import { copyToClipboard } from '../utils/clipboard';

export interface SocialMediaGridPost {
  id: string;
  caption: string;
  platforms: ('linkedin' | 'instagram' | 'facebook' | 'tiktok' | 'twitter' | 'whatsapp' | 'telegram' | 'email')[];
  scheduledAt: string; // YYYY-MM-DD
  scheduledTime?: string; // HH:MM AM/PM
  status: 'SCHEDULED' | 'PUBLISHED' | 'FAILED' | 'PROCESSING' | string;
  mediaUrl?: string;
  likes?: number;
  comments?: number;
}

const INITIAL_GRID_POSTS: SocialMediaGridPost[] = [
  {
    id: 'sg-1',
    caption: '🚀 Elevating Enterprise Cloud Reliability: Explore our high-availability WebRTC telemetry and low-latency infrastructure architectures.',
    platforms: ['linkedin', 'twitter'],
    scheduledAt: '2026-06-15',
    scheduledTime: '09:00 AM',
    status: 'PUBLISHED',
    mediaUrl: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&q=80&w=400',
    likes: 84,
    comments: 12
  },
  {
    id: 'sg-2',
    caption: '🌟 Behind the Scenes: Modern customer engagement platforms require seamless omnichannel communication and AI-powered copilots.',
    platforms: ['instagram', 'facebook'],
    scheduledAt: '2026-06-16',
    scheduledTime: '11:30 AM',
    status: 'SCHEDULED',
    mediaUrl: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&q=80&w=400',
    likes: 42,
    comments: 5
  },
  {
    id: 'sg-3',
    caption: '📊 Q3 Real Estate SLA Proposal Review highlights: How decentralized teams finalize high-stake negotiations in minutes.',
    platforms: ['linkedin', 'whatsapp'],
    scheduledAt: '2026-06-17',
    scheduledTime: '02:15 PM',
    status: 'SCHEDULED',
    mediaUrl: 'https://images.unsplash.com/photo-1557804506-669a67965ba0?auto=format&fit=crop&q=80&w=400',
    likes: 19,
    comments: 3
  },
  {
    id: 'sg-4',
    caption: '🔒 DTLS-SRTP & End-to-End Enterprise Privacy: Securing unified CRM communications at scale with zero compromise on audio clarity.',
    platforms: ['linkedin', 'telegram'],
    scheduledAt: '2026-06-19',
    scheduledTime: '10:00 AM',
    status: 'SCHEDULED',
    mediaUrl: 'https://images.unsplash.com/photo-1563986768609-322da13575f3?auto=format&fit=crop&q=80&w=400',
    likes: 67,
    comments: 9
  },
  {
    id: 'sg-5',
    caption: '🎉 Weekend Tech Brief: Announcing automated speech-to-text pipeline transcription updates and multi-speaker AI diarization.',
    platforms: ['twitter', 'instagram'],
    scheduledAt: '2026-06-20',
    scheduledTime: '04:45 PM',
    status: 'SCHEDULED',
    mediaUrl: 'https://images.unsplash.com/photo-1519389950473-47ba0277781c?auto=format&fit=crop&q=80&w=400',
    likes: 112,
    comments: 24
  }
];

interface SocialMediaGridProps {
  posts?: SocialMediaGridPost[];
  onAddPost?: (post: SocialMediaGridPost) => void;
  onDeletePost?: (id: string) => void;
  onPublishPost?: (id: string) => void;
}

export default function SocialMediaGrid({
  posts: externalPosts,
  onAddPost,
  onDeletePost,
  onPublishPost
}: SocialMediaGridProps) {
  const [posts, setPosts] = useState<SocialMediaGridPost[]>(() => externalPosts && externalPosts.length > 0 ? externalPosts : INITIAL_GRID_POSTS);
  const [platformFilter, setPlatformFilter] = useState<string>('all');
  const [selectedDayKey, setSelectedDayKey] = useState<string>('2026-06-16');
  const [showModal, setShowModal] = useState(false);

  // Scheduling Form State
  const [formCaption, setFormCaption] = useState('');
  const [formPlatforms, setFormPlatforms] = useState<SocialMediaGridPost['platforms']>(['linkedin']);
  const [formDate, setFormDate] = useState('2026-06-16');
  const [formTime, setFormTime] = useState('10:00 AM');
  const [formMediaUrl, setFormMediaUrl] = useState('');

  // Sync external posts if provided
  React.useEffect(() => {
    if (externalPosts && externalPosts.length > 0) {
      setPosts(externalPosts);
    }
  }, [externalPosts]);

  const daysList = [
    { key: '2026-06-15', label: 'Mon', num: '15', month: 'Jun' },
    { key: '2026-06-16', label: 'Tue', num: '16', month: 'Jun' },
    { key: '2026-06-17', label: 'Wed', num: '17', month: 'Jun' },
    { key: '2026-06-18', label: 'Thu', num: '18', month: 'Jun' },
    { key: '2026-06-19', label: 'Fri', num: '19', month: 'Jun' },
    { key: '2026-06-20', label: 'Sat', num: '20', month: 'Jun' },
    { key: '2026-06-21', label: 'Sun', num: '21', month: 'Jun' },
  ];

  const handleOpenSchedule = (dayKey: string) => {
    setSelectedDayKey(dayKey);
    setFormDate(dayKey);
    setShowModal(true);
  };

  const handleTogglePlatform = (p: SocialMediaGridPost['platforms'][number]) => {
    setFormPlatforms(prev => 
      prev.includes(p) 
        ? (prev.length > 1 ? prev.filter(item => item !== p) : prev)
        : [...prev, p]
    );
  };

  const handleCreatePost = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formCaption.trim()) return;

    const newPost: SocialMediaGridPost = {
      id: `sg-post-${Date.now()}`,
      caption: formCaption.trim(),
      platforms: formPlatforms,
      scheduledAt: formDate || selectedDayKey,
      scheduledTime: formTime || '10:00 AM',
      status: 'SCHEDULED',
      mediaUrl: formMediaUrl || undefined,
      likes: 0,
      comments: 0
    };

    setPosts(prev => [...prev, newPost]);
    if (onAddPost) {
      onAddPost(newPost);
    }

    // Reset Form
    setFormCaption('');
    setFormMediaUrl('');
    setShowModal(false);
  };

  const handleDelete = (id: string) => {
    setPosts(prev => prev.filter(p => p.id !== id));
    if (onDeletePost) {
      onDeletePost(id);
    }
  };

  const handlePublishNow = (id: string) => {
    setPosts(prev => prev.map(p => p.id === id ? { ...p, status: 'PUBLISHED' } : p));
    if (onPublishPost) {
      onPublishPost(id);
    }
  };

  const filteredPosts = posts.filter(post => {
    if (platformFilter === 'all') return true;
    return post.platforms.includes(platformFilter as any);
  });

  const getPlatformBadge = (plat: string) => {
    switch (plat) {
      case 'linkedin':
        return { label: 'LI', bg: 'bg-[#0A66C2]/15 text-[#0A66C2] border-[#0A66C2]/25' };
      case 'instagram':
        return { label: 'IG', bg: 'bg-pink-500/15 text-pink-500 border-pink-500/25' };
      case 'facebook':
        return { label: 'FB', bg: 'bg-blue-600/15 text-blue-600 border-blue-600/25' };
      case 'twitter':
        return { label: 'X', bg: 'bg-slate-700/15 text-slate-800 border-slate-700/25' };
      case 'whatsapp':
        return { label: 'WA', bg: 'bg-emerald-600/15 text-emerald-600 border-emerald-600/25' };
      case 'telegram':
        return { label: 'TG', bg: 'bg-sky-500/15 text-sky-500 border-sky-500/25' };
      default:
        return { label: plat.substring(0, 2).toUpperCase(), bg: 'bg-slate-500/15 text-slate-700 border-slate-500/25' };
    }
  };

  return (
    <div id="social-media-grid-container" className="space-y-6 animate-fade-in font-sans">
      {/* Top Banner Ribbon */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--text)] font-mono">
              Omnichannel Grid Matrix
            </span>
          </div>
          <h2 className="text-xl font-black text-slate-900 tracking-tight flex items-center gap-2">
            <Globe className="h-5 w-5 text-emerald-600" />
            Social Media Calendar Grid
          </h2>
          <p className="text-xs text-slate-500 font-medium mt-0.5">
            Plan, orchestrate, and visually audit cross-platform publication schedules across all corporate brand channels.
          </p>
        </div>

        {/* Filter & Action Buttons */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Platform Filter Dropdown */}
          <div className="flex items-center gap-1.5 bg-slate-100/80 p-1 rounded-xl border border-slate-200 text-xs font-bold text-slate-600">
            <Filter className="h-3.5 w-3.5 ml-1.5 text-slate-400" />
            <select
              value={platformFilter}
              onChange={(e) => setPlatformFilter(e.target.value)}
              className="bg-transparent border-none text-xs font-bold text-slate-700 pr-3 py-1 outline-none cursor-pointer"
            >
              <option value="all">All Channels ({posts.length})</option>
              <option value="linkedin">LinkedIn</option>
              <option value="instagram">Instagram</option>
              <option value="facebook">Facebook</option>
              <option value="twitter">Twitter / X</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="telegram">Telegram</option>
            </select>
          </div>

          <button
            type="button"
            onClick={() => handleOpenSchedule('2026-06-16')}
            className="px-4 py-2.5 rounded-xl bg-[#063C2C] hover:bg-[#084D39] text-white text-xs font-bold transition-all shadow-sm hover:shadow flex items-center gap-2 cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            <span>Schedule Post</span>
          </button>
        </div>
      </div>

      {/* 7-DAY INTERACTIVE CALENDAR GRID */}
      <div className="grid grid-cols-1 md:grid-cols-7 gap-3.5 min-h-[460px]">
        {daysList.map((day) => {
          const dayPosts = filteredPosts.filter((p) => p.scheduledAt === day.key);
          const isToday = day.key === '2026-06-15';

          return (
            <div
              key={day.key}
              className={`rounded-2xl border flex flex-col transition-all duration-200 min-h-[380px] overflow-hidden ${
                isToday
                  ? 'bg-emerald-50/40 border-emerald-300 ring-2 ring-emerald-500/20 shadow-sm'
                  : 'bg-white border-slate-200/80 hover:border-slate-300 shadow-2xs'
              }`}
            >
              {/* Day Column Header */}
              <div className={`p-3.5 border-b flex items-center justify-between ${
                isToday ? 'bg-emerald-100/50 border-emerald-200' : 'bg-slate-50/70 border-slate-100'
              }`}>
                <div>
                  <span className={`text-[10px] font-extrabold uppercase tracking-wider block ${
                    isToday ? 'text-emerald-700' : 'text-slate-400'
                  }`}>
                    {day.label}
                  </span>
                  <span className={`text-sm font-black tracking-tight ${
                    isToday ? 'text-emerald-900' : 'text-slate-800'
                  }`}>
                    {day.month} {day.num}
                  </span>
                </div>

                <div className="flex items-center gap-1">
                  {dayPosts.length > 0 && (
                    <span className="text-[10px] font-mono font-bold bg-white text-slate-700 px-1.5 py-0.5 rounded-full border border-slate-200 shadow-3xs">
                      {dayPosts.length}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => handleOpenSchedule(day.key)}
                    className="h-6 w-6 rounded-lg bg-emerald-600/10 hover:bg-emerald-600 text-emerald-700 hover:text-white border border-emerald-600/20 flex items-center justify-center transition-all cursor-pointer"
                    title={`Add post for ${day.label} ${day.num}`}
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              {/* Day Posts List */}
              <div className="flex-1 p-2.5 space-y-2.5 overflow-y-auto max-h-[500px] scrollbar-thin scrollbar-thumb-slate-200">
                {dayPosts.length === 0 ? (
                  <div 
                    onClick={() => handleOpenSchedule(day.key)}
                    className="h-full flex flex-col items-center justify-center py-12 text-center rounded-xl border border-dashed border-slate-200 hover:border-emerald-300 hover:bg-emerald-50/20 transition-all cursor-pointer group"
                  >
                    <Plus className="h-5 w-5 text-slate-300 group-hover:text-emerald-500 transition-colors mb-1" />
                    <span className="text-[11px] font-bold text-slate-400 group-hover:text-emerald-700">Add Post</span>
                  </div>
                ) : (
                  dayPosts.map((post) => {
                    const isPublished = post.status === 'PUBLISHED';
                    return (
                      <motion.div
                        key={post.id}
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="group/card relative rounded-xl border border-slate-200 bg-white p-3 shadow-3xs hover:shadow-xs hover:border-emerald-300 transition-all text-left"
                      >
                        {/* Header: Platform Badges & Status */}
                        <div className="flex items-center justify-between gap-1 mb-2">
                          <div className="flex flex-wrap gap-1">
                            {post.platforms.map((plat) => {
                              const badge = getPlatformBadge(plat);
                              return (
                                <span
                                  key={plat}
                                  className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded border ${badge.bg}`}
                                >
                                  {badge.label}
                                </span>
                              );
                            })}
                          </div>

                          <div className="flex items-center gap-1">
                            {isPublished ? (
                              <span className="inline-flex items-center gap-1 text-[9px] font-extrabold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.2 rounded-full">
                                <CheckCircle2 className="h-2.5 w-2.5 text-emerald-600" />
                                Sent
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[9px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.2 rounded-full">
                                <Clock className="h-2.5 w-2.5 text-amber-600" />
                                {post.scheduledTime || 'Queue'}
                              </span>
                            )}

                            <button
                              type="button"
                              onClick={() => handleDelete(post.id)}
                              className="opacity-0 group-hover/card:opacity-100 p-1 text-slate-400 hover:text-red-500 rounded transition-all cursor-pointer"
                              title="Delete post"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                        </div>

                        {/* Caption Text */}
                        <p className="text-xs text-slate-700 font-medium leading-snug line-clamp-3 break-words">
                          {post.caption}
                        </p>

                        {/* Attached Image Thumbnail */}
                        {post.mediaUrl && (
                          <div className="mt-2 rounded-lg overflow-hidden border border-slate-100 bg-slate-50 relative aspect-video">
                            <img
                              src={post.mediaUrl}
                              alt="Media Attachment"
                              referrerPolicy="no-referrer"
                              className="w-full h-full object-cover"
                            />
                          </div>
                        )}

                        {/* Bottom Actions Card Bar */}
                        <div className="mt-2.5 pt-2 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-400 font-medium">
                          <span>{post.scheduledTime || 'Scheduled'}</span>
                          {!isPublished && (
                            <button
                              type="button"
                              onClick={() => handlePublishNow(post.id)}
                              className="text-[10px] font-bold text-emerald-700 hover:text-emerald-800 hover:underline flex items-center gap-1 cursor-pointer"
                            >
                              <Send className="h-2.5 w-2.5" />
                              Publish Now
                            </button>
                          )}
                        </div>
                      </motion.div>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* SCHEDULE POST MODAL */}
      <AnimatePresence>
        {showModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="bg-white rounded-2xl border border-slate-200 max-w-lg w-full shadow-2xl overflow-hidden"
            >
              {/* Modal Header */}
              <div className="p-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="h-8 w-8 rounded-xl bg-emerald-600/10 text-emerald-700 flex items-center justify-center font-bold">
                    <Calendar className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-black text-slate-900">Schedule Social Post</h3>
                    <p className="text-[11px] text-slate-500 font-medium">Target date: {formDate}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200 transition-colors cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Form Content */}
              <form onSubmit={handleCreatePost} className="p-5 space-y-4">
                {/* Platform Selector */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                    Target Channels
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {(['linkedin', 'instagram', 'facebook', 'twitter', 'whatsapp', 'telegram'] as const).map((plat) => {
                      const isSelected = formPlatforms.includes(plat);
                      return (
                        <button
                          key={plat}
                          type="button"
                          onClick={() => handleTogglePlatform(plat)}
                          className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer capitalize flex items-center gap-1.5 ${
                            isSelected
                              ? 'bg-[#063C2C] text-white border-[#063C2C] shadow-xs'
                              : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                          }`}
                        >
                          {plat}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Caption Textarea */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                    Post Caption & Copy
                  </label>
                  <textarea
                    rows={4}
                    value={formCaption}
                    onChange={(e) => setFormCaption(e.target.value)}
                    placeholder="Type publication content, tags #CRM #WebRTC, and call to action..."
                    className="w-full text-xs font-medium p-3 rounded-xl border border-slate-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/10 outline-none text-slate-800 resize-none"
                    required
                  />
                </div>

                {/* Date & Time Row */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                      Schedule Date
                    </label>
                    <input
                      type="date"
                      value={formDate}
                      onChange={(e) => setFormDate(e.target.value)}
                      className="w-full text-xs font-bold p-2.5 rounded-xl border border-slate-200 bg-slate-50 text-slate-800 outline-none cursor-pointer"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                      Schedule Time
                    </label>
                    <input
                      type="text"
                      value={formTime}
                      onChange={(e) => setFormTime(e.target.value)}
                      placeholder="10:00 AM"
                      className="w-full text-xs font-bold p-2.5 rounded-xl border border-slate-200 bg-slate-50 text-slate-800 outline-none"
                    />
                  </div>
                </div>

                {/* Media Image URL input */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                    Media Attachment URL (Optional)
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="url"
                      value={formMediaUrl}
                      onChange={(e) => setFormMediaUrl(e.target.value)}
                      placeholder="https://images.unsplash.com/..."
                      className="flex-1 text-xs p-2.5 rounded-xl border border-slate-200 bg-slate-50 text-slate-800 outline-none"
                    />
                  </div>
                </div>

                {/* Modal Footer Actions */}
                <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowModal(false)}
                    className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-5 py-2 text-xs font-bold text-white bg-[#063C2C] hover:bg-[#084D39] rounded-xl transition-all shadow-sm cursor-pointer flex items-center gap-1.5"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    <span>Save to Grid Queue</span>
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
