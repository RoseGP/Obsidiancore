import React, { useState } from 'react';
import { 
  Sparkles, Image as ImageIcon, Calendar, 
  Send, Clock, Check, X, Tag, AlertCircle 
} from 'lucide-react';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { PostItem, PostType, LocationItem } from '../types';

export interface PostEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSavePost: (post: Partial<PostItem>) => void;
  locations: LocationItem[];
  initialPost?: Partial<PostItem> | null;
}

export const PostEditorModal: React.FC<PostEditorModalProps> = ({
  isOpen,
  onClose,
  onSavePost,
  locations,
  initialPost
}) => {
  const [postType, setPostType] = useState<PostType>(initialPost?.type || 'Update');
  const [title, setTitle] = useState(initialPost?.title || '');
  const [content, setContent] = useState(initialPost?.content || '');
  const [ctaType, setCtaType] = useState(initialPost?.ctaType || 'LEARN_MORE');
  const [ctaUrl, setCtaUrl] = useState(initialPost?.ctaUrl || 'https://localpilot-sample.com');
  const [locationId, setLocationId] = useState(initialPost?.locationId || locations[0]?.id || 'loc-downtown-miami');
  const [scheduledDate, setScheduledDate] = useState(initialPost?.scheduledDate || '2026-09-04');
  const [imageUrl, setImageUrl] = useState(
    initialPost?.imageUrl || 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=800&auto=format&fit=crop&q=80'
  );
  const [isAiDraft, setIsAiDraft] = useState(initialPost?.isAiGenerated || false);

  const selectedLoc = locations.find((l) => l.id === locationId);

  const handleGenerateAi = () => {
    setIsAiDraft(true);
    if (postType === 'Offer') {
      setTitle('Mid-Week Chef Tasting Experience');
      setContent('Enjoy 20% off all chef tasting menus every Tuesday and Wednesday throughout September. Handcrafted pairings included.');
      setCtaType('BOOK');
      setCtaUrl('https://localpilot-sample.com/reservations');
    } else {
      setTitle('Fresh Seasonal Menu Updates');
      setContent('We just unveiled our autumn cocktail & dining additions! Featuring locally sourced organic produce and wood-fired artisan specials.');
      setCtaType('LEARN_MORE');
      setCtaUrl('https://localpilot-sample.com/menu');
    }
  };

  const handlePublish = (status: 'Published' | 'Scheduled' | 'Draft') => {
    onSavePost({
      id: initialPost?.id || `post-${Date.now()}`,
      locationId,
      locationName: selectedLoc?.name || 'Downtown Miami Flagship',
      type: postType,
      title: title || undefined,
      content,
      ctaType,
      ctaUrl,
      imageUrl,
      status,
      isAiGenerated: isAiDraft,
      scheduledDate: status === 'Scheduled' ? scheduledDate : undefined,
      publishedAt: status === 'Published' ? 'Just now' : undefined
    });
    onClose();
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Create Google Business Profile Post"
      description="Publish announcements, seasonal offers, and events directly to Google Maps and Search."
      size="xl"
      footer={
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleGenerateAi}
              leftIcon={<Sparkles className="h-3.5 w-3.5 text-blue-600" />}
            >
              Generate with AI
            </Button>
            <Button variant="ghost" size="sm" onClick={() => handlePublish('Draft')}>
              Save Draft
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handlePublish('Scheduled')}
              leftIcon={<Clock className="h-3.5 w-3.5" />}
            >
              Schedule
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => handlePublish('Published')}
              leftIcon={<Send className="h-3.5 w-3.5" />}
            >
              Publish to Google
            </Button>
          </div>
        </div>
      }
    >
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 text-xs">
        
        {/* Left Form */}
        <div className="space-y-4">
          
          {/* AI Banner if active */}
          {isAiDraft && (
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl flex items-center justify-between">
              <div className="flex items-center gap-2 text-blue-800">
                <Sparkles className="h-4 w-4 text-blue-600 shrink-0" />
                <span className="font-semibold text-xs">✨ AI-generated draft</span>
              </div>
              <span className="text-[10px] text-blue-700 bg-blue-100 px-2 py-0.5 rounded font-medium">
                Optimized for local discovery
              </span>
            </div>
          )}

          {/* Post Type Selector */}
          <div>
            <label className="font-bold text-slate-900 block mb-1.5">Post Type</label>
            <div className="grid grid-cols-4 gap-2">
              {(['Update', 'Offer', 'Event', 'Announcement'] as PostType[]).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setPostType(type)}
                  className={`py-2 px-2 text-center rounded-lg border font-semibold transition cursor-pointer ${
                    postType === type
                      ? 'bg-blue-50 border-blue-600 text-blue-600'
                      : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'
                  }`}
                >
                  {type}
                </button>
              ))}
            </div>
          </div>

          {/* Location Selector */}
          <div>
            <label className="font-bold text-slate-900 block mb-1">Target Location</label>
            <select
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
              className="w-full p-2 bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-blue-500"
            >
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name} ({l.city}, {l.state})
                </option>
              ))}
            </select>
          </div>

          {/* Title (for Offers & Events) */}
          {(postType === 'Offer' || postType === 'Event' || postType === 'Announcement') && (
            <div>
              <label className="font-bold text-slate-900 block mb-1">Headline / Title</label>
              <input
                type="text"
                placeholder="e.g. Labor Day Extended Brunch & Live Jazz"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full p-2 bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-blue-500"
              />
            </div>
          )}

          {/* Content Editor */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="font-bold text-slate-900">Post Description</label>
              <span className={`text-[11px] ${content.length > 1400 ? 'text-rose-600 font-bold' : 'text-slate-400'}`}>
                {content.length} / 1,500 chars
              </span>
            </div>
            <textarea
              rows={4}
              placeholder="What's new with your business? Share an update, special promotion, or seasonal announcement..."
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="w-full p-2.5 bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-blue-500"
            />
          </div>

          {/* CTA Selector */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="font-bold text-slate-900 block mb-1">Call-to-Action</label>
              <select
                value={ctaType}
                onChange={(e) => setCtaType(e.target.value as any)}
                className="w-full p-2 bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-blue-500"
              >
                <option value="LEARN_MORE">Learn more</option>
                <option value="BOOK">Book / Reserve</option>
                <option value="ORDER">Order online</option>
                <option value="CALL">Call now</option>
                <option value="SIGN_UP">Sign up</option>
                <option value="NONE">No button</option>
              </select>
            </div>

            <div>
              <label className="font-bold text-slate-900 block mb-1">Action URL</label>
              <input
                type="text"
                value={ctaUrl}
                onChange={(e) => setCtaUrl(e.target.value)}
                placeholder="https://..."
                className="w-full p-2 bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

        </div>

        {/* Right: Live Google Search & Maps Preview Card */}
        <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-2 mb-3 border-b border-slate-200 text-xs">
              <span className="font-bold text-slate-500 uppercase tracking-wider text-[10px]">
                Google Maps & Search Live Preview
              </span>
              <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-semibold">
                Google Verified
              </span>
            </div>

            {/* Mock Google Post Card */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden space-y-3 p-3.5">
              {/* Media image */}
              {imageUrl && (
                <div className="relative h-44 w-full rounded-lg overflow-hidden bg-slate-100">
                  <img
                    src={imageUrl}
                    alt="Post media preview"
                    className="h-full w-full object-cover"
                  />
                  <div className="absolute top-2 left-2 px-2 py-0.5 rounded-md bg-black/60 text-white text-[10px] font-bold backdrop-blur-xs">
                    {postType}
                  </div>
                </div>
              )}

              {/* Title & Body */}
              <div>
                {title && (
                  <h4 className="font-bold text-sm text-slate-900 mb-1">
                    {title}
                  </h4>
                )}
                <p className="text-xs text-slate-900 leading-relaxed line-clamp-4">
                  {content || 'Enter post description on the left to see live mockup preview here.'}
                </p>
              </div>

              {/* Action Button Preview */}
              {ctaType !== 'NONE' && (
                <div className="pt-2 border-t border-slate-100">
                  <span className="inline-block px-3 py-1.5 rounded-md bg-blue-600 text-white font-semibold text-xs text-center shadow-2xs">
                    {ctaType === 'BOOK' ? 'Book now' :
                     ctaType === 'ORDER' ? 'Order online' :
                     ctaType === 'CALL' ? 'Call now' :
                     ctaType === 'SIGN_UP' ? 'Sign up' : 'Learn more'}
                  </span>
                </div>
              )}
            </div>
          </div>

          <p className="text-[11px] text-slate-400 text-center mt-4">
            Published posts stay featured on your Google Knowledge Graph panel for up to 6 months.
          </p>
        </div>

      </div>
    </Dialog>
  );
};

export default PostEditorModal;
