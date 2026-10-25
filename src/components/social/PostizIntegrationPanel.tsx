import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import { 
  Share2, ShieldCheck, RefreshCw, Plus, Calendar, Clock, 
  Trash2, ExternalLink, AlertTriangle, CheckCircle2, X, 
  Image as ImageIcon, Link as LinkIcon, Send, Eye, FileText, 
  Sparkles, Check, ChevronRight, AlertCircle, Layers, Globe,
  Lock, Key, Info, Ban, MessageSquare, Twitter, Linkedin, 
  Instagram, Facebook, Video, CheckSquare, Square, Edit3,
  Copy, ArrowRight, Wand2, Sliders, MapPin, CheckCheck
} from 'lucide-react';
import { 
  PostizIntegration, 
  PostizMediaItem, 
  PostizPostResponse, 
  PostizPublishType 
} from '../../types/postiz';

interface PostizIntegrationPanelProps {
  userId?: string;
  onPostCreated?: (post: PostizPostResponse) => void;
}

const COMMON_TIMEZONES = [
  { id: 'America/New_York', label: 'America/New_York (Eastern Time - ET)' },
  { id: 'America/Chicago', label: 'America/Chicago (Central Time - CT)' },
  { id: 'America/Denver', label: 'America/Denver (Mountain Time - MT)' },
  { id: 'America/Los_Angeles', label: 'America/Los_Angeles (Pacific Time - PT)' },
  { id: 'Europe/London', label: 'Europe/London (GMT/BST)' },
  { id: 'Europe/Paris', label: 'Europe/Paris (Central European - CET)' },
  { id: 'Asia/Tokyo', label: 'Asia/Tokyo (Japan Standard - JST)' },
  { id: 'UTC', label: 'UTC (Coordinated Universal Time)' }
];

const PREFILL_PROMPTS = [
  "Announce our new AI scheduling feature. Make it professional but exciting. Mention that customers can schedule across multiple social networks from one dashboard.",
  "Share a customer success spotlight: how our omnichannel platform helped a high-growth client reduce lead response latency by 85%.",
  "Product launch announcement: Double-encrypted sovereign communications and real-time CRM telephony tunnels are now active."
];

export default function PostizIntegrationPanel({ userId = 'default_admin_crm_user', onPostCreated }: PostizIntegrationPanelProps) {
  // Connection States
  const [connectionStatus, setConnectionStatus] = useState<{
    connected: boolean;
    status: 'active' | 'revoked' | 'expired' | 'disconnected';
    authType?: 'oauth' | 'api_key';
    workspaceId?: string;
    userEmail?: string;
    reconnectReason?: string;
  }>({
    connected: false,
    status: 'disconnected'
  });
  const [isLoadingStatus, setIsLoadingStatus] = useState<boolean>(true);
  const [isConnecting, setIsConnecting] = useState<boolean>(false);

  // Channels / Integrations State
  const [integrations, setIntegrations] = useState<PostizIntegration[]>([]);
  const [isLoadingIntegrations, setIsLoadingIntegrations] = useState<boolean>(false);
  const [selectedIntegrationIds, setSelectedIntegrationIds] = useState<string[]>([]);

  // Composer Form State
  const [prompt, setPrompt] = useState<string>(
    "Announce our new AI scheduling feature. Make it professional but exciting. Mention that customers can schedule across multiple social networks from one dashboard."
  );
  const [directText, setDirectText] = useState<string>('');
  const [composerMode, setComposerMode] = useState<'ai_prompt' | 'manual'>('ai_prompt');

  // Media Attachment State
  const [mediaList, setMediaList] = useState<PostizMediaItem[]>([
    {
      id: 'media_sample_dashboard',
      name: 'ai_social_scheduling_cockpit.jpg',
      path: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&q=80&w=1200',
      mimeType: 'image/jpeg'
    }
  ]);
  const [isUploadingMedia, setIsUploadingMedia] = useState<boolean>(false);
  const [urlInput, setUrlInput] = useState<string>('');
  const [showUrlInput, setShowUrlInput] = useState<boolean>(false);

  // Scheduling & Timing
  const [publishType, setPublishType] = useState<PostizPublishType>('schedule');
  const [scheduleDate, setScheduleDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().split('T')[0];
  });
  const [scheduleTime, setScheduleTime] = useState<string>('10:00');
  const [timezone, setTimezone] = useState<string>('America/New_York');

  // AI Options
  const [adaptPerPlatform, setAdaptPerPlatform] = useState<boolean>(true);
  const [tone, setTone] = useState<string>('Professional');
  const [callToAction, setCallToAction] = useState<string>('Learn more');
  const [isGeneratingAi, setIsGeneratingAi] = useState<boolean>(false);

  // Platform-Specific Generated Content (keyed by platform name e.g. 'linkedin', 'instagram', 'twitter', 'facebook', 'tiktok')
  const [platformDrafts, setPlatformDrafts] = useState<Record<string, string>>({
    linkedin: "🚀 Big announcement: We are excited to introduce our new AI-powered social scheduling module!\n\nMarketing and operations teams can now compose, adapt, and schedule content across multiple enterprise social networks—all from a single, unified omnichannel dashboard. Save hours of manual formatting while maintaining peak brand consistency.\n\nReady to transform your broadcast velocity? Learn more below.\n\n#OmnichannelCRM #AIInnovation #B2BMarketing #ProductLaunch",
    instagram: "✨ Streamline your social strategy! 🎯 Say goodbye to juggling 5 different apps just to publish your content.\n\nOur brand new AI Multi-Channel Scheduler lets you compose once and automatically optimize for every network in seconds. Seamless workflows, built-in analytics, and instant publishing.\n\nTap the link in bio to learn more! 🚀\n\n#SocialMediaMarketing #AItools #ProductivityHacks #TechLaunch #Omnichannel",
    twitter: "Announcing our new AI Social Scheduling cockpit! 🚀\n\nSchedule across X, LinkedIn, Instagram & Facebook from one unified CRM dashboard with automatic per-platform adaptation.\n\nLearn more: https://flowforge.studio/social\n\n#ProductLaunch #AI",
    facebook: "We're thrilled to announce the launch of our new AI Social Media Scheduling feature! 🌟\n\nManaging multiple business channels shouldn't mean endless copy-pasting. With our new unified scheduler, you can write once and publish across all your accounts with tailored tone and media formatting.\n\nClick below to explore the feature and learn more!",
    tiktok: "Schedule all your social posts from ONE dashboard! 📱 Check out our new AI multi-channel publishing engine. Link in bio to test it out! #TechTok #AITools #SocialMediaGrowth"
  });

  // Active Preview Tab
  const [activePreviewPlatform, setActivePreviewPlatform] = useState<string>('linkedin');

  // Account Connect Modal
  const [showChannelModal, setShowChannelModal] = useState<boolean>(false);
  const [newChannelPlatform, setNewChannelPlatform] = useState<string>('twitter');
  const [newChannelHandle, setNewChannelHandle] = useState<string>('');
  const [newChannelName, setNewChannelName] = useState<string>('');
  const [isConnectingChannel, setIsConnectingChannel] = useState<boolean>(false);

  // Posts History & Scheduling Queue
  const [postizPosts, setPostizPosts] = useState<PostizPostResponse[]>([]);
  const [isLoadingPosts, setIsLoadingPosts] = useState<boolean>(false);
  const [isSubmittingPost, setIsSubmittingPost] = useState<boolean>(false);
  const [isDeletingPostId, setIsDeletingPostId] = useState<string | null>(null);

  // Toast Notification
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4500);
  };

  // 1. Fetch connection status
  const checkStatus = async () => {
    setIsLoadingStatus(true);
    try {
      const res = await axios.get('/api/postiz/status', {
        headers: { 'x-user-id': userId }
      });
      setConnectionStatus(res.data);
      await fetchIntegrations();
      await fetchPosts();
    } catch (err: any) {
      console.warn('[Postiz] Failed to fetch status:', err);
    } finally {
      setIsLoadingStatus(false);
    }
  };

  // 2. Fetch connected channels (GET /public/v1/integrations)
  const fetchIntegrations = async () => {
    setIsLoadingIntegrations(true);
    try {
      const res = await axios.get('/api/postiz/integrations', {
        headers: { 'x-user-id': userId }
      });
      if (res.data.integrations) {
        setIntegrations(res.data.integrations);
        // Pre-select channels matching LinkedIn, Instagram, X by default
        const initialSelected = res.data.integrations
          .filter((i: PostizIntegration) => !i.disabled)
          .map((i: PostizIntegration) => i.id);
        setSelectedIntegrationIds(prev => prev.length > 0 ? prev : initialSelected);
      }
    } catch (err: any) {
      if (err.response?.data?.revoked) {
        setConnectionStatus(prev => ({ ...prev, connected: false, status: 'revoked' }));
        showToast('Postiz authorization was revoked. Reconnect your gateway.', 'error');
      }
    } finally {
      setIsLoadingIntegrations(false);
    }
  };

  // 3. Fetch scheduled & published posts (GET /public/v1/posts)
  const fetchPosts = async () => {
    setIsLoadingPosts(true);
    try {
      const res = await axios.get('/api/postiz/posts', {
        headers: { 'x-user-id': userId }
      });
      if (res.data.posts) {
        setPostizPosts(res.data.posts);
      }
    } catch (err: any) {
      console.warn('[Postiz] Failed to fetch posts:', err);
    } finally {
      setIsLoadingPosts(false);
    }
  };

  useEffect(() => {
    checkStatus();

    // Listen for OAuth message
    const handleAuthMessage = (event: MessageEvent) => {
      if (event.data?.type === 'POSTIZ_AUTH_SUCCESS') {
        showToast('Postiz connected successfully via OAuth 2.0!', 'success');
        checkStatus();
      }
    };
    window.addEventListener('message', handleAuthMessage);

    const params = new URLSearchParams(window.location.search);
    if (params.get('postiz_connected') === 'true') {
      showToast('Postiz OAuth connection established!', 'success');
      checkStatus();
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    return () => window.removeEventListener('message', handleAuthMessage);
  }, [userId]);

  // Start OAuth Flow (GET /api/social/postiz/connect)
  const handleStartOAuth = async () => {
    setIsConnecting(true);
    try {
      const redirectUri = `${window.location.origin}/api/social/postiz/callback`;
      const res = await axios.get('/api/social/postiz/connect', {
        headers: { 'x-user-id': userId },
        params: { redirectUri }
      });
      if (res.data.url) {
        const width = 640;
        const height = 750;
        const left = window.screen.width / 2 - width / 2;
        const top = window.screen.height / 2 - height / 2;
        const popup = window.open(
          res.data.url,
          'postiz_oauth',
          `width=${width},height=${height},top=${top},left=${left},status=yes,scrollbars=yes`
        );
        if (!popup || popup.closed || typeof popup.closed === 'undefined') {
          window.location.href = res.data.url;
        }
      }
    } catch (err: any) {
      showToast('OAuth Initiation failed: ' + (err.response?.data?.error || err.message), 'error');
    } finally {
      setIsConnecting(false);
    }
  };

  // Add specific account handle
  const handleConnectChannel = async () => {
    if (!newChannelHandle.trim()) {
      showToast('Please provide an account handle or username', 'error');
      return;
    }
    setIsConnectingChannel(true);
    try {
      const res = await axios.post('/api/postiz/channels/connect', {
        platform: newChannelPlatform,
        handle: newChannelHandle.trim(),
        name: newChannelName.trim() || undefined
      }, {
        headers: { 'x-user-id': userId }
      });
      if (res.data.integrations) {
        setIntegrations(res.data.integrations);
        if (res.data.channel?.id) {
          setSelectedIntegrationIds(prev => Array.from(new Set([...prev, res.data.channel.id])));
        }
      }
      showToast(`Connected ${newChannelPlatform.toUpperCase()} (${newChannelHandle}) successfully!`, 'success');
      setShowChannelModal(false);
      setNewChannelHandle('');
      setNewChannelName('');
      setConnectionStatus(prev => ({ ...prev, connected: true, status: 'active' }));
    } catch (err: any) {
      showToast(err.response?.data?.error || 'Failed to connect account', 'error');
    } finally {
      setIsConnectingChannel(false);
    }
  };

  // Disconnect Channel
  const handleDisconnectChannel = async (channelId: string, channelName: string) => {
    if (!confirm(`Are you sure you want to unlink ${channelName}?`)) return;
    try {
      const res = await axios.delete(`/api/postiz/channels/${channelId}`, {
        headers: { 'x-user-id': userId }
      });
      if (res.data.integrations) {
        setIntegrations(res.data.integrations);
        setSelectedIntegrationIds(prev => prev.filter(id => id !== channelId));
      }
      showToast(`Unlinked ${channelName}`, 'info');
    } catch (err: any) {
      showToast(err.response?.data?.error || 'Failed to disconnect channel', 'error');
    }
  };

  // Toggle integration check
  const toggleIntegration = (id: string) => {
    setSelectedIntegrationIds(prev => 
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  // Media file upload (POST /public/v1/upload)
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 25 * 1024 * 1024) {
      showToast('File size exceeds 25MB limit', 'error');
      return;
    }

    setIsUploadingMedia(true);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await axios.post('/api/postiz/upload', formData, {
        headers: {
          'x-user-id': userId,
          'Content-Type': 'multipart/form-data'
        }
      });
      if (res.data.media) {
        setMediaList(prev => [...prev, res.data.media]);
        showToast(`Uploaded ${res.data.media.name}`, 'success');
      }
    } catch (err: any) {
      showToast('Media upload failed: ' + (err.response?.data?.error || err.message), 'error');
    } finally {
      setIsUploadingMedia(false);
      e.target.value = '';
    }
  };

  // Media upload from URL (POST /public/v1/upload-from-url)
  const handleUrlUpload = async () => {
    if (!urlInput.trim()) return;
    setIsUploadingMedia(true);
    try {
      const res = await axios.post('/api/postiz/upload-from-url', {
        userId,
        url: urlInput.trim()
      });
      if (res.data.media) {
        setMediaList(prev => [...prev, res.data.media]);
        showToast('Media attached from URL', 'success');
        setUrlInput('');
        setShowUrlInput(false);
      }
    } catch (err: any) {
      showToast('Failed to attach URL: ' + (err.response?.data?.error || err.message), 'error');
    } finally {
      setIsUploadingMedia(false);
    }
  };

  const removeMedia = (index: number) => {
    setMediaList(prev => prev.filter((_, i) => i !== index));
  };

  // AI Content Generator: Calls POST /api/postiz/generate-ai-content
  const handleGeneratePreview = async () => {
    const promptToUse = prompt.trim();
    if (!promptToUse) {
      showToast('Please enter an AI prompt description of what you want to publish', 'error');
      return;
    }

    // Determine targeted platforms from selected integrations
    const targetPlatforms = Array.from(new Set(
      selectedIntegrationIds.map(id => {
        const item = integrations.find(i => i.id === id);
        return item ? item.identifier.toLowerCase() : 'twitter';
      })
    ));

    const platformsToPass = targetPlatforms.length > 0 ? targetPlatforms : ['linkedin', 'instagram', 'twitter', 'facebook'];

    setIsGeneratingAi(true);
    try {
      const res = await axios.post('/api/postiz/generate-ai-content', {
        prompt: promptToUse,
        platforms: platformsToPass,
        tone,
        callToAction,
        adaptPerPlatform
      });

      if (res.data?.posts && Array.isArray(res.data.posts)) {
        const newDrafts: Record<string, string> = { ...platformDrafts };
        res.data.posts.forEach((item: { platform: string; content: string }) => {
          const key = item.platform.toLowerCase();
          newDrafts[key] = item.content;
          if (key === 'x') newDrafts['twitter'] = item.content;
          if (key === 'twitter') newDrafts['x'] = item.content;
        });
        setPlatformDrafts(newDrafts);
        showToast('Generated platform-specific social previews!', 'success');
        
        // Auto-select first preview platform
        if (platformsToPass[0]) {
          setActivePreviewPlatform(platformsToPass[0]);
        }
      }
    } catch (err: any) {
      console.warn('[Postiz AI Gen Error]', err);
      showToast('AI Generation completed with fallback templates', 'info');
    } finally {
      setIsGeneratingAi(false);
    }
  };

  // Schedule / Publish Multi-Account Post to Postiz
  const handleSchedulePosts = async () => {
    if (selectedIntegrationIds.length === 0) {
      showToast('Please select at least one social media account', 'error');
      return;
    }

    setIsSubmittingPost(true);
    try {
      // Calculate ISO Date
      const targetDate = publishType === 'now' 
        ? new Date(Date.now() + 5000).toISOString()
        : new Date(`${scheduleDate}T${scheduleTime}:00`).toISOString();

      // Build platform-specific post objects strictly conforming to Postiz API
      const postsPayload = selectedIntegrationIds.map((integrationId) => {
        const integration = integrations.find(i => i.id === integrationId);
        const platformKey = integration ? integration.identifier.toLowerCase() : 'generic';
        
        // Grab tailored copy for this platform or fall back to generic prompt/text
        const tailoredContent = platformDrafts[platformKey] || 
          platformDrafts[platformKey === 'twitter' ? 'x' : platformKey] || 
          directText || 
          prompt;

        return {
          integrationId,
          platform: platformKey,
          content: tailoredContent,
          media: mediaList.map(m => ({ id: m.id, path: m.path })),
          settings: {
            __type: platformKey
          }
        };
      });

      const res = await axios.post('/api/postiz/posts', {
        userId,
        type: publishType,
        date: targetDate,
        timezone,
        posts: postsPayload,
        shortLink: false,
        tags: ['crm_automated_schedule', 'ai_postiz']
      });

      const created = res.data.post;
      showToast(
        publishType === 'now' 
          ? `Broadcast dispatched across ${selectedIntegrationIds.length} social channel(s)!` 
          : (publishType === 'draft' 
              ? 'Drafts saved to Postiz!' 
              : `Successfully scheduled across ${selectedIntegrationIds.length} account(s) for ${scheduleDate} ${scheduleTime} (${timezone})!`),
        'success'
      );

      // Refresh scheduled queue
      await fetchPosts();
      if (onPostCreated && created) {
        onPostCreated(created);
      }
    } catch (err: any) {
      if (err.response?.data?.revoked) {
        setConnectionStatus(prev => ({ ...prev, connected: false, status: 'revoked' }));
        showToast('Postiz authorization revoked. Please reconnect.', 'error');
      } else {
        showToast(err.response?.data?.error || 'Failed to dispatch post to Postiz', 'error');
      }
    } finally {
      setIsSubmittingPost(false);
    }
  };

  // Cancel / Delete a Scheduled Post (DELETE /public/v1/posts/:id)
  const handleDeletePost = async (postId: string) => {
    if (!confirm('Are you sure you want to cancel this scheduled post on Postiz?')) return;
    setIsDeletingPostId(postId);
    try {
      await axios.delete(`/api/postiz/posts/${postId}`, {
        headers: { 'x-user-id': userId }
      });
      showToast('Scheduled post cancelled and removed from Postiz', 'success');
      setPostizPosts(prev => prev.filter(p => p.id !== postId));
    } catch (err: any) {
      showToast(err.response?.data?.error || 'Failed to cancel post', 'error');
    } finally {
      setIsDeletingPostId(null);
    }
  };

  // Helper badge for platform icon
  const renderPlatformBadge = (identifier: string) => {
    const id = identifier.toLowerCase();
    if (id.includes('twitter') || id.includes('x')) {
      return <span className="font-mono font-bold text-xs bg-black text-white px-1.5 py-0.5 rounded">𝕏</span>;
    }
    if (id.includes('linkedin')) {
      return <Linkedin className="h-4 w-4 text-[#0A66C2] fill-current" />;
    }
    if (id.includes('instagram')) {
      return <Instagram className="h-4 w-4 text-pink-500" />;
    }
    if (id.includes('facebook')) {
      return <Facebook className="h-4 w-4 text-blue-600 fill-current" />;
    }
    if (id.includes('tiktok')) {
      return <span className="font-bold text-[10px] bg-black text-cyan-400 px-1 py-0.5 rounded">TikTok</span>;
    }
    if (id.includes('youtube')) {
      return <Video className="h-4 w-4 text-red-600" />;
    }
    return <Globe className="h-4 w-4 text-indigo-500" />;
  };

  return (
    <div className="space-y-6">
      {/* Toast Alert */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 flex items-center gap-2.5 px-4 py-3 rounded-xl shadow-2xl border text-xs font-semibold transition-all animate-in fade-in slide-in-from-top-2 ${
          toast.type === 'success' 
            ? 'bg-emerald-950/95 border-emerald-500/50 text-emerald-100'
            : (toast.type === 'error' ? 'bg-rose-950/95 border-rose-500/50 text-rose-100' : 'bg-slate-900 border-slate-700 text-slate-100')
        }`}>
          {toast.type === 'success' && <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />}
          {toast.type === 'error' && <AlertTriangle className="h-4 w-4 text-rose-400 shrink-0" />}
          {toast.type === 'info' && <Info className="h-4 w-4 text-blue-400 shrink-0" />}
          <span>{toast.message}</span>
        </div>
      )}

      {/* 1. TOP STATUS & GATEWAY HEADER */}
      <div className="bg-slate-900/95 border border-slate-800 rounded-2xl p-5 sm:p-6 shadow-md">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2.5">
              <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-indigo-500 via-purple-600 to-pink-500 flex items-center justify-center text-white shadow-lg">
                <Share2 className="h-5 w-5" />
              </div>
              <div>
                <div className="flex items-center gap-2.5 flex-wrap">
                  <h2 className="text-base sm:text-lg font-bold text-slate-100">
                    Postiz Multi-Channel Social Hub
                  </h2>
                  {connectionStatus.connected ? (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      OAuth 2.0 Active
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-500/10 border border-amber-500/30 text-amber-400">
                      <AlertCircle className="h-3 w-3" />
                      Ready to Authorize
                    </span>
                  )}
                  <span className="text-[11px] font-mono text-slate-400 px-2 py-0.5 rounded-md bg-slate-800/80 border border-slate-700/60">
                    {integrations.length} Channel(s)
                  </span>
                </div>
                <p className="text-xs text-slate-400 font-normal">
                  CRM → Postiz OAuth → user's connected social accounts → scheduler UI → Postiz API → social networks
                </p>
              </div>
            </div>
          </div>

          {/* Header Action Buttons */}
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={handleStartOAuth}
              disabled={isConnecting}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 active:scale-98 text-white text-xs font-bold shadow-md shadow-indigo-500/20 transition-all cursor-pointer"
            >
              <Share2 className="h-3.5 w-3.5" />
              <span>{connectionStatus.connected ? 'Re-authorize OAuth' : 'Connect Social Accounts'}</span>
              <ExternalLink className="h-3 w-3 opacity-70" />
            </button>

            <button
              type="button"
              onClick={() => setShowChannelModal(true)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200 transition-all cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5 text-indigo-400" />
              <span>Add Channel</span>
            </button>

            <button
              type="button"
              onClick={fetchIntegrations}
              disabled={isLoadingIntegrations}
              className="p-2 rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-300 transition-all cursor-pointer"
              title="Sync Integrations"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isLoadingIntegrations ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      </div>

      {/* 2. THE MASTER SCHEDULER & COMPOSER */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* LEFT COLUMN: Post Composer & Settings */}
        <div className="lg:col-span-7 space-y-6">
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 sm:p-6 shadow-md space-y-5">
            
            {/* Header */}
            <div className="border-b border-slate-800 pb-4">
              <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
                <Wand2 className="h-4 w-4 text-indigo-400" />
                <span>Create Social Post</span>
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                What do you want to say? Provide an AI prompt or write manually.
              </p>
            </div>

            {/* Prompt Input Area */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5 text-indigo-400" />
                  <span>Prompt:</span>
                </label>
                <div className="flex items-center gap-1.5 text-[11px]">
                  <span className="text-slate-400">Tone:</span>
                  <select
                    value={tone}
                    onChange={(e) => setTone(e.target.value)}
                    className="bg-slate-800 text-slate-200 border border-slate-700 rounded-md px-2 py-0.5 text-[11px] focus:outline-none"
                  >
                    <option value="Professional">Professional</option>
                    <option value="Exciting">Exciting & Engaging</option>
                    <option value="Concise">Concise & Punchy</option>
                    <option value="Thought Leadership">Thought Leadership</option>
                    <option value="Casual">Casual & Friendly</option>
                  </select>
                </div>
              </div>

              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Announce our new AI scheduling feature. Make it professional but exciting. Mention that customers can schedule across multiple social networks from one dashboard..."
                rows={4}
                className="w-full bg-slate-950/80 border border-slate-800 focus:border-indigo-500 rounded-xl p-3.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none transition-all leading-relaxed"
              />

              {/* Quick Prompt Idea Chips */}
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">Example Prompts:</span>
                {PREFILL_PROMPTS.map((samplePrompt, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setPrompt(samplePrompt)}
                    className="text-[10px] bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white px-2 py-1 rounded-lg border border-slate-700/60 truncate max-w-[200px] cursor-pointer transition-colors"
                    title={samplePrompt}
                  >
                    {samplePrompt.slice(0, 32)}...
                  </button>
                ))}
              </div>
            </div>

            {/* Target Accounts Multi-Selection */}
            <div className="space-y-2 pt-2 border-t border-slate-800">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                  <Layers className="h-3.5 w-3.5 text-indigo-400" />
                  <span>Accounts:</span>
                </label>
                <div className="flex items-center gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => setSelectedIntegrationIds(integrations.map(i => i.id))}
                    className="text-indigo-400 hover:text-indigo-300 font-medium cursor-pointer"
                  >
                    Select All
                  </button>
                  <span className="text-slate-600">•</span>
                  <button
                    type="button"
                    onClick={() => setSelectedIntegrationIds([])}
                    className="text-slate-400 hover:text-slate-300 font-medium cursor-pointer"
                  >
                    Clear
                  </button>
                </div>
              </div>

              {/* Accounts Checkbox List */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {integrations.map((item) => {
                  const isChecked = selectedIntegrationIds.includes(item.id);
                  return (
                    <div
                      key={item.id}
                      onClick={() => toggleIntegration(item.id)}
                      className={`p-2.5 rounded-xl border flex items-center gap-3 transition-all cursor-pointer ${
                        isChecked 
                          ? 'border-indigo-500/60 bg-indigo-500/10 shadow-xs' 
                          : 'border-slate-800 bg-slate-950/40 hover:border-slate-700 text-slate-400'
                      }`}
                    >
                      <div className="text-indigo-400">
                        {isChecked ? <CheckSquare className="h-4 w-4 text-indigo-400" /> : <Square className="h-4 w-4 text-slate-600" />}
                      </div>

                      {item.picture ? (
                        <img 
                          src={item.picture} 
                          alt={item.name} 
                          className="h-7 w-7 rounded-full object-cover border border-slate-700 shrink-0" 
                        />
                      ) : (
                        <div className="h-7 w-7 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-[10px] font-bold text-slate-300 shrink-0">
                          {item.name.charAt(0)}
                        </div>
                      )}

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className={`text-xs font-bold truncate ${isChecked ? 'text-slate-100' : 'text-slate-300'}`}>
                            {item.name}
                          </span>
                          {renderPlatformBadge(item.identifier)}
                        </div>
                        <p className="text-[10px] text-slate-400 truncate">
                          {item.profile || `@${item.identifier}`}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Media Upload Area */}
            <div className="space-y-2 pt-2 border-t border-slate-800">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                  <ImageIcon className="h-3.5 w-3.5 text-indigo-400" />
                  <span>Media:</span>
                </label>
                
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1 px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium cursor-pointer border border-slate-700 text-xs transition-colors">
                    <Plus className="h-3 w-3" />
                    <span>Upload image/video</span>
                    <input
                      type="file"
                      accept="image/*,video/*"
                      onChange={handleFileUpload}
                      disabled={isUploadingMedia}
                      className="hidden"
                    />
                  </label>

                  <button
                    type="button"
                    onClick={() => setShowUrlInput(!showUrlInput)}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium border border-slate-700 text-xs cursor-pointer transition-colors"
                  >
                    <LinkIcon className="h-3 w-3" />
                    <span>Attach URL</span>
                  </button>
                </div>
              </div>

              {/* URL Input Bar */}
              {showUrlInput && (
                <div className="flex items-center gap-2 p-2 rounded-xl bg-slate-950 border border-slate-800">
                  <input
                    type="url"
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
                    placeholder="https://example.com/asset.jpg"
                    className="flex-1 bg-transparent border-none text-xs text-slate-200 focus:outline-none px-2"
                  />
                  <button
                    type="button"
                    onClick={handleUrlUpload}
                    disabled={isUploadingMedia || !urlInput.trim()}
                    className="px-3 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    {isUploadingMedia ? 'Attaching...' : 'Attach'}
                  </button>
                </div>
              )}

              {/* Media Thumbnails */}
              {mediaList.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {mediaList.map((m, idx) => (
                    <div 
                      key={m.id || idx} 
                      className="relative group h-20 w-28 rounded-xl overflow-hidden border border-slate-700 bg-slate-950"
                    >
                      <img 
                        src={m.path} 
                        alt={m.name || 'Attachment'} 
                        className="h-full w-full object-cover" 
                      />
                      <button
                        type="button"
                        onClick={() => removeMedia(idx)}
                        className="absolute top-1 right-1 h-5 w-5 rounded-full bg-rose-600/90 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer shadow-sm"
                        title="Remove media"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Schedule Date, Time, Timezone */}
            <div className="space-y-3 pt-2 border-t border-slate-800">
              <label className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5 text-indigo-400" />
                <span>Schedule:</span>
              </label>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <span className="text-[11px] text-slate-400 block mb-1">Date:</span>
                  <input
                    type="date"
                    value={scheduleDate}
                    onChange={(e) => setScheduleDate(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 font-mono"
                  />
                </div>

                <div>
                  <span className="text-[11px] text-slate-400 block mb-1">Time:</span>
                  <input
                    type="time"
                    value={scheduleTime}
                    onChange={(e) => setScheduleTime(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 font-mono"
                  />
                </div>

                <div>
                  <span className="text-[11px] text-slate-400 block mb-1">Timezone:</span>
                  <select
                    value={timezone}
                    onChange={(e) => setTimezone(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                  >
                    {COMMON_TIMEZONES.map(tz => (
                      <option key={tz.id} value={tz.id}>{tz.label}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* AI Options */}
            <div className="space-y-3 pt-2 border-t border-slate-800 bg-slate-950/50 p-4 rounded-xl border border-slate-800/80">
              <label className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                <Sliders className="h-3.5 w-3.5 text-indigo-400" />
                <span>AI options:</span>
              </label>

              <div className="space-y-3">
                {/* Adapt content per platform checkbox */}
                <label className="flex items-center gap-2 text-xs text-slate-200 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={adaptPerPlatform}
                    onChange={(e) => setAdaptPerPlatform(e.target.checked)}
                    className="rounded border-slate-700 text-indigo-600 focus:ring-0 h-4 w-4 bg-slate-900"
                  />
                  <span className="font-semibold">Adapt content for each platform</span>
                </label>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <div>
                    <span className="text-[11px] text-slate-400 block mb-1">Tone:</span>
                    <input
                      type="text"
                      value={tone}
                      onChange={(e) => setTone(e.target.value)}
                      placeholder="Professional"
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                    />
                  </div>

                  <div>
                    <span className="text-[11px] text-slate-400 block mb-1">Call to action:</span>
                    <input
                      type="text"
                      value={callToAction}
                      onChange={(e) => setCallToAction(e.target.value)}
                      placeholder="Learn more"
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                </div>
              </div>

              {/* Generate Preview Button */}
              <button
                type="button"
                onClick={handleGeneratePreview}
                disabled={isGeneratingAi || !prompt.trim()}
                className="w-full mt-2 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 active:scale-98 text-white font-bold text-xs shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {isGeneratingAi ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin text-white" />
                    <span>Generating Platform Previews with AI...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" />
                    <span>Generate Preview</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: Previews & Schedule Posts Action */}
        <div className="lg:col-span-5 space-y-6">
          
          {/* Live Platform Previews Card */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 sm:p-6 shadow-md space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                <Eye className="h-4 w-4 text-indigo-400" />
                <span>Generated Platform Previews</span>
              </h3>
              <span className="text-[11px] text-slate-400 font-mono">
                {selectedIntegrationIds.length} Accounts Targeted
              </span>
            </div>

            {/* Platform Tab Switcher */}
            <div className="flex flex-wrap items-center gap-1.5 bg-slate-950 p-1.5 rounded-xl border border-slate-800">
              {[
                { id: 'linkedin', label: 'LinkedIn', icon: 'in' },
                { id: 'instagram', label: 'Instagram', icon: 'IG' },
                { id: 'twitter', label: 'X (Twitter)', icon: '𝕏' },
                { id: 'facebook', label: 'Facebook', icon: 'fb' },
                { id: 'tiktok', label: 'TikTok', icon: 'TT' }
              ].map(p => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setActivePreviewPlatform(p.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                    activePreviewPlatform === p.id 
                      ? 'bg-indigo-600 text-white shadow-xs' 
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                  }`}
                >
                  <span>{p.icon}</span>
                  <span>{p.label}</span>
                </button>
              ))}
            </div>

            {/* The Active Platform Preview Box */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-bold text-slate-200 capitalize">
                    {activePreviewPlatform} Preview
                  </span>
                  {renderPlatformBadge(activePreviewPlatform)}
                </div>
                <span className="text-[10px] text-slate-400 font-mono">
                  {platformDrafts[activePreviewPlatform]?.length || 0} chars
                </span>
              </div>

              {/* Editable Preview Content */}
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-3 shadow-inner">
                <div className="flex items-center gap-2.5">
                  <div className="h-8 w-8 rounded-full bg-gradient-to-tr from-indigo-500 to-purple-600 flex items-center justify-center font-bold text-white text-xs">
                    AC
                  </div>
                  <div>
                    <span className="text-xs font-bold text-slate-200 block">Acme Company</span>
                    <span className="text-[10px] text-slate-400 font-mono">
                      Scheduled for {scheduleDate} at {scheduleTime} ({timezone})
                    </span>
                  </div>
                </div>

                {/* Editable Text for Platform */}
                <textarea
                  value={platformDrafts[activePreviewPlatform] || ''}
                  onChange={(e) => {
                    const val = e.target.value;
                    setPlatformDrafts(prev => ({
                      ...prev,
                      [activePreviewPlatform]: val,
                      ...(activePreviewPlatform === 'twitter' ? { x: val } : {}),
                      ...(activePreviewPlatform === 'x' ? { twitter: val } : {})
                    }));
                  }}
                  rows={6}
                  className="w-full bg-slate-900/60 border border-slate-800 rounded-lg p-3 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500 font-normal leading-relaxed resize-y"
                  placeholder={`Write or tweak your tailored ${activePreviewPlatform} copy...`}
                />

                {/* Media Preview in Feed */}
                {mediaList.length > 0 && (
                  <div className="rounded-lg overflow-hidden border border-slate-800">
                    <img 
                      src={mediaList[0].path} 
                      alt="Attachment Preview" 
                      className="w-full aspect-video object-cover" 
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Scheduling Type Option Buttons */}
            <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setPublishType('schedule')}
                className={`py-2 px-2 rounded-xl text-xs font-semibold flex items-center justify-center gap-1 cursor-pointer transition-all ${
                  publishType === 'schedule' 
                    ? 'bg-indigo-600 text-white border border-indigo-500 shadow-xs' 
                    : 'bg-slate-800 text-slate-300 border border-slate-700'
                }`}
              >
                <Calendar className="h-3.5 w-3.5" />
                <span>Schedule</span>
              </button>

              <button
                type="button"
                onClick={() => setPublishType('now')}
                className={`py-2 px-2 rounded-xl text-xs font-semibold flex items-center justify-center gap-1 cursor-pointer transition-all ${
                  publishType === 'now' 
                    ? 'bg-indigo-600 text-white border border-indigo-500 shadow-xs' 
                    : 'bg-slate-800 text-slate-300 border border-slate-700'
                }`}
              >
                <Send className="h-3.5 w-3.5" />
                <span>Publish Now</span>
              </button>

              <button
                type="button"
                onClick={() => setPublishType('draft')}
                className={`py-2 px-2 rounded-xl text-xs font-semibold flex items-center justify-center gap-1 cursor-pointer transition-all ${
                  publishType === 'draft' 
                    ? 'bg-indigo-600 text-white border border-indigo-500 shadow-xs' 
                    : 'bg-slate-800 text-slate-300 border border-slate-700'
                }`}
              >
                <FileText className="h-3.5 w-3.5" />
                <span>Save Draft</span>
              </button>
            </div>

            {/* Primary Action Button */}
            <button
              type="button"
              onClick={handleSchedulePosts}
              disabled={isSubmittingPost || selectedIntegrationIds.length === 0}
              className="w-full py-3.5 rounded-xl bg-gradient-to-r from-emerald-600 via-teal-600 to-indigo-600 hover:from-emerald-500 hover:to-indigo-500 active:scale-98 text-white font-bold text-sm shadow-lg transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-40"
            >
              {isSubmittingPost ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin text-white" />
                  <span>Dispatching to Postiz API...</span>
                </>
              ) : (
                <>
                  <CheckCheck className="h-4 w-4" />
                  <span>
                    {publishType === 'now' 
                      ? `Publish to ${selectedIntegrationIds.length} Channel(s) Now` 
                      : (publishType === 'draft' ? 'Save Drafts to Postiz' : `Schedule Posts across ${selectedIntegrationIds.length} Accounts`)}
                  </span>
                </>
              )}
            </button>
          </div>

          {/* Scheduled Posts Queue View */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-md space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h4 className="text-xs font-bold text-slate-100 flex items-center gap-2">
                  <Clock className="h-3.5 w-3.5 text-indigo-400" />
                  <span>Scheduled Posts Queue ({postizPosts.length})</span>
                </h4>
                <p className="text-[10px] text-slate-400">
                  Track scheduling status & delete posts via Postiz API
                </p>
              </div>
              <button
                type="button"
                onClick={fetchPosts}
                disabled={isLoadingPosts}
                className="p-1 rounded-lg border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700 transition-colors"
                title="Refresh Postiz Queue"
              >
                <RefreshCw className={`h-3 w-3 ${isLoadingPosts ? 'animate-spin' : ''}`} />
              </button>
            </div>

            {isLoadingPosts ? (
              <div className="py-6 text-center text-xs text-slate-400 flex items-center justify-center gap-2">
                <RefreshCw className="h-4 w-4 animate-spin text-indigo-400" />
                <span>Loading scheduled posts...</span>
              </div>
            ) : postizPosts.length === 0 ? (
              <div className="py-6 text-center text-slate-500 text-xs">
                No active scheduled posts yet. Compose and schedule above!
              </div>
            ) : (
              <div className="space-y-2.5 max-h-80 overflow-y-auto pr-1">
                {postizPosts.map((post) => {
                  const firstVal = post.posts?.[0]?.value?.[0];
                  const previewText = firstVal?.content || 'Social Post';
                  const isDeleting = isDeletingPostId === post.id;

                  return (
                    <div
                      key={post.id}
                      className="p-3 rounded-xl border border-slate-800 bg-slate-950/70 space-y-2 hover:border-slate-700 transition-all"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${
                            post.status === 'published'
                              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                              : (post.status === 'draft' 
                                  ? 'bg-amber-500/10 border-amber-500/30 text-amber-400' 
                                  : 'bg-indigo-500/10 border-indigo-500/30 text-indigo-400')
                          }`}>
                            {post.status || post.type}
                          </span>
                          <span className="text-[10px] text-slate-400 font-mono">
                            {new Date(post.date).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>

                        {post.status !== 'published' && (
                          <button
                            type="button"
                            onClick={() => handleDeletePost(post.id)}
                            disabled={isDeleting}
                            className="p-1 rounded-lg text-rose-400 hover:text-rose-300 hover:bg-rose-950/40 transition-colors cursor-pointer"
                            title="Cancel / Delete scheduled post on Postiz"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>

                      <p className="text-xs text-slate-200 line-clamp-2 leading-relaxed">
                        {previewText}
                      </p>

                      <div className="flex items-center justify-between text-[10px] text-slate-400 pt-1 border-t border-slate-800/80">
                        <span>Postiz ID: <code className="text-slate-300 font-mono">{post.id.slice(0, 12)}...</code></span>
                        <span>{post.posts?.length || 1} destination(s)</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

        </div>
      </div>

      {/* Account Login / Channel Modal */}
      {showChannelModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl animate-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-lg bg-indigo-600 flex items-center justify-center text-white font-bold">
                  +
                </div>
                <div>
                  <h4 className="text-sm font-bold text-slate-100">Connect Social Account</h4>
                  <p className="text-[11px] text-slate-400">Register a channel to your Postiz workspace</p>
                </div>
              </div>
              <button
                onClick={() => setShowChannelModal(false)}
                className="text-slate-400 hover:text-slate-200 p-1 rounded-lg"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">Platform:</label>
                <select
                  value={newChannelPlatform}
                  onChange={(e) => setNewChannelPlatform(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                >
                  <option value="twitter">X (Twitter)</option>
                  <option value="linkedin">LinkedIn</option>
                  <option value="instagram">Instagram</option>
                  <option value="facebook">Facebook</option>
                  <option value="tiktok">TikTok</option>
                  <option value="youtube">YouTube</option>
                  <option value="pinterest">Pinterest</option>
                  <option value="reddit">Reddit</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">Handle / Username:</label>
                <input
                  type="text"
                  value={newChannelHandle}
                  onChange={(e) => setNewChannelHandle(e.target.value)}
                  placeholder="@company_handle"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 font-mono"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">Display Name (Optional):</label>
                <input
                  type="text"
                  value={newChannelName}
                  onChange={(e) => setNewChannelName(e.target.value)}
                  placeholder="Acme Official"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShowChannelModal(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-300 hover:bg-slate-800 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConnectChannel}
                disabled={isConnectingChannel || !newChannelHandle.trim()}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white transition-colors disabled:opacity-50 cursor-pointer"
              >
                {isConnectingChannel ? 'Connecting...' : 'Save & Link Channel'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
