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
  const [ctaUrl, setCtaUrl] = useState(initialPost?.ctaUrl || '');
  const [locationId, setLocationId] = useState(initialPost?.locationId || locations[0]?.id || '');
  // Photos aren't uploaded through this editor yet, so only an existing post's image is shown.
  const imageUrl = initialPost?.imageUrl || '';

  const selectedLoc = locations.find((l) => l.id === locationId);

  const handlePublish = (status: 'Published') => {
    onSavePost({
      // Only an existing post carries an id; a new post gets its id from Google.
      ...(initialPost?.id ? { id: initialPost.id } : {}),
      locationId,
      locationName: selectedLoc?.name || '',
      type: postType,
      title: title || undefined,
      content,
      ctaType,
      ctaUrl,
      imageUrl,
      status,
      isAiGenerated: false
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
          <span className="text-[11px] text-slate-500">
            Posts are published right away. Scheduling and drafts aren't available yet.
          </span>

          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
            <Button
              variant="primary"
              size="sm"
              disabled={!content.trim() || !locationId}
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
                placeholder="e.g. Holiday opening hours"
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
                How the post may look
              </span>
              <span className="px-1.5 py-0.5 rounded bg-slate-200 text-slate-700 text-[10px] font-semibold">
                Preview
              </span>
            </div>

            {/* Post preview */}
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
                  {content || 'Write the post on the left to preview it here.'}
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
            Preview only. Google decides exactly how and where the post appears.
          </p>
        </div>

      </div>
    </Dialog>
  );
};

export default PostEditorModal;
