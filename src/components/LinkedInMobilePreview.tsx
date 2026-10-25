import React, { useState } from 'react';
import { 
  ThumbsUp, 
  MessageSquare, 
  Send, 
  Globe, 
  MoreHorizontal, 
  X, 
  Heart, 
  Lightbulb, 
  Sparkles,
  Smartphone,
  Info,
  Repeat2,
  Image as ImageIcon
} from 'lucide-react';

interface LinkedInMobilePreviewProps {
  caption: string;
  mediaUrl?: string | null;
  mediaName?: string | null;
  profile?: {
    name?: string;
    headline?: string;
    pictureUrl?: string;
  } | null;
}

/**
 * LinkedInMobilePreview Component
 * Renders a high-fidelity, mobile-optimized preview mimicking the LinkedIn iOS/Android feed layout.
 * Features realistic headers, battery/signal mock lines, hashtags parser, interactions bar, and a device frame wrapper.
 */
export default function LinkedInMobilePreview({
  caption,
  mediaUrl,
  mediaName,
  profile
}: LinkedInMobilePreviewProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isLiked, setIsLiked] = useState(false);
  const [likesCount, setLikesCount] = useState(38);

  // Helper to format hashtags and links with LinkedIn blue styling
  const formatCaptionText = (text: string) => {
    if (!text) {
      return (
        <span className="text-slate-400 italic">
          Start typing in the caption box to view your feed presentation in real-time...
        </span>
      );
    }

    const parts = text.split(/(\#[a-zA-Z0-9\_]+|\bhttps?:\/\/\S+)/g);
    return parts.map((part, index) => {
      if (part.startsWith('#')) {
        return (
          <span key={index} className="text-[#0a66c2] hover:underline font-semibold cursor-pointer">
            {part}
          </span>
        );
      } else if (part.match(/^https?:\/\//)) {
        return (
          <span key={index} className="text-[#0a66c2] hover:underline break-all cursor-pointer">
            {part}
          </span>
        );
      }
      return <span key={index}>{part}</span>;
    });
  };

  const handleLikeToggle = () => {
    if (isLiked) {
      setLikesCount(prev => prev - 1);
    } else {
      setLikesCount(prev => prev + 1);
    }
    setIsLiked(!isLiked);
  };

  const profileName = profile?.name || 'LinkedIn Member';
  const profileHeadline = profile?.headline || 'Enterprise CRM Architect & Content Lead';
  const profilePic = profile?.pictureUrl || 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&q=80&w=150&h=150';

  const limit = 140;
  const shouldTruncate = caption.length > limit;
  const displayCaption = shouldTruncate && !isExpanded ? `${caption.slice(0, limit)}...` : caption;

  return (
    <div className="flex flex-col items-center space-y-4 w-full" id="linkedin-mobile-preview-container">
      {/* Device frame toggle indicator */}
      <div className="flex items-center gap-2 text-[10px] text-slate-400 font-extrabold uppercase tracking-wider bg-slate-900/5 px-3 py-1 rounded-full border border-slate-200/50">
        <Smartphone className="h-3.5 w-3.5 text-blue-500" />
        <span>LinkedIn iOS/Android Mobile Viewport</span>
      </div>

      {/* Simulated Smartphone Device Wrapper */}
      <div className="relative mx-auto w-[330px] h-[580px] rounded-[40px] border-[10px] border-slate-900 bg-slate-100 shadow-2xl overflow-hidden flex flex-col select-none">
        {/* Notch / Speaker */}
        <div className="absolute top-0 left-1/2 transform -translate-x-1/2 w-32 h-5 bg-slate-900 rounded-b-2xl z-50 flex justify-center items-start">
          <div className="w-12 h-1 bg-slate-800 rounded-full mt-1" />
        </div>

        {/* Device Status Bar */}
        <div className="h-6 bg-white flex justify-between items-center px-6 text-[10px] font-bold text-slate-700 z-10 pt-1 shrink-0">
          <span>9:41</span>
          <div className="flex items-center gap-1.5">
            {/* Cell Signal */}
            <div className="flex items-end gap-0.5 h-2">
              <div className="w-0.5 h-1 bg-slate-750 rounded-xs" />
              <div className="w-0.5 h-1.5 bg-slate-750 rounded-xs" />
              <div className="w-0.5 h-2 bg-slate-750 rounded-xs" />
            </div>
            <span>5G</span>
            {/* Battery */}
            <div className="w-5 h-2.5 border border-slate-750 rounded-sm p-0.5 flex items-center">
              <div className="w-full h-full bg-slate-750 rounded-2xs" />
            </div>
          </div>
        </div>

        {/* Simulated App Navigation Bar */}
        <div className="h-11 bg-white border-b border-slate-200 px-3 flex items-center gap-3 shrink-0">
          <img 
            src={profilePic} 
            alt="LinkedIn user" 
            className="h-6 w-6 rounded-full object-cover border border-slate-100" 
            referrerPolicy="no-referrer"
          />
          <div className="flex-1 bg-slate-100 h-7 rounded-full flex items-center px-3 text-[11px] text-slate-450 font-semibold gap-1.5 border border-slate-200/50">
            <span>🔍 Search</span>
          </div>
          <span className="text-slate-500 text-xs font-bold">💬</span>
        </div>

        {/* Scrollable Feed Container */}
        <div className="flex-1 overflow-y-auto bg-slate-200/60 p-2 space-y-2.5 scrollbar-thin">
          
          {/* Post Card */}
          <div className="bg-white rounded-xl shadow-xs border border-slate-250/50 p-3 space-y-3">
            {/* Post Header */}
            <div className="flex items-start gap-2">
              <img 
                src={profilePic} 
                alt="Profile photo" 
                className="h-9 w-9 rounded-full object-cover border border-slate-150 shrink-0"
                referrerPolicy="no-referrer"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-black text-slate-900 leading-snug truncate pr-2">
                    {profileName}
                  </span>
                  <div className="flex items-center gap-1.5 text-slate-400">
                    <MoreHorizontal className="h-4 w-4 text-slate-500 cursor-pointer" />
                  </div>
                </div>
                <span className="text-[10px] text-slate-500 font-semibold line-clamp-1 leading-none mt-0.5">
                  {profileHeadline}
                </span>
                <span className="text-[9px] text-slate-400 font-bold block mt-1">
                  1h • <Globe className="h-2.5 w-2.5 inline-block -mt-0.5 text-slate-400" />
                </span>
              </div>
            </div>

            {/* Post Caption text */}
            <div className="text-slate-800 text-[11px] font-medium leading-relaxed whitespace-pre-wrap break-words px-0.5">
              {formatCaptionText(displayCaption)}
              {shouldTruncate && !isExpanded && (
                <button 
                  type="button" 
                  onClick={() => setIsExpanded(true)}
                  className="text-[#0a66c2] hover:underline font-bold ml-1 text-[11px] focus:outline-hidden cursor-pointer"
                >
                  ...see more
                </button>
              )}
              {shouldTruncate && isExpanded && (
                <button 
                  type="button" 
                  onClick={() => setIsExpanded(false)}
                  className="text-[#0a66c2] hover:underline font-bold ml-1 text-[11px] focus:outline-hidden cursor-pointer"
                >
                  show less
                </button>
              )}
            </div>

            {/* Post Media Area / Media Placeholder if none */}
            {mediaUrl ? (
              <div className="rounded-lg overflow-hidden border border-slate-150 bg-slate-50 -mx-3 aspect-video">
                <img 
                  src={mediaUrl} 
                  alt={mediaName || 'Attached graphic'} 
                  className="w-full h-full object-cover"
                  referrerPolicy="no-referrer"
                />
              </div>
            ) : (
              /* Dotted placeholder showing mobile layout capability as requested */
              <div className="rounded-lg border-2 border-dashed border-slate-200 bg-slate-50/70 py-6 px-4 flex flex-col items-center justify-center text-center -mx-1 gap-1.5 group hover:border-slate-300 transition-colors">
                <div className="p-2 bg-slate-100 rounded-full border border-slate-200">
                  <ImageIcon className="h-4 w-4 text-slate-400 group-hover:scale-110 transition-transform duration-300" />
                </div>
                <span className="text-[10px] text-slate-700 font-bold">Media Content Box</span>
                <span className="text-[9px] text-slate-400 max-w-[200px] leading-snug font-medium">
                  Add an image, document, or links to replace this placeholder inside your scheduled post.
                </span>
              </div>
            )}

            {/* Post Social Stats */}
            <div className="flex items-center justify-between border-b border-slate-100 pb-2.5 pt-0.5 text-[9px] text-slate-500 font-bold">
              {/* Reactions Bar */}
              <div className="flex items-center gap-1">
                <div className="flex items-center -space-x-1">
                  <div className="bg-[#0a66c2] p-0.5 rounded-full border border-white flex items-center justify-center">
                    <ThumbsUp className="h-2 w-2 text-white fill-current" />
                  </div>
                  <div className="bg-rose-500 p-0.5 rounded-full border border-white flex items-center justify-center">
                    <Heart className="h-2 w-2 text-white fill-current" />
                  </div>
                  <div className="bg-amber-400 p-0.5 rounded-full border border-white flex items-center justify-center">
                    <Lightbulb className="h-2 w-2 text-white fill-current" />
                  </div>
                </div>
                <span>{likesCount}</span>
              </div>
              {/* Comments & Reposts count */}
              <div className="flex items-center gap-2">
                <span>12 comments</span>
                <span>•</span>
                <span>4 reposts</span>
              </div>
            </div>

            {/* Post Interaction bar */}
            <div className="flex items-center justify-between px-1 pt-0.5">
              <button 
                type="button" 
                onClick={handleLikeToggle}
                className={`flex flex-col items-center justify-center gap-0.5 text-[9px] font-extrabold transition-colors duration-250 cursor-pointer ${
                  isLiked ? 'text-[#0a66c2]' : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                <ThumbsUp className={`h-3.5 w-3.5 ${isLiked ? 'fill-current' : ''}`} />
                <span>Like</span>
              </button>
              <button 
                type="button" 
                className="flex flex-col items-center justify-center gap-0.5 text-slate-500 hover:text-slate-800 text-[9px] font-extrabold cursor-pointer"
              >
                <MessageSquare className="h-3.5 w-3.5" />
                <span>Comment</span>
              </button>
              <button 
                type="button" 
                className="flex flex-col items-center justify-center gap-0.5 text-slate-500 hover:text-slate-800 text-[9px] font-extrabold cursor-pointer"
              >
                <Repeat2 className="h-3.5 w-3.5" />
                <span>Repost</span>
              </button>
              <button 
                type="button" 
                className="flex flex-col items-center justify-center gap-0.5 text-slate-500 hover:text-slate-800 text-[9px] font-extrabold cursor-pointer"
              >
                <Send className="h-3.5 w-3.5" />
                <span>Send</span>
              </button>
            </div>
          </div>

          {/* Interactive Tooltip Card in Feed */}
          <div className="bg-blue-50/80 rounded-xl border border-blue-100 p-3 flex gap-2">
            <Info className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <span className="text-[10px] font-black text-blue-800 block">Omnichannel Synchronization</span>
              <p className="text-[9px] text-blue-650 leading-relaxed font-semibold">
                Your post will publish exactly inside this layout grid structure. We format emojis, layout margins, and scale high-res attachments seamlessly.
              </p>
            </div>
          </div>
          
        </div>

        {/* Simulated iOS Home Bar */}
        <div className="h-5 bg-white flex justify-center items-center shrink-0">
          <div className="w-32 h-1 bg-slate-350 rounded-full" />
        </div>
      </div>
    </div>
  );
}
