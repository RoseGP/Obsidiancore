import React, { useState } from 'react';
import { 
  Calendar, Clock, Trash2, CheckCircle2, AlertCircle, RefreshCw, 
  Send, Edit2, Search, Layers, Globe, AlertTriangle, Loader2
} from 'lucide-react';
import { SocialPost, SocialPlatform, SocialDraft, PLATFORM_CONFIGS } from './SocialTypes';

interface SocialPostsQueueProps {
  posts: SocialPost[];
  drafts: SocialDraft[];
  onEditPost: (post: SocialPost) => void;
  onLoadDraft: (draft: SocialDraft) => void;
  onDeletePost: (postId: string) => Promise<void>;
  onDeleteDraft: (draftId: string) => Promise<void>;
  onPublishNow: (post: SocialPost) => Promise<void>;
  onRetryPost: (postId: string) => Promise<void>;
  onNewPost: () => void;
  className?: string;
}

export default function SocialPostsQueue({
  posts,
  drafts,
  onEditPost,
  onLoadDraft,
  onDeletePost,
  onDeleteDraft,
  onPublishNow,
  onRetryPost,
  onNewPost,
  className = ''
}: SocialPostsQueueProps) {
  const [activeFilterTab, setActiveFilterTab] = useState<'ALL' | 'SCHEDULED' | 'PUBLISHED' | 'DRAFTS' | 'FAILED'>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [platformFilter, setPlatformFilter] = useState<string>('ALL');
  const [inFlightAction, setInFlightAction] = useState<Record<string, string>>({});

  const formatScheduledTime = (dateString: string) => {
    try {
      const date = new Date(dateString);
      if (isNaN(date.getTime())) return dateString;
      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return dateString;
    }
  };

  const renderPlatformBadge = (platform: SocialPlatform) => {
    switch (platform) {
      case 'linkedin':
        return (
          <span key={platform} title="LinkedIn" className="h-5 w-5 rounded-full bg-[#0A66C2] flex items-center justify-center text-white text-[10px] font-bold shadow-2xs">
            in
          </span>
        );
      case 'twitter':
        return (
          <span key={platform} title="X (Twitter)" className="h-5 w-5 rounded-full bg-neutral-900 border border-neutral-700 flex items-center justify-center text-white text-[10px] font-mono font-bold shadow-2xs">
            𝕏
          </span>
        );
      case 'instagram':
        return (
          <span key={platform} title="Instagram" className="h-5 w-5 rounded-full bg-gradient-to-tr from-amber-500 via-rose-500 to-purple-600 flex items-center justify-center text-white text-[9px] font-bold shadow-2xs">
            ig
          </span>
        );
      case 'facebook':
        return (
          <span key={platform} title="Facebook" className="h-5 w-5 rounded-full bg-blue-600 flex items-center justify-center text-white text-[10px] font-bold shadow-2xs">
            f
          </span>
        );
      default:
        return (
          <span key={platform} title={platform} className="h-5 w-5 rounded-full bg-indigo-600 flex items-center justify-center text-white text-[9px] font-bold shadow-2xs">
            {platform.slice(0, 2).toUpperCase()}
          </span>
        );
    }
  };

  const handleTriggerPublish = async (post: SocialPost) => {
    setInFlightAction(prev => ({ ...prev, [post.id]: 'publishing' }));
    try {
      await onPublishNow(post);
    } finally {
      setInFlightAction(prev => {
        const next = { ...prev };
        delete next[post.id];
        return next;
      });
    }
  };

  const handleTriggerRetry = async (postId: string) => {
    setInFlightAction(prev => ({ ...prev, [postId]: 'retrying' }));
    try {
      await onRetryPost(postId);
    } finally {
      setInFlightAction(prev => {
        const next = { ...prev };
        delete next[postId];
        return next;
      });
    }
  };

  const handleTriggerDelete = async (postId: string) => {
    setInFlightAction(prev => ({ ...prev, [postId]: 'deleting' }));
    try {
      await onDeletePost(postId);
    } finally {
      setInFlightAction(prev => {
        const next = { ...prev };
        delete next[postId];
        return next;
      });
    }
  };

  const filteredPosts = posts.filter(post => {
    if (activeFilterTab === 'SCHEDULED' && post.status !== 'SCHEDULED') return false;
    if (activeFilterTab === 'PUBLISHED' && post.status !== 'PUBLISHED') return false;
    if (activeFilterTab === 'FAILED' && post.status !== 'FAILED') return false;
    if (activeFilterTab === 'DRAFTS') return false;

    if (platformFilter !== 'ALL' && !post.platforms.includes(platformFilter as SocialPlatform)) return false;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchCaption = post.caption.toLowerCase().includes(q);
      const matchPlatform = post.platforms.some(p => p.toLowerCase().includes(q));
      if (!matchCaption && !matchPlatform) return false;
    }

    return true;
  });

  const filteredDrafts = drafts.filter(draft => {
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return draft.caption.toLowerCase().includes(q);
    }
    return true;
  });

  const scheduledCount = posts.filter(p => p.status === 'SCHEDULED').length;
  const publishedCount = posts.filter(p => p.status === 'PUBLISHED').length;
  const failedCount = posts.filter(p => p.status === 'FAILED').length;
  const draftsCount = drafts.length;

  return (
    <div className={`bg-white border border-neutral-200/80 rounded-2xl p-5 space-y-5 shadow-xs ${className}`}>
      {/* TOP CONTROLS & FILTER BAR */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 pb-4 border-b border-neutral-200">
        {/* Status Tabs */}
        <div className="flex items-center gap-1 bg-neutral-100 p-1 rounded-xl border border-neutral-200 overflow-x-auto max-w-full">
          {[
            { id: 'ALL', label: 'All Posts', count: posts.length },
            { id: 'SCHEDULED', label: 'Scheduled', count: scheduledCount },
            { id: 'PUBLISHED', label: 'Published', count: publishedCount },
            { id: 'DRAFTS', label: 'Drafts', count: draftsCount },
            { id: 'FAILED', label: 'Failed', count: failedCount, isAlert: failedCount > 0 }
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveFilterTab(tab.id as any)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer whitespace-nowrap ${
                activeFilterTab === tab.id
                  ? 'bg-white text-neutral-900 shadow-2xs'
                  : 'text-neutral-600 hover:text-neutral-900 hover:bg-neutral-200/50'
              }`}
            >
              <span>{tab.label}</span>
              <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
                tab.isAlert
                  ? 'bg-rose-600 text-white font-bold animate-pulse'
                  : activeFilterTab === tab.id
                  ? 'bg-indigo-100 text-indigo-700'
                  : 'bg-neutral-200 text-neutral-600'
              }`}>
                {tab.count}
              </span>
            </button>
          ))}
        </div>

        {/* Search & Platform Filter & New Post CTA */}
        <div className="flex flex-wrap items-center gap-2.5 w-full md:w-auto">
          {/* Search Box */}
          <div className="relative flex-1 sm:w-56">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-neutral-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search posts..."
              className="w-full bg-white border border-neutral-300 rounded-xl pl-9 pr-3 py-1.5 text-xs text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          {/* Platform Filter Dropdown */}
          <select
            value={platformFilter}
            onChange={(e) => setPlatformFilter(e.target.value)}
            className="bg-white border border-neutral-300 rounded-xl px-3 py-1.5 text-xs text-neutral-700 focus:outline-none focus:border-indigo-500 cursor-pointer shadow-2xs"
          >
            <option value="ALL">All Platforms</option>
            {Object.keys(PLATFORM_CONFIGS).map(plat => (
              <option key={plat} value={plat}>
                {PLATFORM_CONFIGS[plat as SocialPlatform].name}
              </option>
            ))}
          </select>

          {/* + Create Post */}
          <button
            type="button"
            onClick={onNewPost}
            className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-xl flex items-center gap-1.5 transition-all cursor-pointer shadow-xs active:scale-98 shrink-0"
          >
            <span>+ Create Post</span>
          </button>
        </div>
      </div>

      {/* DRAFTS VIEW IF DRAFTS TAB ACTIVE */}
      {activeFilterTab === 'DRAFTS' ? (
        <div className="space-y-3">
          {filteredDrafts.length === 0 ? (
            <div className="text-center py-12 border border-dashed border-neutral-200 rounded-2xl p-6">
              <Layers className="h-8 w-8 text-neutral-400 mx-auto mb-2" />
              <p className="text-sm font-semibold text-neutral-800">No saved drafts found</p>
              <p className="text-xs text-neutral-500 mt-1">Draft your ideas in the composer and click "Save Draft" to keep them here.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {filteredDrafts.map((draft) => (
                <div
                  key={draft.id}
                  className="bg-neutral-50/70 border border-neutral-200/80 rounded-xl p-4 flex flex-col justify-between space-y-3 hover:border-indigo-300 transition-all shadow-2xs"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <span className="text-[10px] font-mono uppercase font-semibold text-neutral-600 bg-neutral-200/70 px-2 py-0.5 rounded-md">
                        Draft
                      </span>
                      <div className="flex items-center -space-x-1">
                        {draft.platforms.map(p => renderPlatformBadge(p))}
                      </div>
                    </div>
                    <p className="text-xs text-neutral-800 leading-relaxed line-clamp-3">
                      {draft.caption}
                    </p>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-neutral-200">
                    <button
                      onClick={() => onDeleteDraft(draft.id)}
                      className="p-1.5 rounded-lg text-neutral-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                      title="Delete Draft"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => onLoadDraft(draft)}
                      className="px-3 py-1 bg-indigo-50 hover:bg-indigo-600 border border-indigo-200 hover:border-indigo-600 text-indigo-700 hover:text-white rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 shadow-2xs"
                    >
                      <Edit2 className="h-3 w-3" />
                      <span>Open in Composer</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        /* MAIN POSTS LIST / TABLE VIEW */
        <div className="space-y-3">
          {filteredPosts.length === 0 ? (
            <div className="text-center py-12 border border-dashed border-neutral-200 rounded-2xl p-6">
              <Calendar className="h-8 w-8 text-neutral-400 mx-auto mb-2" />
              <p className="text-sm font-semibold text-neutral-800">No social posts match your filter</p>
              <p className="text-xs text-neutral-500 mt-1">Create a new post or adjust your status/platform filters.</p>
              <button
                onClick={onNewPost}
                className="mt-4 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-xl inline-flex items-center gap-2 cursor-pointer shadow-xs"
              >
                <span>+ Create Your First Post</span>
              </button>
            </div>
          ) : (
            <div className="space-y-2.5">
              {filteredPosts.map((post) => {
                const isPublished = post.status === 'PUBLISHED';
                const isFailed = post.status === 'FAILED';

                return (
                  <div
                    key={post.id}
                    className={`rounded-2xl border p-4 transition-all ${
                      isPublished
                        ? 'bg-emerald-50/30 border-emerald-200 hover:border-emerald-300'
                        : isFailed
                        ? 'bg-rose-50/30 border-rose-200 hover:border-rose-300'
                        : 'bg-white border-neutral-200 hover:border-indigo-300 shadow-2xs'
                    }`}
                  >
                    <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                      {/* Left: Media Thumbnail + Text Info */}
                      <div className="flex items-start gap-3.5 flex-1 min-w-0">
                        {/* Optional thumbnail */}
                        {post.mediaUrl ? (
                          <div className="h-14 w-14 rounded-xl overflow-hidden border border-neutral-200 shrink-0 bg-neutral-100">
                            <img
                              src={post.mediaUrl}
                              alt="Creative"
                              referrerPolicy="no-referrer"
                              className="h-full w-full object-cover"
                            />
                          </div>
                        ) : (
                          <div className="h-14 w-14 rounded-xl bg-neutral-100 border border-neutral-200 flex items-center justify-center text-neutral-400 shrink-0">
                            <Globe className="h-5 w-5" />
                          </div>
                        )}

                        {/* Caption & Metadata */}
                        <div className="space-y-1.5 flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            {/* Platform Badges */}
                            <div className="flex items-center -space-x-1">
                              {post.platforms.map(p => renderPlatformBadge(p))}
                            </div>

                            {/* Status Badge */}
                            {isPublished && (
                              <span className="px-2 py-0.5 rounded-md bg-emerald-100 border border-emerald-200 text-emerald-800 text-[10px] font-semibold flex items-center gap-1">
                                <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                                <span>Published</span>
                              </span>
                            )}
                            {isFailed && (
                              <span className="px-2 py-0.5 rounded-md bg-rose-100 border border-rose-200 text-rose-800 text-[10px] font-semibold flex items-center gap-1">
                                <AlertCircle className="h-3 w-3 text-rose-600" />
                                <span>Failed</span>
                              </span>
                            )}
                            {!isPublished && !isFailed && (
                              <span className="px-2 py-0.5 rounded-md bg-indigo-100 border border-indigo-200 text-indigo-800 text-[10px] font-semibold flex items-center gap-1">
                                <Clock className="h-3 w-3 text-indigo-600" />
                                <span>Scheduled</span>
                              </span>
                            )}

                            {/* Scheduled / Published Date */}
                            <span className="text-[11px] font-mono text-neutral-500">
                              {formatScheduledTime(post.scheduledAt)}
                            </span>
                          </div>

                          {/* Post Caption Snippet */}
                          <p className="text-xs text-neutral-800 leading-relaxed line-clamp-2">
                            {post.caption}
                          </p>

                          {/* Error diagnosis banner if failed */}
                          {isFailed && post.errorLog && (
                            <div className="mt-2 p-2 bg-rose-50 border border-rose-200 rounded-lg text-[11px] text-rose-700 flex items-start gap-1.5">
                              <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-rose-600 mt-0.5" />
                              <span className="leading-snug">{post.errorLog}</span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Right: Actions Controls */}
                      <div className="flex items-center gap-2 shrink-0 self-end md:self-center">
                        {/* Retry button for failed */}
                        {isFailed && (
                          <button
                            onClick={() => handleTriggerRetry(post.id)}
                            disabled={!!inFlightAction[post.id]}
                            className="px-3 py-1.5 bg-rose-50 hover:bg-rose-600 border border-rose-200 hover:border-rose-600 text-rose-700 hover:text-white rounded-xl text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 shadow-2xs"
                          >
                            {inFlightAction[post.id] === 'retrying' ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <RefreshCw className="h-3.5 w-3.5" />
                            )}
                            <span>Retry</span>
                          </button>
                        )}

                        {/* Publish Now button for scheduled */}
                        {!isPublished && !isFailed && (
                          <button
                            onClick={() => handleTriggerPublish(post)}
                            disabled={!!inFlightAction[post.id]}
                            className="px-3 py-1.5 bg-emerald-50 hover:bg-emerald-600 border border-emerald-200 hover:border-emerald-600 text-emerald-700 hover:text-white rounded-xl text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 shadow-2xs"
                          >
                            {inFlightAction[post.id] === 'publishing' ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Send className="h-3.5 w-3.5" />
                            )}
                            <span>Publish Now</span>
                          </button>
                        )}

                        {/* Edit in Composer */}
                        <button
                          onClick={() => onEditPost(post)}
                          className="p-2 rounded-xl bg-neutral-100 hover:bg-neutral-200 border border-neutral-200 text-neutral-600 hover:text-neutral-900 transition-colors cursor-pointer"
                          title="Edit Post"
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                        </button>

                        {/* Delete Post */}
                        <button
                          onClick={() => handleTriggerDelete(post.id)}
                          disabled={!!inFlightAction[post.id]}
                          className="p-2 rounded-xl bg-neutral-100 hover:bg-rose-50 border border-neutral-200 hover:border-rose-200 text-neutral-500 hover:text-rose-600 transition-colors cursor-pointer"
                          title="Delete Post"
                        >
                          {inFlightAction[post.id] === 'deleting' ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin text-rose-600" />
                          ) : (
                            <Trash2 className="h-3.5 w-3.5" />
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
