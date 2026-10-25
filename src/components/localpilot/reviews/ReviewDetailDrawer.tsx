import React, { useState } from 'react';
import { useOptionalLocalSeo } from '../live/localSeoClient';
import { 
  Star, Sparkles, RefreshCw, Edit3, Send, 
  CheckCircle2, ShieldCheck, AlertCircle, MessageSquare 
} from 'lucide-react';
import { Drawer } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { ReviewItem } from '../types';

export interface ReviewDetailDrawerProps {
  review: ReviewItem | null;
  isOpen: boolean;
  onClose: () => void;
  onApproveAndPublish: (reviewId: string, replyText: string) => void;
}

export const ReviewDetailDrawer: React.FC<ReviewDetailDrawerProps> = ({
  review,
  isOpen,
  onClose,
  onApproveAndPublish
}) => {
  const [replyText, setReplyText] = useState(review?.suggestedAiReply || '');
  const [draftNote, setDraftNote] = useState('');
  const seo = useOptionalLocalSeo();
  const [isEditing, setIsEditing] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);

  // Sync reply text when review changes
  React.useEffect(() => {
    if (review?.suggestedAiReply) {
      setReplyText(review.suggestedAiReply);
    } else if (review?.reply) {
      setReplyText(review.reply.text);
    }
  }, [review]);

  if (!review) return null;

  const handleRegenerate = async () => {
    // Real AI draft from the server (no canned text). Publishing still needs the user's approval.
    if (!seo) return;
    setIsRegenerating(true);
    setDraftNote('');
    try {
      const d = await seo.draftReply(review.id);
      setReplyText(d.text);
      setDraftNote(d.flags.length ? `Check before publishing: ${d.flags.join(' ')}` : 'AI draft. Review and edit before publishing.');
    } catch (e: any) {
      setDraftNote(e?.message || 'The draft couldn’t be generated. You can write the reply yourself.');
    } finally { setIsRegenerating(false); }
  };

  return (
    <Drawer
      isOpen={isOpen}
      onClose={onClose}
      title="Review Moderation & AI Reply"
      description={`Received ${review.date} at ${review.locationName}`}
      icon={<MessageSquare className="h-4 w-4" />}
      width="lg"
      footer={
        <div className="flex items-center justify-between gap-3 w-full">
          <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
            <span>Human-in-the-loop approval required</span>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                onApproveAndPublish(review.id, replyText);
                onClose();
              }}
              leftIcon={<Send className="h-3.5 w-3.5" />}
            >
              Approve & Publish
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-5 text-xs">
        
        {/* Customer Review Card */}
        <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <img
                src={review.authorAvatar}
                alt={review.authorName}
                className="h-9 w-9 rounded-full object-cover border border-slate-200"
              />
              <div>
                <div className="font-bold text-sm text-slate-900">
                  {review.authorName}
                </div>
                <div className="text-[11px] text-slate-500">
                  Verified Google Customer
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
              <span className="font-bold text-amber-900">{review.rating}.0</span>
              <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
            </div>
          </div>

          <p className="text-xs text-slate-900 leading-relaxed italic bg-white p-3 rounded-lg border border-slate-100">
            &quot;{review.content}&quot;
          </p>

          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] text-slate-500">Key Topics:</span>
            {review.topics.map((t) => (
              <span key={t} className="px-2 py-0.5 rounded bg-slate-200/80 text-slate-700 font-medium text-[11px]">
                {t}
              </span>
            ))}
          </div>
        </div>

        {/* AI Analysis Section */}
        <div className="p-4 rounded-xl border border-blue-100 bg-blue-50/40 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 font-bold text-blue-800">
              <Sparkles className="h-4 w-4 text-blue-600" />
              <span>AI Sentiment & Theme Breakdown</span>
            </div>
            <Badge
              variant={
                review.sentiment === 'Positive' ? 'success' :
                review.sentiment === 'Negative' ? 'danger' : 'neutral'
              }
              size="sm"
            >
              {review.sentiment} Sentiment
            </Badge>
          </div>

          <div>
            <div className="text-[11px] font-semibold text-slate-900 mb-1.5">
              Identified Key Themes:
            </div>
            <ul className="grid grid-cols-2 gap-1.5">
              {(review.aiThemes || ['Friendly staff', 'Excellent food', 'Fast service']).map((theme) => (
                <li key={theme} className="flex items-center gap-1.5 text-slate-700 bg-white/80 px-2.5 py-1 rounded border border-blue-100/60 font-medium text-[11px]">
                  <CheckCircle2 className="h-3 w-3 text-emerald-600 shrink-0" />
                  <span>{theme}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Suggested Response Composer */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="font-bold text-xs text-slate-900">
              Suggested Response
            </label>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleRegenerate}
                disabled={isRegenerating}
                className="text-xs font-semibold text-blue-600 hover:text-blue-700 flex items-center gap-1 cursor-pointer"
              >
                <RefreshCw className={`h-3 w-3 ${isRegenerating ? 'animate-spin' : ''}`} />
                <span>Regenerate</span>
              </button>
              <button
                type="button"
                onClick={() => setIsEditing(!isEditing)}
                className="text-xs font-semibold text-slate-600 hover:text-slate-900 flex items-center gap-1 cursor-pointer"
              >
                <Edit3 className="h-3 w-3" />
                <span>{isEditing ? 'Done editing' : 'Edit'}</span>
              </button>
            </div>
          </div>

          <textarea
            rows={4}
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            className="w-full p-3 text-xs bg-white border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 shadow-2xs leading-relaxed"
            placeholder="Type your response to the customer..."
          />
              {draftNote && <p className="text-xs text-[#B45309] mt-1" role="status">{draftNote}</p>}

          <p className="text-[11px] text-slate-500">
            Response will be published directly to Google Maps under business owner identity <strong>Alex Morgan</strong>.
          </p>
        </div>

      </div>
    </Drawer>
  );
};

export default ReviewDetailDrawer;
