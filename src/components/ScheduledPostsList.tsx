import React, { useState } from 'react';
import axios from 'axios';
import { 
  Calendar, 
  Trash2, 
  CheckCircle2, 
  XCircle, 
  Clock, 
  AlertCircle,
  Loader2,
  Share2,
  Linkedin,
  Instagram,
  Facebook,
  Twitter,
  Flame
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export interface ScheduledPost {
  id: string;
  caption: string;
  mediaUrls?: string[];
  platforms: string[];
  scheduledAt: string;
  publishedAt?: string;
  status: 'SCHEDULED' | 'PUBLISHED' | 'FAILED' | 'PROCESSING' | string;
  errorLog?: string;
  createdAt?: string;
  retryCount?: number;
}

interface ScheduledPostsListProps {
  /**
   * List of scheduled/published/failed social posts to display
   */
  posts: ScheduledPost[];

  /**
   * Callback to refresh or update state when a post is successfully deleted or cancelled.
   */
  onPostDeleted: (postId: string) => void;

  /**
   * Callback when a post retry is successfully triggered
   */
  onPostRetried?: (postId: string) => void;

  /**
   * Optional custom classes for styling
   */
  className?: string;

  /**
   * Whether to display in a Grid layout instead of a List layout by default
   */
  viewMode?: 'grid' | 'list';
}

/**
 * ScheduledPostsList Component
 * 
 * Renders scheduled social planner posts in a highly-polished list or grid,
 * featuring interactive status badges, platform tags, expandable error logs,
 * and a smooth deletion mechanism with in-flight loading indicators.
 */
export default function ScheduledPostsList({
  posts,
  onPostDeleted,
  onPostRetried,
  className = '',
  viewMode = 'list'
}: ScheduledPostsListProps) {
  // Tracking which posts are currently in the process of being deleted (API request in flight)
  const [deletingIds, setDeletingIds] = useState<Record<string, boolean>>({});
  // Tracking which posts are currently retrying (API request in flight)
  const [retryingIds, setRetryingIds] = useState<Record<string, boolean>>({});
  // Local error state for diagnostics
  const [actionError, setActionError] = useState<string | null>(null);

  // Helper to format date strings gracefully
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

  // Triggers API delete call to remove the scheduled post
  const handleCancelPost = async (postId: string) => {
    if (deletingIds[postId]) return; // Avoid duplicate triggers

    // Set deleting state
    setDeletingIds(prev => ({ ...prev, [postId]: true }));
    setActionError(null);

    try {
      // Execute the DELETE API request
      const response = await axios.delete(`/api/social-posts/${postId}`);
      
      if (response.data && response.data.success) {
        // Trigger parent state update callback
        onPostDeleted(postId);
      } else {
        throw new Error(response.data?.error || 'Failed to remove post from schedule.');
      }
    } catch (err: any) {
      console.error('Error removing scheduled post:', err);
      setActionError(err.response?.data?.error || err.message || 'Server connection error.');
    } finally {
      setDeletingIds(prev => ({ ...prev, [postId]: false }));
    }
  };

  // Triggers API retry call for failed post
  const handleRetryPost = async (postId: string) => {
    if (retryingIds[postId]) return; // Avoid duplicate triggers

    setRetryingIds(prev => ({ ...prev, [postId]: true }));
    setActionError(null);

    try {
      const response = await axios.post(`/api/social-posts/retry/${postId}`);
      if (response.data && response.data.success) {
        if (onPostRetried) {
          onPostRetried(postId);
        }
      } else {
        throw new Error(response.data?.error || 'Failed to trigger retry for failed post.');
      }
    } catch (err: any) {
      console.error('Error retrying scheduled post:', err);
      setActionError(err.response?.data?.error || err.message || 'Server connection error during retry.');
    } finally {
      setRetryingIds(prev => ({ ...prev, [postId]: false }));
    }
  };

  // Render social platform helper icons/tags
  const renderPlatformTags = (platforms: string[]) => {
    return (
      <div className="flex flex-wrap gap-1.5 mt-2">
        {platforms.map(platform => {
          const lower = platform.toLowerCase();
          let icon = <Share2 className="h-3 w-3" />;
          let colorClass = 'bg-slate-100 text-slate-700 border-slate-200';

          if (lower.includes('linkedin')) {
            icon = <Linkedin className="h-3 w-3 fill-current" />;
            colorClass = 'bg-blue-50 text-blue-700 border-blue-100';
          } else if (lower.includes('instagram')) {
            icon = <Instagram className="h-3 w-3" />;
            colorClass = 'bg-pink-50 text-pink-700 border-pink-100';
          } else if (lower.includes('facebook')) {
            icon = <Facebook className="h-3 w-3" />;
            colorClass = 'bg-indigo-50 text-indigo-700 border-indigo-100';
          } else if (lower.includes('twitter') || lower.includes('x')) {
            icon = <Twitter className="h-3 w-3" />;
            colorClass = 'bg-slate-900 text-white border-slate-800';
          }

          return (
            <span 
              key={platform} 
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider border ${colorClass}`}
            >
              {icon}
              <span>{platform}</span>
            </span>
          );
        })}
      </div>
    );
  };

  // Render responsive status badges
  const renderStatusBadge = (status: string) => {
    const s = status.toUpperCase();
    if (s === 'SCHEDULED' || s === 'PENDING') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-black bg-amber-50 text-amber-700 border border-amber-200/60 shadow-inner">
          <Clock className="h-3.5 w-3.5 animate-pulse" />
          <span>Pending</span>
        </span>
      );
    } else if (s === 'PROCESSING') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-black bg-blue-50 text-blue-700 border border-blue-200/60">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />
          <span>Processing</span>
        </span>
      );
    } else if (s === 'PUBLISHED') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-black bg-emerald-50 text-emerald-700 border border-emerald-200/60">
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
          <span>Published</span>
        </span>
      );
    } else {
      // FAILED
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-black bg-rose-50 text-rose-700 border border-rose-200/60">
          <XCircle className="h-3.5 w-3.5 text-rose-500" />
          <span>Failed</span>
        </span>
      );
    }
  };

  if (!posts || posts.length === 0) {
    return (
      <div className="text-center py-12 px-4 border border-dashed border-slate-200 rounded-3xl bg-slate-50/50">
        <Calendar className="h-10 w-10 text-slate-350 mx-auto mb-3" />
        <p className="text-sm text-slate-500 font-extrabold">No active scheduled posts found.</p>
        <p className="text-xs text-slate-400 mt-1 max-w-xs mx-auto">
          Create, schedule, and stage content inside the Social Planner to queue automatic postings.
        </p>
      </div>
    );
  }

  return (
    <div className={`space-y-4 ${className}`} id="scheduled-posts-list-root">
      {actionError && (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 px-4 py-3 rounded-2xl flex items-start gap-3 text-xs animate-fade-in">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <div>
            <span className="font-extrabold">Failed to update schedule: </span>
            {actionError}
          </div>
        </div>
      )}

      <AnimatePresence mode="popLayout">
        <div className={viewMode === 'grid' ? "grid grid-cols-1 md:grid-cols-2 gap-4" : "space-y-3.5"}>
          {posts.map(post => {
            const s = post.status.toUpperCase();
            const isDeleting = deletingIds[post.id] || false;
            const isRetrying = retryingIds[post.id] || false;
            const isPending = s === 'SCHEDULED' || s === 'PENDING';
            const isProcessing = s === 'PROCESSING';
            const isFailed = s === 'FAILED';
            const isLinkedIn = post.platforms.map(p => p.toLowerCase()).includes('linkedin');

            return (
              <motion.div
                key={post.id}
                id={`scheduled-post-card-${post.id}`}
                layout
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ type: 'spring', stiffness: 350, damping: 25 }}
                className={`bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs relative overflow-hidden flex flex-col justify-between transition-all duration-300 hover:shadow-md ${
                  isDeleting || isRetrying ? 'opacity-65 pointer-events-none' : ''
                }`}
              >
                {/* Accent top boundary line depending on status */}
                <div className={`absolute top-0 left-0 right-0 h-1.5 ${
                  isPending ? 'bg-amber-400' : isProcessing ? 'bg-blue-400' : s === 'PUBLISHED' ? 'bg-emerald-500' : 'bg-rose-500'
                }`} />

                <div className="space-y-3">
                  {/* Status, Date/Time Header */}
                  <div className="flex items-center justify-between gap-4">
                    {renderStatusBadge(post.status)}
                    
                    <div className="flex items-center gap-1.5 text-xs text-slate-500 font-extrabold font-mono">
                      <Calendar className="h-3.5 w-3.5 text-slate-400" />
                      <span>{formatScheduledTime(post.scheduledAt)}</span>
                    </div>
                  </div>

                  {/* Caption post text */}
                  <div className="text-xs text-slate-700 leading-relaxed font-semibold whitespace-pre-wrap break-words border-l-2 border-slate-100 pl-3">
                    {post.caption}
                  </div>

                  {/* Platforms */}
                  {post.platforms && post.platforms.length > 0 && renderPlatformTags(post.platforms)}

                  {/* Media attachments previews if any exist */}
                  {post.mediaUrls && post.mediaUrls.length > 0 && (
                    <div className="grid grid-cols-3 gap-2 mt-2">
                      {post.mediaUrls.map((url, i) => (
                        <div key={i} className="relative rounded-lg overflow-hidden border border-slate-100 aspect-video group">
                          <img 
                            src={url} 
                            alt={`Attachment ${i + 1}`} 
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover transition-all duration-300 group-hover:scale-105"
                          />
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Failed status diagnostic error log */}
                  {isFailed && post.errorLog && (
                    <div className="bg-rose-50/50 border border-rose-100 rounded-xl p-3 text-[10px] text-rose-650 font-mono mt-2 break-all leading-relaxed">
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="font-extrabold uppercase text-[9px] text-rose-500 block">Failure Details:</span>
                        {post.retryCount !== undefined && post.retryCount > 0 && (
                          <span className="text-[9px] text-indigo-600 font-extrabold uppercase bg-indigo-50 px-1.5 py-0.5 rounded-sm">
                            Retries: {post.retryCount}
                          </span>
                        )}
                      </div>
                      {post.errorLog}
                    </div>
                  )}
                </div>

                {/* Card Action footer - Only render delete/cancel buttons for scheduled/failed/pending items */}
                {(isPending || isFailed || isProcessing) && (
                  <div className="mt-4 pt-3.5 border-t border-slate-100 flex items-center justify-end gap-2">
                    {/* Cancel/Delete Post button */}
                    {(isPending || isFailed) && (
                      <button
                        id={`btn-cancel-post-${post.id}`}
                        type="button"
                        disabled={isDeleting || isRetrying}
                        onClick={() => handleCancelPost(post.id)}
                        className="px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-red-600 hover:text-white bg-red-50 hover:bg-red-500 rounded-lg transition-all cursor-pointer flex items-center gap-1.5 shadow-xs hover:shadow-xs active:scale-95 disabled:opacity-50"
                      >
                        {isDeleting ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                        <span>{isDeleting ? 'Cancelling...' : 'Cancel Post'}</span>
                      </button>
                    )}

                    {/* Retry Now button (Only for failed LinkedIn posts) */}
                    {isFailed && isLinkedIn && (
                      <button
                        id={`btn-retry-post-${post.id}`}
                        type="button"
                        disabled={isDeleting || isRetrying}
                        onClick={() => handleRetryPost(post.id)}
                        className="px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-blue-600 hover:text-white bg-blue-50 hover:bg-blue-600 rounded-lg transition-all cursor-pointer flex items-center gap-1.5 shadow-xs hover:shadow-xs active:scale-95 disabled:opacity-50"
                      >
                        {isRetrying ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Flame className="h-3.5 w-3.5" />
                        )}
                        <span>{isRetrying ? 'Retrying...' : 'Retry Now'}</span>
                      </button>
                    )}
                  </div>
                )}
              </motion.div>
            );
          })}
        </div>
      </AnimatePresence>
    </div>
  );
}
