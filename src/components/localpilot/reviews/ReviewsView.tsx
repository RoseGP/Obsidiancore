import React, { useState } from 'react';
import { 
  Star, Search, Filter, MessageSquare, 
  Sparkles, CheckCircle2, AlertCircle, Clock,
  ArrowUpDown, Check, RefreshCw
} from 'lucide-react';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { ReviewCard } from './ReviewCard';
import { ReviewDetailDrawer } from './ReviewDetailDrawer';
import { EmptyState } from '../ui/EmptyState';
import { ReviewItem } from '../types';

export interface ReviewsViewProps {
  reviews: ReviewItem[];
  onApproveAndPublish: (reviewId: string, replyText: string) => void;
}

export const ReviewsView: React.FC<ReviewsViewProps> = ({
  reviews,
  onApproveAndPublish
}) => {
  const [activeFilter, setActiveFilter] = useState<
    'All' | 'Unanswered' | '5 Stars' | '4 Stars' | '3 Stars' | '2 Stars' | '1 Star' | 'Needs attention'
  >('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedReview, setSelectedReview] = useState<ReviewItem | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  // Filter reviews
  const filtered = reviews.filter((r) => {
    const matchesSearch = 
      r.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.authorName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.locationName.toLowerCase().includes(searchQuery.toLowerCase());

    if (!matchesSearch) return false;

    if (activeFilter === 'Unanswered') return r.status === 'unanswered';
    if (activeFilter === '5 Stars') return r.rating === 5;
    if (activeFilter === '4 Stars') return r.rating === 4;
    if (activeFilter === '3 Stars') return r.rating === 3;
    if (activeFilter === '2 Stars') return r.rating === 2;
    if (activeFilter === '1 Star') return r.rating === 1;
    if (activeFilter === 'Needs attention') return r.rating <= 3 || r.sentiment === 'Negative';

    return true;
  });

  const unansweredCount = reviews.filter((r) => r.status === 'unanswered').length;

  const handleOpenDrawer = (review: ReviewItem) => {
    setSelectedReview(review);
    setIsDrawerOpen(true);
  };

  const handleQuickGenerate = (review: ReviewItem, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedReview(review);
    setIsDrawerOpen(true);
  };

  return (
    <div className="space-y-5 animate-in fade-in duration-200" id="localpilot-reviews-view">
      
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-1">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">
            Reviews & Customer Feedback
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Monitor, analyze with AI, and publish approved responses to Google customer reviews.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            leftIcon={<RefreshCw className="h-3.5 w-3.5 text-slate-500" />}
          >
            Sync Google Reviews
          </Button>
        </div>
      </div>

      {/* Top 4 Stats Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
        <div className="p-3.5 rounded-xl border border-slate-200 bg-white">
          <span className="text-[11px] font-medium text-slate-500 block">Average Rating</span>
          <div className="text-xl font-bold text-slate-900 mt-0.5 flex items-center gap-1.5">
            <span>4.8</span>
            <div className="flex">
              {Array.from({ length: 5 }).map((_, i) => (
                <Star key={i} className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
              ))}
            </div>
          </div>
        </div>

        <div className="p-3.5 rounded-xl border border-slate-200 bg-white">
          <span className="text-[11px] font-medium text-slate-500 block">Total Reviews</span>
          <div className="text-xl font-bold text-slate-900 mt-0.5">
            1,284
          </div>
        </div>

        <div className="p-3.5 rounded-xl border border-amber-200 bg-amber-50/40">
          <span className="text-[11px] font-medium text-amber-800 block">Unanswered Reviews</span>
          <div className="text-xl font-bold text-amber-900 mt-0.5">
            {unansweredCount}
          </div>
        </div>

        <div className="p-3.5 rounded-xl border border-emerald-200 bg-emerald-50/40">
          <span className="text-[11px] font-medium text-emerald-800 block">Response Rate</span>
          <div className="text-xl font-bold text-emerald-900 mt-0.5">
            91.4%
          </div>
        </div>
      </div>

      {/* Main Layout: Left Filter Sidebar + Center Review Feed */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-5">
        
        {/* Left Filter Sidebar */}
        <div className="lg:col-span-1 space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-2xs space-y-3">
            <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
              Filter by Status
            </h3>

            <div className="space-y-1 text-xs font-medium">
              {[
                { id: 'All', label: 'All Reviews', count: reviews.length },
                { id: 'Unanswered', label: 'Unanswered', count: unansweredCount, badgeVariant: 'warning' },
                { id: 'Needs attention', label: 'Needs Attention (≤3★)', count: 2, badgeVariant: 'danger' },
                { id: '5 Stars', label: '5 Stars ★★★★★', count: 1102 },
                { id: '4 Stars', label: '4 Stars ★★★★', count: 120 },
                { id: '3 Stars', label: '3 Stars ★★★', count: 32 },
                { id: '2 Stars', label: '2 Stars ★★', count: 18 },
                { id: '1 Star', label: '1 Star ★', count: 12 },
              ].map((f) => {
                const isSelected = activeFilter === f.id;
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setActiveFilter(f.id as any)}
                    className={`w-full px-3 py-2 rounded-lg flex items-center justify-between transition cursor-pointer ${
                      isSelected
                        ? 'bg-blue-50 text-blue-800 font-bold'
                        : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
                    }`}
                  >
                    <span>{f.label}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                      isSelected ? 'bg-blue-200/60 text-blue-800' : 'bg-slate-100 text-slate-600'
                    }`}>
                      {f.count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* AI Moderation Policy Banner */}
          <div className="bg-slate-50 rounded-xl border border-slate-200 p-4 text-xs space-y-2">
            <div className="flex items-center gap-1.5 font-bold text-slate-900">
              <Sparkles className="h-3.5 w-3.5 text-blue-600" />
              <span>Smart Moderation</span>
            </div>
            <p className="text-[11px] text-slate-500 leading-relaxed">
              AI drafts responses tailored to specific menu items, staff mentions, and sentiment. All replies require manager approval before posting.
            </p>
          </div>
        </div>

        {/* Center: Search & Review Feed */}
        <div className="lg:col-span-3 space-y-3.5">
          {/* Search bar */}
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
            <input
              type="text"
              placeholder="Search reviews by customer name, keywords, or location..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:border-blue-500 shadow-2xs"
            />
          </div>

          {/* Review List */}
          {filtered.length === 0 ? (
            <EmptyState
              icon={<MessageSquare className="h-6 w-6 text-slate-400" />}
              title="No reviews found"
              description="There aren't any customer reviews matching your active filter criteria."
              actionLabel="Clear filters"
              onAction={() => {
                setActiveFilter('All');
                setSearchQuery('');
              }}
            />
          ) : (
            <div className="space-y-3">
              {filtered.map((rev) => (
                <ReviewCard
                  key={rev.id}
                  review={rev}
                  isSelected={selectedReview?.id === rev.id && isDrawerOpen}
                  onSelect={handleOpenDrawer}
                  onQuickGenerateReply={handleQuickGenerate}
                />
              ))}
            </div>
          )}
        </div>

      </div>

      {/* Review Detail Drawer */}
      <ReviewDetailDrawer
        review={selectedReview}
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        onApproveAndPublish={onApproveAndPublish}
      />

    </div>
  );
};

export default ReviewsView;
