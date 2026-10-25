import React, { useState } from 'react';
import { 
  ThumbsUp, MessageSquare, Send, Globe, MoreHorizontal, Heart, 
  Repeat2, Bookmark, Share2, Linkedin, Instagram, Facebook, 
  CheckCircle2, Eye, Smartphone, Monitor
} from 'lucide-react';
import { SocialPlatform, PLATFORM_CONFIGS } from './SocialTypes';

interface SocialLivePreviewProps {
  caption: string;
  mediaUrl?: string | null;
  selectedPlatforms: SocialPlatform[];
  authorName?: string;
  authorHeadline?: string;
  authorAvatar?: string;
  className?: string;
}

export default function SocialLivePreview({
  caption,
  mediaUrl,
  selectedPlatforms,
  authorName = 'Sarah Jenkins',
  authorHeadline = 'Principal Brand Strategist | Enterprise AI & Omnichannel Systems',
  authorAvatar = 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&q=80&w=150&h=150',
  className = ''
}: SocialLivePreviewProps) {
  const defaultTab = selectedPlatforms.length > 0 ? selectedPlatforms[0] : 'linkedin';
  const [activePreview, setActivePreview] = useState<SocialPlatform>(defaultTab);
  const [deviceMode, setDeviceMode] = useState<'desktop' | 'mobile'>('desktop');

  React.useEffect(() => {
    if (selectedPlatforms.length > 0 && !selectedPlatforms.includes(activePreview)) {
      setActivePreview(selectedPlatforms[0]);
    }
  }, [selectedPlatforms, activePreview]);

  const renderFormattedText = (text: string, hashtagColor: string) => {
    if (!text || !text.trim()) {
      return (
        <span className="text-neutral-400 italic text-sm">
          Write your post caption on the left to see the live feed rendering in real time...
        </span>
      );
    }

    const parts = text.split(/(\#[a-zA-Z0-9\_]+|\bhttps?:\/\/\S+)/g);
    return parts.map((part, index) => {
      if (part.startsWith('#')) {
        return (
          <span key={index} className={`${hashtagColor} font-semibold hover:underline cursor-pointer`}>
            {part}
          </span>
        );
      }
      if (part.startsWith('http://') || part.startsWith('https://')) {
        return (
          <span key={index} className="text-blue-600 hover:underline cursor-pointer break-all">
            {part}
          </span>
        );
      }
      return <span key={index}>{part}</span>;
    });
  };

  return (
    <div className={`flex flex-col bg-neutral-50/70 border border-neutral-200/80 rounded-2xl overflow-hidden shadow-2xs ${className}`}>
      {/* Top Preview Controls Bar */}
      <div className="px-4 py-3 bg-white border-b border-neutral-200 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 text-xs font-bold text-neutral-800">
            <Eye className="h-3.5 w-3.5 text-indigo-600" />
            <span>Live Multi-Platform Preview</span>
          </div>
        </div>

        {/* Platform Switcher Tabs */}
        <div className="flex items-center gap-1 bg-neutral-100 p-1 rounded-xl border border-neutral-200">
          {(['linkedin', 'twitter', 'instagram', 'facebook'] as SocialPlatform[]).map((platform) => {
            const isSelected = selectedPlatforms.includes(platform);
            const isActive = activePreview === platform;
            const config = PLATFORM_CONFIGS[platform];

            return (
              <button
                key={platform}
                onClick={() => setActivePreview(platform)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                  isActive
                    ? 'bg-white text-neutral-900 shadow-2xs'
                    : isSelected
                    ? 'text-neutral-700 hover:text-neutral-900 hover:bg-neutral-200/60'
                    : 'text-neutral-400 hover:text-neutral-600 opacity-60'
                }`}
                title={`Preview as ${config.name}`}
              >
                {platform === 'linkedin' && <Linkedin className="h-3 w-3 text-[#0A66C2] fill-current" />}
                {platform === 'twitter' && <span className="font-mono font-bold text-[10px]">𝕏</span>}
                {platform === 'instagram' && <Instagram className="h-3 w-3 text-pink-600" />}
                {platform === 'facebook' && <Facebook className="h-3 w-3 text-blue-600 fill-current" />}
                <span className="hidden sm:inline text-[11px]">{config.name}</span>
                {isSelected && (
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 ml-0.5" title="Selected for publishing" />
                )}
              </button>
            );
          })}
        </div>

        {/* Device Switcher */}
        <div className="hidden sm:flex items-center gap-1 bg-neutral-100 p-1 rounded-xl border border-neutral-200">
          <button
            onClick={() => setDeviceMode('desktop')}
            className={`p-1.5 rounded-lg text-xs transition-all cursor-pointer ${
              deviceMode === 'desktop' ? 'bg-white text-neutral-900 shadow-2xs' : 'text-neutral-500 hover:text-neutral-800'
            }`}
            title="Desktop View"
          >
            <Monitor className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setDeviceMode('mobile')}
            className={`p-1.5 rounded-lg text-xs transition-all cursor-pointer ${
              deviceMode === 'mobile' ? 'bg-white text-neutral-900 shadow-2xs' : 'text-neutral-500 hover:text-neutral-800'
            }`}
            title="Mobile View"
          >
            <Smartphone className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Preview Container Screen */}
      <div className="p-4 sm:p-6 flex-1 flex items-center justify-center bg-neutral-100/70 overflow-y-auto min-h-[380px]">
        <div className={`w-full transition-all duration-300 ${deviceMode === 'mobile' ? 'max-w-[380px]' : 'max-w-[560px]'}`}>
          
          {/* 1. LINKEDIN PREVIEW CARD */}
          {activePreview === 'linkedin' && (
            <div className="bg-white rounded-xl border border-neutral-200 shadow-md overflow-hidden text-neutral-900 font-sans">
              <div className="p-4 pb-2 flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <img
                    src={authorAvatar}
                    alt={authorName}
                    referrerPolicy="no-referrer"
                    className="h-11 w-11 rounded-full object-cover border border-neutral-200 shrink-0"
                  />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1">
                      <h4 className="text-sm font-bold text-neutral-900 hover:text-[#0A66C2] cursor-pointer truncate">
                        {authorName}
                      </h4>
                      <span className="text-[11px] text-neutral-500 font-medium shrink-0">• 1st</span>
                    </div>
                    <p className="text-[11px] text-neutral-500 leading-tight truncate">
                      {authorHeadline}
                    </p>
                    <div className="flex items-center gap-1 text-[10px] text-neutral-400 mt-0.5">
                      <span>Just now</span>
                      <span>•</span>
                      <Globe className="h-2.5 w-2.5" />
                    </div>
                  </div>
                </div>
                <button className="text-neutral-400 hover:text-neutral-600 p-1">
                  <MoreHorizontal className="h-4 w-4" />
                </button>
              </div>

              <div className="px-4 py-2.5 text-xs sm:text-sm text-neutral-800 leading-relaxed whitespace-pre-wrap">
                {renderFormattedText(caption, 'text-[#0A66C2]')}
              </div>

              {mediaUrl && (
                <div className="mt-2 bg-neutral-100 border-y border-neutral-200 overflow-hidden">
                  <img
                    src={mediaUrl}
                    alt="Post creative"
                    referrerPolicy="no-referrer"
                    className="w-full max-h-[340px] object-cover"
                  />
                </div>
              )}

              <div className="px-4 py-2 border-b border-neutral-100 flex items-center justify-between text-[11px] text-neutral-500">
                <div className="flex items-center gap-1">
                  <div className="flex -space-x-1">
                    <span className="h-4 w-4 rounded-full bg-[#0A66C2] flex items-center justify-center text-white text-[8px]">
                      👍
                    </span>
                    <span className="h-4 w-4 rounded-full bg-emerald-600 flex items-center justify-center text-white text-[8px]">
                      👏
                    </span>
                    <span className="h-4 w-4 rounded-full bg-rose-500 flex items-center justify-center text-white text-[8px]">
                      ❤️
                    </span>
                  </div>
                  <span className="ml-1 text-neutral-700 font-semibold">142</span>
                </div>
                <div className="flex items-center gap-2">
                  <span>18 comments</span>
                  <span>•</span>
                  <span>7 reposts</span>
                </div>
              </div>

              <div className="px-2 py-1 flex items-center justify-between text-neutral-600 text-xs font-semibold">
                <button className="flex-1 py-2 rounded-lg hover:bg-neutral-100 flex items-center justify-center gap-1.5 text-neutral-700">
                  <ThumbsUp className="h-4 w-4" />
                  <span>Like</span>
                </button>
                <button className="flex-1 py-2 rounded-lg hover:bg-neutral-100 flex items-center justify-center gap-1.5 text-neutral-700">
                  <MessageSquare className="h-4 w-4" />
                  <span>Comment</span>
                </button>
                <button className="flex-1 py-2 rounded-lg hover:bg-neutral-100 flex items-center justify-center gap-1.5 text-neutral-700">
                  <Repeat2 className="h-4 w-4" />
                  <span>Repost</span>
                </button>
                <button className="flex-1 py-2 rounded-lg hover:bg-neutral-100 flex items-center justify-center gap-1.5 text-neutral-700">
                  <Send className="h-4 w-4" />
                  <span>Send</span>
                </button>
              </div>
            </div>
          )}

          {/* 2. X (TWITTER) PREVIEW CARD */}
          {activePreview === 'twitter' && (
            <div className="bg-white rounded-2xl border border-neutral-200 shadow-md overflow-hidden text-neutral-900 font-sans p-4">
              <div className="flex items-start gap-3">
                <img
                  src={authorAvatar}
                  alt={authorName}
                  referrerPolicy="no-referrer"
                  className="h-10 w-10 rounded-full object-cover border border-neutral-200 shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 truncate">
                      <span className="font-bold text-sm text-neutral-900 truncate">{authorName}</span>
                      <span className="text-neutral-500 text-xs font-mono">@flowforge</span>
                      <span className="text-neutral-400 text-xs">·</span>
                      <span className="text-neutral-400 text-xs">now</span>
                    </div>
                    <button className="text-neutral-400 hover:text-neutral-600">
                      <MoreHorizontal className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="mt-1 text-sm text-neutral-800 leading-relaxed whitespace-pre-wrap">
                    {renderFormattedText(caption, 'text-sky-600')}
                  </div>

                  {mediaUrl && (
                    <div className="mt-3 rounded-2xl border border-neutral-200 overflow-hidden bg-neutral-100 max-h-[300px]">
                      <img
                        src={mediaUrl}
                        alt="Tweet creative"
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover"
                      />
                    </div>
                  )}

                  <div className="mt-3 flex items-center justify-between text-neutral-500 text-xs max-w-md pt-1">
                    <div className="flex items-center gap-1.5 hover:text-sky-600 cursor-pointer">
                      <MessageSquare className="h-4 w-4" />
                      <span>24</span>
                    </div>
                    <div className="flex items-center gap-1.5 hover:text-emerald-600 cursor-pointer">
                      <Repeat2 className="h-4 w-4" />
                      <span>12</span>
                    </div>
                    <div className="flex items-center gap-1.5 hover:text-rose-600 cursor-pointer">
                      <Heart className="h-4 w-4" />
                      <span>89</span>
                    </div>
                    <div className="flex items-center gap-1.5 hover:text-sky-600 cursor-pointer">
                      <Bookmark className="h-4 w-4" />
                    </div>
                    <div className="flex items-center gap-1.5 hover:text-sky-600 cursor-pointer">
                      <Share2 className="h-4 w-4" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 3. INSTAGRAM PREVIEW CARD */}
          {activePreview === 'instagram' && (
            <div className="bg-white rounded-2xl border border-neutral-200 shadow-md overflow-hidden text-neutral-900 font-sans">
              <div className="p-3.5 flex items-center justify-between border-b border-neutral-100">
                <div className="flex items-center gap-2.5">
                  <div className="p-[2px] rounded-full bg-gradient-to-tr from-amber-500 via-rose-500 to-purple-600">
                    <img
                      src={authorAvatar}
                      alt={authorName}
                      referrerPolicy="no-referrer"
                      className="h-8 w-8 rounded-full object-cover border-2 border-white shrink-0"
                    />
                  </div>
                  <div>
                    <div className="flex items-center gap-1">
                      <span className="text-xs font-bold text-neutral-900">flowforge.studio</span>
                      <CheckCircle2 className="h-3 w-3 text-sky-500 fill-current" />
                    </div>
                    <span className="text-[10px] text-neutral-500">Original audio</span>
                  </div>
                </div>
                <MoreHorizontal className="h-4 w-4 text-neutral-400" />
              </div>

              <div className="bg-neutral-100 aspect-square w-full flex items-center justify-center overflow-hidden relative">
                {mediaUrl ? (
                  <img
                    src={mediaUrl}
                    alt="Instagram media"
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="p-6 text-center text-neutral-400 space-y-2">
                    <Instagram className="h-12 w-12 mx-auto text-neutral-300" />
                    <p className="text-xs">Attach an image or video to showcase Instagram creative</p>
                  </div>
                )}
              </div>

              <div className="p-3.5 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4 text-neutral-800">
                    <Heart className="h-5 w-5 hover:text-rose-600 cursor-pointer" />
                    <MessageSquare className="h-5 w-5 hover:text-neutral-600 cursor-pointer" />
                    <Send className="h-5 w-5 hover:text-neutral-600 cursor-pointer" />
                  </div>
                  <Bookmark className="h-5 w-5 text-neutral-800 hover:text-neutral-600 cursor-pointer" />
                </div>

                <div className="text-xs font-bold text-neutral-900">
                  348 likes
                </div>

                <div className="text-xs leading-relaxed text-neutral-800">
                  <span className="font-bold text-neutral-900 mr-1.5">flowforge.studio</span>
                  {renderFormattedText(caption, 'text-sky-600')}
                </div>

                <div className="text-[10px] text-neutral-400 uppercase tracking-wider">
                  Just now
                </div>
              </div>
            </div>
          )}

          {/* 4. FACEBOOK PREVIEW CARD */}
          {activePreview === 'facebook' && (
            <div className="bg-white rounded-xl border border-neutral-200 shadow-md overflow-hidden text-neutral-900 font-sans">
              <div className="p-3.5 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <img
                    src={authorAvatar}
                    alt={authorName}
                    referrerPolicy="no-referrer"
                    className="h-10 w-10 rounded-full object-cover border border-neutral-200"
                  />
                  <div>
                    <h4 className="text-xs font-bold text-neutral-900">{authorName}</h4>
                    <div className="flex items-center gap-1 text-[10px] text-neutral-500">
                      <span>Just now</span>
                      <span>•</span>
                      <Globe className="h-2.5 w-2.5" />
                    </div>
                  </div>
                </div>
                <MoreHorizontal className="h-4 w-4 text-neutral-400" />
              </div>

              <div className="px-3.5 pb-3 text-xs leading-relaxed text-neutral-800 whitespace-pre-wrap">
                {renderFormattedText(caption, 'text-blue-600')}
              </div>

              {mediaUrl && (
                <div className="bg-neutral-100 max-h-[340px] overflow-hidden">
                  <img
                    src={mediaUrl}
                    alt="Facebook attachment"
                    referrerPolicy="no-referrer"
                    className="w-full object-cover"
                  />
                </div>
              )}

              <div className="p-2 border-t border-neutral-100 flex items-center justify-around text-neutral-600 text-xs font-semibold">
                <button className="flex items-center gap-1.5 py-1.5 px-3 rounded-lg hover:bg-neutral-100 text-neutral-700">
                  <ThumbsUp className="h-4 w-4" />
                  <span>Like</span>
                </button>
                <button className="flex items-center gap-1.5 py-1.5 px-3 rounded-lg hover:bg-neutral-100 text-neutral-700">
                  <MessageSquare className="h-4 w-4" />
                  <span>Comment</span>
                </button>
                <button className="flex items-center gap-1.5 py-1.5 px-3 rounded-lg hover:bg-neutral-100 text-neutral-700">
                  <Share2 className="h-4 w-4" />
                  <span>Share</span>
                </button>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
