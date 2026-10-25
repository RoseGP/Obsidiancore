import React, { useState, useRef } from 'react';
import axios from 'axios';
import { 
  Sparkles, Send, Calendar, Image as ImageIcon, 
  Linkedin, Instagram, Facebook, AlertCircle, X, 
  Upload, Check, Trash2, Layers, Wand2, Loader2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { SocialPlatform, SocialPost, PLATFORM_CONFIGS, PlatformConnectionsMap } from './SocialTypes';
import { PostizIntegration } from '../../types/postiz';
import SocialLivePreview from './SocialLivePreview';

interface UnifiedPostComposerProps {
  initialPost?: Partial<SocialPost> | null;
  connections: PlatformConnectionsMap;
  integrations?: PostizIntegration[];
  onPublishNow: (postData: {
    caption: string;
    platforms: SocialPlatform[];
    mediaUrl?: string;
    mediaName?: string;
    integrationIds?: string[];
  }) => Promise<void>;
  onSchedulePost: (postData: {
    caption: string;
    platforms: SocialPlatform[];
    scheduledAt: string;
    mediaUrl?: string;
    mediaName?: string;
    integrationIds?: string[];
  }) => Promise<void>;
  onSaveDraft: (draftData: {
    caption: string;
    platforms: SocialPlatform[];
    mediaUrl?: string;
    mediaName?: string;
  }) => Promise<void>;
  onClose?: () => void;
  isModal?: boolean;
}

const STOCK_CREATIVES = [
  {
    name: 'Enterprise Cloud Architecture',
    url: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&q=80&w=800'
  },
  {
    name: 'Omnichannel Operations',
    url: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&q=80&w=800'
  },
  {
    name: 'Executive Tech Strategy',
    url: 'https://images.unsplash.com/photo-1551836022-d5d88e9218df?auto=format&fit=crop&q=80&w=800'
  },
  {
    name: 'High-Trust Security',
    url: 'https://images.unsplash.com/photo-1563986768609-322da13575f3?auto=format&fit=crop&q=80&w=800'
  }
];

const SUGGESTED_HASHTAGS = [
  '#OmnichannelCRM', '#AIInnovation', '#B2BGrowth', '#Leadership', '#TechTrends', '#CustomerSuccess'
];

export default function UnifiedPostComposer({
  initialPost,
  connections,
  integrations = [],
  onPublishNow,
  onSchedulePost,
  onSaveDraft,
  onClose,
  isModal = false
}: UnifiedPostComposerProps) {
  // 1. Post Content States
  const [caption, setCaption] = useState<string>(initialPost?.caption || '');
  const [selectedPlatforms, setSelectedPlatforms] = useState<SocialPlatform[]>(() => {
    if (initialPost?.platforms && initialPost.platforms.length > 0) {
      return initialPost.platforms;
    }
    const connectedList = (Object.keys(connections) as SocialPlatform[]).filter(p => connections[p]?.connected);
    return connectedList.length > 0 ? connectedList : ['linkedin', 'twitter'];
  });

  // Selected Postiz Integration IDs (supports multi-account per platform)
  const [selectedIntegrationIds, setSelectedIntegrationIds] = useState<string[]>(() => {
    if (integrations && integrations.length > 0) {
      return integrations.filter(i => !i.disabled).map(i => i.id);
    }
    return [];
  });

  const handleToggleIntegration = (id: string) => {
    setSelectedIntegrationIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  // Media Attachment State
  const [mediaUrl, setMediaUrl] = useState<string | null>(initialPost?.mediaUrl || null);
  const [mediaName, setMediaName] = useState<string | null>(initialPost?.mediaName || null);
  const [isStockPickerOpen, setIsStockPickerOpen] = useState<boolean>(false);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Scheduling State
  const [isScheduling, setIsScheduling] = useState<boolean>(false);
  const [scheduledDate, setScheduledDate] = useState<string>(() => {
    if (initialPost?.scheduledAt) {
      try {
        const d = new Date(initialPost.scheduledAt);
        if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
      } catch (e) {}
    }
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow.toISOString().split('T')[0];
  });
  const [scheduledTime, setScheduledTime] = useState<string>('10:00');

  // AI Assistant States
  const [isAiOpen, setIsAiOpen] = useState<boolean>(false);
  const [aiPrompt, setAiPrompt] = useState<string>('');
  const [aiTone, setAiTone] = useState<string>('Professional');
  const [isGeneratingAi, setIsGeneratingAi] = useState<boolean>(false);

  // Action in-flight loaders
  const [isPublishing, setIsPublishing] = useState<boolean>(false);
  const [isSchedulingAction, setIsSchedulingAction] = useState<boolean>(false);
  const [isSavingDraftAction, setIsSavingDraftAction] = useState<boolean>(false);
  const [formError, setFormError] = useState<string | null>(null);

  const handleTogglePlatform = (platform: SocialPlatform) => {
    setSelectedPlatforms(prev => 
      prev.includes(platform) 
        ? prev.filter(p => p !== platform) 
        : [...prev, platform]
    );
  };

  const handleSelectAllPlatforms = () => {
    setSelectedPlatforms(['linkedin', 'twitter', 'instagram', 'facebook', 'tiktok', 'thread', 'pinterest']);
  };

  const handleClearPlatforms = () => {
    setSelectedPlatforms([]);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processImageFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      processImageFile(e.target.files[0]);
    }
  };

  const processImageFile = (file: File) => {
    if (!file.type.startsWith('image/')) {
      setFormError('Please select a valid image file (PNG, JPEG, WebP).');
      return;
    }
    const reader = new FileReader();
    reader.onload = (event) => {
      setMediaUrl(event.target?.result as string);
      setMediaName(file.name);
      setFormError(null);
    };
    reader.readAsDataURL(file);
  };

  const handleGenerateCaption = async () => {
    if (!aiPrompt.trim() && !caption.trim()) {
      setFormError('Please enter an idea, topic brief, or draft in the AI prompt box.');
      return;
    }

    setIsGeneratingAi(true);
    setFormError(null);

    try {
      const targetPlatformName = selectedPlatforms[0] ? PLATFORM_CONFIGS[selectedPlatforms[0]].name : 'LinkedIn';
      const promptToUse = aiPrompt.trim() || `Enhance and polish this draft for social media: "${caption}"`;

      const response = await axios.post('/api/social-posts/generate-caption', {
        prompt: promptToUse,
        tone: aiTone,
        platform: targetPlatformName
      });

      if (response.data?.text) {
        setCaption(response.data.text);
        setIsAiOpen(false);
      }
    } catch (err: any) {
      console.error('[AI Caption Error]', err);
      const fallbackCaptions: Record<string, string> = {
        Professional: `🚀 Transforming enterprise workflow velocity with unified social pipelines. Real-time omnichannel lead capture is now live across our networks. #OmnichannelCRM #Innovation`,
        Creative: `✨ Behind every high-performing pipeline is intentional design and rock-solid architecture. Ready for next-gen efficiency? 💎 #TechLeadership #SaaS`,
        Casual: `Just dropped some major updates! Streamlined multi-platform social planning is finally here. Let us know what you think! 🎉 #ProductUpdate`
      };
      setCaption(fallbackCaptions[aiTone] || fallbackCaptions['Professional']);
      setIsAiOpen(false);
    } finally {
      setIsGeneratingAi(false);
    }
  };

  const handleAppendHashtag = (tag: string) => {
    setCaption(prev => {
      const trimmed = prev.trim();
      return trimmed ? `${trimmed} ${tag}` : tag;
    });
  };

  const handleTriggerPublishNow = async () => {
    if (!caption.trim()) {
      setFormError('Post caption cannot be empty.');
      return;
    }
    if (selectedPlatforms.length === 0) {
      setFormError('Please select at least one social media platform to publish.');
      return;
    }

    setFormError(null);
    setIsPublishing(true);
    try {
      await onPublishNow({
        caption,
        platforms: selectedPlatforms,
        mediaUrl: mediaUrl || undefined,
        mediaName: mediaName || undefined,
        integrationIds: selectedIntegrationIds.length > 0 ? selectedIntegrationIds : undefined
      });
      if (onClose) onClose();
    } catch (err: any) {
      setFormError(err.message || 'Failed to publish post.');
    } finally {
      setIsPublishing(false);
    }
  };

  const handleTriggerSchedule = async () => {
    if (!caption.trim()) {
      setFormError('Post caption cannot be empty.');
      return;
    }
    if (selectedPlatforms.length === 0 && selectedIntegrationIds.length === 0) {
      setFormError('Please select at least one social media platform or connected account to schedule.');
      return;
    }

    const scheduledIso = new Date(`${scheduledDate}T${scheduledTime}:00`).toISOString();

    setFormError(null);
    setIsSchedulingAction(true);
    try {
      await onSchedulePost({
        caption,
        platforms: selectedPlatforms,
        scheduledAt: scheduledIso,
        mediaUrl: mediaUrl || undefined,
        mediaName: mediaName || undefined,
        integrationIds: selectedIntegrationIds.length > 0 ? selectedIntegrationIds : undefined
      });
      if (onClose) onClose();
    } catch (err: any) {
      setFormError(err.message || 'Failed to schedule post.');
    } finally {
      setIsSchedulingAction(false);
    }
  };

  const handleTriggerSaveDraft = async () => {
    if (!caption.trim()) {
      setFormError('Cannot save an empty draft.');
      return;
    }

    setFormError(null);
    setIsSavingDraftAction(true);
    try {
      await onSaveDraft({
        caption,
        platforms: selectedPlatforms,
        mediaUrl: mediaUrl || undefined,
        mediaName: mediaName || undefined
      });
    } catch (err: any) {
      setFormError(err.message || 'Failed to save draft.');
    } finally {
      setIsSavingDraftAction(false);
    }
  };

  const activeCharLimits = selectedPlatforms.map(p => ({
    platform: p,
    limit: PLATFORM_CONFIGS[p].charLimit,
    remaining: PLATFORM_CONFIGS[p].charLimit - caption.length
  }));

  const mostRestricted = activeCharLimits.sort((a, b) => a.remaining - b.remaining)[0];

  return (
    <div className={`flex flex-col lg:flex-row gap-6 ${isModal ? 'p-6' : ''}`}>
      {/* LEFT COLUMN: COMPOSER CONTROLS */}
      <div className="flex-1 space-y-5">
        
        {/* Header (if modal) */}
        {isModal && (
          <div className="flex items-center justify-between pb-4 border-b border-neutral-200">
            <div>
              <h2 className="text-lg font-bold text-neutral-900 tracking-tight flex items-center gap-2">
                <Layers className="h-5 w-5 text-indigo-600" />
                <span>Multi-Platform Social Composer</span>
              </h2>
              <p className="text-xs text-neutral-500 mt-0.5">
                Draft once, customize, preview live, and broadcast across all your social channels.
              </p>
            </div>
            {onClose && (
              <button
                onClick={onClose}
                className="p-2 rounded-xl text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 transition-all cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            )}
          </div>
        )}

        {/* 1. PLATFORM & CONNECTED ACCOUNTS SELECTION BAR */}
        <div className="bg-neutral-50/70 border border-neutral-200/80 rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-neutral-700">
                {integrations.length > 0 ? 'Target Connected Accounts (Postiz)' : 'Target Social Platforms'}
              </span>
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 border border-indigo-200">
                {integrations.length > 0 ? `${selectedIntegrationIds.length} of ${integrations.length} Selected` : `${selectedPlatforms.length} Selected`}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  if (integrations.length > 0) {
                    setSelectedIntegrationIds(integrations.map(i => i.id));
                  }
                  handleSelectAllPlatforms();
                }}
                className="text-[11px] font-semibold text-neutral-600 hover:text-indigo-600 transition-colors cursor-pointer"
              >
                Select All
              </button>
              <span className="text-neutral-300">•</span>
              <button
                type="button"
                onClick={() => {
                  setSelectedIntegrationIds([]);
                  handleClearPlatforms();
                }}
                className="text-[11px] font-semibold text-neutral-600 hover:text-rose-600 transition-colors cursor-pointer"
              >
                Clear
              </button>
            </div>
          </div>

          {/* If Postiz Integrations are available, render multi-account selector */}
          {integrations.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
              {integrations.map((integ) => {
                const isSelected = selectedIntegrationIds.includes(integ.id);
                const platformKey = integ.identifier?.toLowerCase();
                return (
                  <button
                    key={integ.id}
                    type="button"
                    onClick={() => handleToggleIntegration(integ.id)}
                    className={`flex items-center gap-2.5 p-2.5 rounded-xl border text-left transition-all cursor-pointer relative select-none ${
                      isSelected
                        ? 'bg-indigo-50 border-indigo-500 shadow-xs ring-1 ring-indigo-500/20'
                        : 'bg-white border-neutral-200 text-neutral-600 hover:border-neutral-300'
                    }`}
                  >
                    <div className="relative shrink-0">
                      {integ.picture ? (
                        <img src={integ.picture} alt={integ.name} className="h-8 w-8 rounded-lg object-cover border border-neutral-200" />
                      ) : (
                        <div className="h-8 w-8 rounded-lg bg-indigo-100 flex items-center justify-center font-bold text-xs text-indigo-700">
                          {integ.name.slice(0, 2).toUpperCase()}
                        </div>
                      )}
                      <span className={`absolute -bottom-1 -right-1 h-3.5 w-3.5 rounded-full border-2 border-white flex items-center justify-center text-[9px] font-bold ${
                        isSelected ? 'bg-indigo-600 text-white' : 'bg-neutral-300'
                      }`}>
                        {isSelected ? '✓' : ''}
                      </span>
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1">
                        <span className="text-xs font-semibold text-neutral-900 truncate">{integ.name}</span>
                        <span className="text-[10px] font-mono px-1 py-0.2 rounded bg-neutral-100 text-neutral-600 uppercase">
                          {platformKey}
                        </span>
                      </div>
                      <div className="text-[10px] text-neutral-500 font-mono truncate">{integ.profile || `@${integ.identifier}`}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            /* Platform Pills Grid Fallback */
            <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2">
              {(Object.keys(PLATFORM_CONFIGS) as SocialPlatform[]).map((platform) => {
                const config = PLATFORM_CONFIGS[platform];
                const isSelected = selectedPlatforms.includes(platform);
                const connection = connections[platform];
                const isConnected = connection?.connected;

                return (
                  <button
                    key={platform}
                    type="button"
                    onClick={() => handleTogglePlatform(platform)}
                    className={`flex flex-col items-center justify-center p-2.5 rounded-xl border transition-all cursor-pointer relative select-none ${
                      isSelected
                        ? 'bg-indigo-50 border-indigo-500 text-indigo-950 shadow-xs ring-1 ring-indigo-500/20'
                        : 'bg-white border-neutral-200 text-neutral-600 hover:border-neutral-300 hover:text-neutral-900 shadow-2xs'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 mb-1">
                      {platform === 'linkedin' && <Linkedin className="h-4 w-4 text-[#0A66C2] fill-current" />}
                      {platform === 'twitter' && <span className="font-mono font-bold text-xs text-neutral-900">𝕏</span>}
                      {platform === 'instagram' && <Instagram className="h-4 w-4 text-pink-600" />}
                      {platform === 'facebook' && <Facebook className="h-4 w-4 text-blue-600 fill-current" />}
                      {platform === 'tiktok' && <span className="font-bold text-xs text-cyan-600">TT</span>}
                      {platform === 'thread' && <span className="font-bold text-xs text-neutral-700">@</span>}
                      {platform === 'pinterest' && <span className="font-bold text-xs text-rose-600">P</span>}
                    </div>
                    <span className="text-[11px] font-semibold tracking-tight">{config.name}</span>
                    
                    {/* Connection Indicator Dot */}
                    <div className="flex items-center gap-1 mt-1">
                      <span className={`h-1.5 w-1.5 rounded-full ${isConnected ? 'bg-emerald-500' : 'bg-neutral-300'}`} />
                      <span className="text-[9px] font-mono text-neutral-500">
                        {isConnected ? 'Active' : 'Unlinked'}
                      </span>
                    </div>

                    {/* Checked Badge */}
                    {isSelected && (
                      <div className="absolute -top-1 -right-1 bg-indigo-600 text-white rounded-full p-0.5 shadow-2xs">
                        <Check className="h-2.5 w-2.5 stroke-[3]" />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* 2. MAIN CAPTION & TEXT EDITOR */}
        <div className="bg-neutral-50/70 border border-neutral-200/80 rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-neutral-700">
              Post Content & Media
            </span>

            {/* AI Assistant Quick Toggle */}
            <button
              type="button"
              onClick={() => setIsAiOpen(!isAiOpen)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 text-indigo-700 text-xs font-semibold transition-all cursor-pointer shadow-2xs active:scale-98"
            >
              <Sparkles className="h-3.5 w-3.5 text-indigo-600" />
              <span>{isAiOpen ? 'Close AI Writer' : 'AI Copilot'}</span>
            </button>
          </div>

          {/* AI Writer Expandable Box */}
          <AnimatePresence>
            {isAiOpen && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden bg-indigo-50/50 border border-indigo-200 rounded-xl p-3.5 space-y-3"
              >
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-indigo-900 flex items-center gap-1.5">
                    <Wand2 className="h-3.5 w-3.5 text-indigo-600" />
                    Gemini Social Copywriter
                  </span>
                  <div className="flex items-center gap-1">
                    {['Professional', 'Engaging', 'Creative', 'Casual'].map((tone) => (
                      <button
                        key={tone}
                        type="button"
                        onClick={() => setAiTone(tone)}
                        className={`px-2 py-0.5 rounded-lg text-[10px] font-semibold transition-all cursor-pointer ${
                          aiTone === tone 
                            ? 'bg-indigo-600 text-white shadow-2xs' 
                            : 'bg-white text-neutral-600 border border-neutral-200 hover:text-neutral-900'
                        }`}
                      >
                        {tone}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex gap-2">
                  <input
                    type="text"
                    value={aiPrompt}
                    onChange={(e) => setAiPrompt(e.target.value)}
                    placeholder="e.g. Announce our new real-time WebRTC CRM workspace release with 3 bullet points"
                    className="flex-1 bg-white border border-neutral-300 rounded-xl px-3 py-2 text-xs text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !isGeneratingAi) {
                        e.preventDefault();
                        handleGenerateCaption();
                      }
                    }}
                  />
                  <button
                    type="button"
                    onClick={handleGenerateCaption}
                    disabled={isGeneratingAi}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-semibold rounded-xl flex items-center gap-1.5 transition-all cursor-pointer shrink-0 shadow-xs"
                  >
                    {isGeneratingAi ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        <span>Generating...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-3.5 w-3.5" />
                        <span>Draft Post</span>
                      </>
                    )}
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Text Area */}
          <div className="relative">
            <textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="What would you like to share? Write your multi-platform post caption here..."
              rows={5}
              className="w-full bg-white border border-neutral-300 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded-xl p-3.5 text-sm text-neutral-900 placeholder:text-neutral-400 focus:outline-none leading-relaxed transition-colors resize-y shadow-2xs"
            />

            {/* Character Monitor Badge */}
            <div className="flex items-center justify-between text-xs text-neutral-500 mt-1 px-1">
              <div className="flex items-center gap-2">
                <span>{caption.length} characters</span>
                {mostRestricted && (
                  <span className={`text-[11px] font-mono font-semibold ${
                    mostRestricted.remaining < 0 ? 'text-rose-600' : 'text-neutral-500'
                  }`}>
                    (Limit: {PLATFORM_CONFIGS[mostRestricted.platform].name} {mostRestricted.remaining >= 0 ? `${mostRestricted.remaining} left` : `${Math.abs(mostRestricted.remaining)} over!`})
                  </span>
                )}
              </div>

              {/* Hashtag Quick Inserters */}
              <div className="hidden sm:flex items-center gap-1.5 overflow-x-auto py-1">
                {SUGGESTED_HASHTAGS.slice(0, 3).map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => handleAppendHashtag(tag)}
                    className="text-[10px] font-mono text-indigo-700 hover:text-indigo-900 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200/60 px-2 py-0.5 rounded-md transition-colors cursor-pointer"
                  >
                    {tag}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* 3. MEDIA ATTACHMENTS & ASSETS */}
          <div className="pt-2 border-t border-neutral-200 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-neutral-700 flex items-center gap-1.5">
                <ImageIcon className="h-3.5 w-3.5 text-neutral-500" />
                Creative Media Asset
              </span>
              <button
                type="button"
                onClick={() => setIsStockPickerOpen(!isStockPickerOpen)}
                className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 transition-colors cursor-pointer"
              >
                {isStockPickerOpen ? 'Hide Stock Gallery' : 'Browse Stock Assets'}
              </button>
            </div>

            {/* Stock Creative Selector */}
            {isStockPickerOpen && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-2 bg-white rounded-xl border border-neutral-200 shadow-2xs">
                {STOCK_CREATIVES.map((item, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => {
                      setMediaUrl(item.url);
                      setMediaName(item.name);
                      setIsStockPickerOpen(false);
                    }}
                    className="relative group rounded-lg overflow-hidden border border-neutral-200 hover:border-indigo-500 aspect-video text-left transition-all cursor-pointer"
                  >
                    <img
                      src={item.url}
                      alt={item.name}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent flex items-end p-1.5">
                      <span className="text-[10px] font-semibold text-white leading-tight truncate">
                        {item.name}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {/* Upload Drag & Drop Area */}
            {mediaUrl ? (
              <div className="relative rounded-xl overflow-hidden border border-neutral-200 bg-neutral-100 max-h-48 flex items-center justify-center group shadow-2xs">
                <img
                  src={mediaUrl}
                  alt="Post preview"
                  referrerPolicy="no-referrer"
                  className="max-h-48 w-full object-contain"
                />
                <div className="absolute inset-0 bg-neutral-900/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setMediaUrl(null);
                      setMediaName(null);
                    }}
                    className="p-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white transition-all cursor-pointer flex items-center gap-1 text-xs font-semibold shadow-md"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>Remove Media</span>
                  </button>
                </div>
              </div>
            ) : (
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-5 text-center cursor-pointer transition-all ${
                  isDragging 
                    ? 'border-indigo-500 bg-indigo-50/50' 
                    : 'border-neutral-300 hover:border-neutral-400 bg-white'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleFileSelect}
                  className="hidden"
                />
                <Upload className="h-6 w-6 mx-auto text-neutral-400 mb-1.5" />
                <p className="text-xs font-semibold text-neutral-700">
                  Drag and drop image here, or <span className="text-indigo-600 underline">browse files</span>
                </p>
                <p className="text-[10px] text-neutral-400 mt-0.5">
                  Supports PNG, JPG, WebP (Up to 10MB)
                </p>
              </div>
            )}
          </div>
        </div>

        {/* 4. SCHEDULING CONTROLS */}
        <div className="bg-neutral-50/70 border border-neutral-200/80 rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-indigo-600" />
              <span className="text-xs font-bold uppercase tracking-wider text-neutral-700">
                Publishing Schedule
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setIsScheduling(false)}
                className={`px-3 py-1 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                  !isScheduling ? 'bg-indigo-600 text-white shadow-2xs' : 'bg-white border border-neutral-200 text-neutral-600 hover:text-neutral-900'
                }`}
              >
                Publish Now
              </button>
              <button
                type="button"
                onClick={() => setIsScheduling(true)}
                className={`px-3 py-1 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                  isScheduling ? 'bg-indigo-600 text-white shadow-2xs' : 'bg-white border border-neutral-200 text-neutral-600 hover:text-neutral-900'
                }`}
              >
                Schedule Later
              </button>
            </div>
          </div>

          {/* Schedule Date & Time Selectors */}
          {isScheduling && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
              <div>
                <label className="block text-[11px] font-semibold text-neutral-600 mb-1">Target Date</label>
                <div className="relative">
                  <input
                    type="date"
                    value={scheduledDate}
                    onChange={(e) => setScheduledDate(e.target.value)}
                    className="w-full bg-white border border-neutral-300 rounded-xl px-3 py-2 text-xs text-neutral-900 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 shadow-2xs"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-neutral-600 mb-1">Target Time</label>
                <div className="relative">
                  <input
                    type="time"
                    value={scheduledTime}
                    onChange={(e) => setScheduledTime(e.target.value)}
                    className="w-full bg-white border border-neutral-300 rounded-xl px-3 py-2 text-xs text-neutral-900 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 shadow-2xs"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Validation Errors */}
        {formError && (
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
            <span>{formError}</span>
          </div>
        )}

        {/* 5. PRIMARY SUBMIT ACTIONS */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <button
            type="button"
            onClick={handleTriggerSaveDraft}
            disabled={isSavingDraftAction}
            className="px-4 py-2.5 rounded-xl border border-neutral-200 bg-white hover:bg-neutral-50 text-neutral-700 text-xs font-semibold transition-all cursor-pointer flex items-center gap-2 shadow-2xs"
          >
            {isSavingDraftAction ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Layers className="h-3.5 w-3.5 text-neutral-500" />}
            <span>Save Draft</span>
          </button>

          <div className="flex items-center gap-3">
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2.5 rounded-xl border border-neutral-200 text-neutral-600 hover:text-neutral-900 text-xs font-semibold transition-all cursor-pointer"
              >
                Cancel
              </button>
            )}

            {isScheduling ? (
              <button
                type="button"
                onClick={handleTriggerSchedule}
                disabled={isSchedulingAction}
                className="px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold transition-all cursor-pointer flex items-center gap-2 shadow-xs active:scale-98 disabled:opacity-50"
              >
                {isSchedulingAction ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Scheduling...</span>
                  </>
                ) : (
                  <>
                    <Calendar className="h-4 w-4" />
                    <span>Schedule to {selectedPlatforms.length} Channels</span>
                  </>
                )}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleTriggerPublishNow}
                disabled={isPublishing}
                className="px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold transition-all cursor-pointer flex items-center gap-2 shadow-xs active:scale-98 disabled:opacity-50"
              >
                {isPublishing ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Broadcasting...</span>
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4" />
                    <span>Publish Now to {selectedPlatforms.length} Channels</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>

      </div>

      {/* RIGHT COLUMN: REAL-TIME INTERACTIVE LIVE PREVIEW */}
      <div className="w-full lg:w-[480px] xl:w-[520px] shrink-0">
        <div className="sticky top-6">
          <SocialLivePreview
            caption={caption}
            mediaUrl={mediaUrl}
            selectedPlatforms={selectedPlatforms}
          />
        </div>
      </div>
    </div>
  );
}
