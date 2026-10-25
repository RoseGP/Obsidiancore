import React from 'react';
import { Star, MessageSquare, Sparkles, CheckCircle2, Clock, ThumbsUp, AlertCircle } from 'lucide-react';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { ReviewItem } from '../types';

export interface ReviewCardProps {
  review: ReviewItem;
  isSelected?: boolean;
  onSelect: (review: ReviewItem) => void;
  onQuickGenerateReply: (review: ReviewItem, e: React.MouseEvent) => void;
}

export const ReviewCard: React.FC<ReviewCardProps> = ({
  review,
  isSelected = false,
  onSelect,
  onQuickGenerateReply
}) => {
  return (
    <div
      onClick={() => onSelect(review)}
      className={`p-4 rounded-xl border bg-white transition-all cursor-pointer shadow-2xs space-y-3 ${
        isSelected
          ? 'border-blue-600 ring-1 ring-blue-600/40 bg-blue-50/10'
          : 'border-slate-200 hover:border-slate-300'
      }`}
    >
      {/* Header: Author & Rating */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <img
            src={review.authorAvatar}
            alt={review.authorName}
            className="h-8 w-8 rounded-full object-cover border border-slate-200"
          />
          <div>
            <div className="text-xs font-bold text-slate-900">
              {review.authorName}
            </div>
            <div className="text-[11px] text-slate-500">
              {review.locationName} • {review.date}
            </div>
          </div>
        </div>

        {/* Stars */}
        <div className="flex items-center gap-1 bg-amber-50/80 px-2 py-0.5 rounded-md border border-amber-200/60">
          <span className="text-xs font-bold text-amber-900">{review.rating}.0</span>
          <div className="flex items-center">
            {Array.from({ length: 5 }).map((_, i) => (
              <Star
                key={i}
                className={`h-3 w-3 ${
                  i < review.rating ? 'fill-amber-400 text-amber-400' : 'text-slate-200'
                }`}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Review Text */}
      <p className="text-xs text-slate-900 leading-relaxed line-clamp-3">
        &quot;{review.content}&quot;
      </p>

      {/* Sentiment & Topics */}
      <div className="flex items-center justify-between flex-wrap gap-2 pt-2 border-t border-slate-100 text-[11px]">
        <div className="flex items-center gap-1.5 flex-wrap">
          <Badge
            variant={
              review.sentiment === 'Positive' ? 'success' :
              review.sentiment === 'Negative' ? 'danger' : 'neutral'
            }
            size="sm"
          >
            {review.sentiment}
          </Badge>

          {review.topics.map((t) => (
            <span
              key={t}
              className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-[10px] font-medium"
            >
              #{t}
            </span>
          ))}
        </div>

        {/* Response Status */}
        <div className="flex items-center gap-2">
          {review.status === 'answered' ? (
            <span className="text-emerald-700 font-semibold flex items-center gap-1 text-[11px]">
              <CheckCircle2 className="h-3.5 w-3.5" /> Replied
            </span>
          ) : (
            <Button
              variant="subtle"
              size="xs"
              onClick={(e) => onQuickGenerateReply(review, e)}
              leftIcon={<Sparkles className="h-3 w-3 text-blue-600" />}
            >
              Generate Response
            </Button>
          )}
        </div>
      </div>

    </div>
  );
};

export default ReviewCard;
