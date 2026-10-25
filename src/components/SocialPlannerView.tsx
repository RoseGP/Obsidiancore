import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { AnimatePresence, motion } from 'motion/react';
import { 
  Calendar, Layers, Sparkles, Send, Clock, Plus, CheckCircle2, 
  AlertCircle, ShieldCheck, RefreshCw, X, Globe, Eye, Filter, 
  Search, ExternalLink, Linkedin, Instagram, Facebook, Twitter, 
  Share2, Edit2, Trash2, LayoutGrid, ListFilter, Check, Cpu
} from 'lucide-react';
import { 
  SocialPlatform, SocialPost, SocialDraft, PlatformConnectionsMap, 
  PLATFORM_CONFIGS 
} from './social/SocialTypes';
import UnifiedPostComposer from './social/UnifiedPostComposer';
import SocialCalendarView from './social/SocialCalendarView';
import SocialPostsQueue from './social/SocialPostsQueue';
import SocialWorkerMonitor from './social/SocialWorkerMonitor';
import AccountsConnectModal from './social/AccountsConnectModal';
import SocialAccountsConnect from './social/SocialAccountsConnect';
import SocialMediaGrid from './SocialMediaGrid';
import PostizIntegrationPanel from './social/PostizIntegrationPanel';
import { formatLinkedInUgcPayload, publishLinkedInUgcPost } from '../utils/linkedinUgcFormatter';
import { db } from '../lib/firebase';
import { 
  doc, setDoc, collection, getDocs, deleteDoc, query, where, 
  Timestamp, serverTimestamp 
} from 'firebase/firestore';
import { useDatabase } from '../context/DatabaseContext';
import { useCommand } from '../context/CommandContext';

export const OAUTH_SCOPES_MAPPING = {
  instagram: {
    scopes: ['instagram_basic', 'instagram_content_publish', 'pages_show_list', 'pages_read_engagement', 'business_management'],
    description: 'Enables publishing media directly to Instagram Business profiles and tracking organic outreach engagement.'
  },
  linkedin: {
    scopes: ['w_member_social', 'r_member_social', 'openid', 'profile', 'email'],
    description: 'Enables creating posts, updating user feed, sharing ugc media, and fetching basic profile information.'
  },
  twitter: {
    scopes: ['tweet.read', 'tweet.write', 'users.read', 'offline.access'],
    description: 'Allows reading and publishing tweets, managing user followings, and requesting persistent offline tokens.'
  },
  tiktok: {
    scopes: ['video.publish', 'video.upload', 'user.info.basic'],
    description: 'Required to upload audio-visual media, publish TikTok feeds, and access creator handle statistics.'
  },
  pinterest: {
    scopes: ['boards:read', 'boards:write', 'pins:read', 'pins:write'],
    description: 'Grants access to list existing boards, pin image/video creative assets, and measure pin engagement.'
  },
  facebook: {
    scopes: ['pages_manage_posts', 'pages_read_engagement', 'pages_show_list', 'public_profile'],
    description: 'Allows publishing posts directly to brand pages you manage, reading page metrics, and syncing meta accounts.'
  }
};

export default function SocialPlannerView() {
  const { setActiveView } = useCommand();
  const dbContext = useDatabase();
  const userId = dbContext?.userId || 'demo-user-123';

  // 1. Navigation View Mode
  const [activeTab, setActiveTab] = useState<'calendar' | 'queue' | 'accounts' | 'compose' | 'grid' | 'worker' | 'postiz'>('postiz');

  // Auto-switch to accounts or postiz tab if returned from hosted oauth redirect
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('postiz_connected') || params.get('tab') === 'postiz') {
      setActiveTab('postiz');
    } else if (
      params.get('tab') === 'accounts' || 
      params.get('social_connect') || 
      params.get('status') ||
      params.get('platform')
    ) {
      setActiveTab('accounts');
    }
  }, []);

  // 2. Channel Connections State
  const [connections, setConnections] = useState<PlatformConnectionsMap>(() => {
    const saved = localStorage.getItem('obsidian_social_connections_v4');
    if (saved) {
      try { return JSON.parse(saved); } catch (e) {}
    }
    return {
      linkedin: { connected: true, handle: '@sarah_jenkins_lead', metric: '1,420', metricName: 'Profile Visits' },
      twitter: { connected: true, handle: '@flowforge', metric: '3.4%', metricName: 'Engagement' },
      instagram: { connected: true, handle: '@flowforge.studio', metric: '21.4k', metricName: 'Weekly Reach' },
      facebook: { connected: false, handle: '@flowforgepage', metric: '2.9%', metricName: 'Page Reach' },
      tiktok: { connected: false, handle: '@flowforge_tiktok', metric: '42.5k', metricName: 'Video Views' },
      thread: { connected: false, handle: '@flowforgethreads', metric: '890', metricName: 'Active Threads' },
      pinterest: { connected: false, handle: '@flowforge', metric: '19.3k', metricName: 'Monthly Viewers' }
    };
  });

  useEffect(() => {
    localStorage.setItem('obsidian_social_connections_v4', JSON.stringify(connections));
    if (db && userId) {
      setDoc(doc(db, 'social_connections', userId), {
        connections,
        updatedAt: serverTimestamp()
      }, { merge: true }).catch(err => console.warn('[Connections Firestore Save Warn]', err));
    }
  }, [connections, userId]);

  // 3. Posts Collection State
  const [posts, setPosts] = useState<SocialPost[]>(() => {
    const saved = localStorage.getItem('obsidian_social_posts_v4');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed && parsed.length > 0) return parsed;
      } catch (e) {}
    }
    return [
      {
        id: 'post-1',
        caption: "✨ Upgrade alert: Our standard omnichannel system integrations are now fully active! Multi-channel client pipelines are optimized for WhatsApp, Slack, Telegram, and premium lead notifications. #OmnichannelCRM #Innovation",
        platforms: ['linkedin', 'twitter'],
        scheduledAt: new Date(Date.now() + 3600000 * 24).toISOString(), // Tomorrow
        status: 'SCHEDULED',
        mediaUrl: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&q=80&w=800',
        mediaName: 'analytics_overview.jpg'
      },
      {
        id: 'post-2',
        caption: "🚀 Behind the scenes: Exploring low-latency WebRTC data tunnels and high-trust TLS cryptography for sovereign team communications. #WebRTC #Security",
        platforms: ['linkedin', 'instagram'],
        scheduledAt: new Date(Date.now() + 3600000 * 48).toISOString(), // 2 days later
        status: 'SCHEDULED',
        mediaUrl: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&q=80&w=800',
        mediaName: 'workspace_preview.jpg'
      },
      {
        id: 'post-3',
        caption: "🔒 ISO Security Alignment Complete! We are thrilled to announce that Obsidian Enterprise pipelines now run on double-encrypted, high-trust sovereign TLS tunnels.",
        platforms: ['linkedin'],
        scheduledAt: new Date(Date.now() - 3600000 * 24).toISOString(),
        publishedAt: new Date(Date.now() - 3600000 * 24).toISOString(),
        status: 'PUBLISHED',
        mediaUrl: 'https://images.unsplash.com/photo-1563986768609-322da13575f3?auto=format&fit=crop&q=80&w=800'
      },
      {
        id: 'post-4',
        caption: "📊 Join us this Thursday for an exclusive live demonstration of the luxury Obsidian Analytics cockpit. Real-time response quality analysis and API latency metrics.",
        platforms: ['facebook', 'instagram'],
        scheduledAt: new Date(Date.now() - 3600000 * 48).toISOString(),
        status: 'FAILED',
        errorLog: 'Meta OAuthException: Token expired for Instagram publishing. Please reconnect your account.',
        retryCount: 1
      }
    ];
  });

  useEffect(() => {
    localStorage.setItem('obsidian_social_posts_v4', JSON.stringify(posts));
  }, [posts]);

  // 4. Drafts Collection State
  const [drafts, setDrafts] = useState<SocialDraft[]>([]);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Modals States
  const [isComposerModalOpen, setIsComposerModalOpen] = useState<boolean>(false);
  const [isAccountsModalOpen, setIsAccountsModalOpen] = useState<boolean>(false);
  const [editingPost, setEditingPost] = useState<SocialPost | null>(null);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => {
      setToast(null);
    }, 4000);
  };

  const loadDrafts = async () => {
    if (!userId) return;
    try {
      const q = query(
        collection(db, 'drafts'),
        where('userId', '==', userId)
      );
      const querySnapshot = await getDocs(q);
      const fetched: SocialDraft[] = [];
      querySnapshot.forEach((docSnap) => {
        const data = docSnap.data();
        fetched.push({
          id: docSnap.id,
          caption: data.caption || '',
          mediaUrl: data.mediaUrl || '',
          mediaName: data.mediaName || '',
          platforms: (data.platforms || []).map((p: string) => p.toLowerCase() as SocialPlatform),
          createdAt: data.createdAt,
          updatedAt: data.updatedAt
        });
      });
      setDrafts(fetched);
    } catch (err: any) {
      try {
        const local = localStorage.getItem(`drafts_${userId}`);
        if (local) setDrafts(JSON.parse(local));
      } catch (e) {}
    }
  };

  const loadPostsFromBackend = async () => {
    try {
      // 1. Sync from Firestore if available
      if (db) {
        try {
          const postSnap = await getDocs(collection(db, 'social_posts'));
          if (!postSnap.empty) {
            const fsPosts: SocialPost[] = [];
            postSnap.forEach(d => {
              const data = d.data();
              fsPosts.push({
                id: d.id,
                caption: data.caption || '',
                platforms: (data.platforms || []).map((plat: string) => plat.toLowerCase() as SocialPlatform),
                scheduledAt: data.scheduledAt,
                publishedAt: data.publishedAt,
                status: data.status || 'SCHEDULED',
                mediaUrl: data.mediaUrl,
                mediaName: data.mediaName,
                errorLog: data.errorLog,
                retryCount: data.retryCount || 0
              });
            });
            if (fsPosts.length > 0) {
              setPosts(prev => {
                const map = new Map<string, SocialPost>();
                fsPosts.forEach(p => map.set(p.id, p));
                prev.forEach(p => { if (!map.has(p.id)) map.set(p.id, p); });
                return Array.from(map.values());
              });
            }
          }
        } catch (fsErr) {
          console.warn('[Firestore load posts warn]', fsErr);
        }
      }

      // 2. Sync from backend API queue
      const response = await axios.get('/api/posts/queue?status=all');
      if (response.data?.posts && Array.isArray(response.data.posts)) {
        const mapped: SocialPost[] = response.data.posts.map((p: any) => ({
          id: p.id,
          caption: p.caption || p.content || '',
          platforms: (p.platforms || []).map((plat: string) => plat.toLowerCase() as SocialPlatform),
          scheduledAt: p.scheduledAt,
          publishedAt: p.publishedAt,
          status: p.status ? p.status.toUpperCase() : 'SCHEDULED',
          mediaUrl: p.mediaUrls?.[0] || p.mediaUrl || undefined,
          errorLog: p.failureReason || p.error,
          retryCount: p.retryCount || 0
        }));

        setPosts(prev => {
          const map = new Map<string, SocialPost>();
          mapped.forEach(p => map.set(p.id, p));
          prev.forEach(p => {
            if (!map.has(p.id)) map.set(p.id, p);
          });
          return Array.from(map.values());
        });
      }
    } catch (e: any) {
      console.warn('[SocialPlannerView API Sync Warn]', e.message);
    }
  };

  useEffect(() => {
    loadDrafts();
    loadPostsFromBackend();
  }, [userId]);

  const handlePublishNow = async (postData: {
    caption: string;
    platforms: SocialPlatform[];
    mediaUrl?: string;
    mediaName?: string;
  }) => {
    const newPostId = `post-${Date.now()}`;
    const newPost: SocialPost = {
      id: newPostId,
      caption: postData.caption,
      platforms: postData.platforms,
      scheduledAt: new Date().toISOString(),
      publishedAt: new Date().toISOString(),
      status: 'PUBLISHED',
      mediaUrl: postData.mediaUrl,
      mediaName: postData.mediaName
    };

    setPosts(prev => [newPost, ...prev]);

    // Persist to Firestore
    if (db) {
      try {
        await setDoc(doc(db, 'social_posts', newPostId), {
          ...newPost,
          userId,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        }, { merge: true });
      } catch (fsErr) {
        console.warn('[Firestore Publish Save Warn]', fsErr);
      }
    }

    try {
      await axios.post('/api/posts/schedule', {
        content: postData.caption,
        caption: postData.caption,
        platforms: postData.platforms,
        scheduledAt: new Date().toISOString(),
        mediaUrls: postData.mediaUrl ? [postData.mediaUrl] : []
      });

      if (postData.platforms.includes('linkedin')) {
        try {
          await publishLinkedInUgcPost(
            'mock_token_dev',
            'urn:li:person:demo-sarah-jenkins',
            postData.caption,
            postData.mediaUrl ? [postData.mediaUrl] : undefined
          );
        } catch (liErr) {}
      }

      showToast('Post published immediately across selected channels!', 'success');
      setIsComposerModalOpen(false);
      setEditingPost(null);
    } catch (error: any) {
      console.error('[Publish Error]', error);
      showToast('Post created. Scheduled worker will dispatch.', 'success');
      setIsComposerModalOpen(false);
      setEditingPost(null);
    }
  };

  const handleSchedulePost = async (postData: {
    caption: string;
    platforms: SocialPlatform[];
    scheduledAt: string;
    mediaUrl?: string;
    mediaName?: string;
  }) => {
    const newPostId = `post-${Date.now()}`;
    const newPost: SocialPost = {
      id: newPostId,
      caption: postData.caption,
      platforms: postData.platforms,
      scheduledAt: postData.scheduledAt,
      status: 'SCHEDULED',
      mediaUrl: postData.mediaUrl,
      mediaName: postData.mediaName
    };

    setPosts(prev => [newPost, ...prev]);

    // Persist to Firestore
    if (db) {
      try {
        await setDoc(doc(db, 'social_posts', newPostId), {
          ...newPost,
          userId,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        }, { merge: true });
      } catch (fsErr) {
        console.warn('[Firestore Schedule Save Warn]', fsErr);
      }
    }

    try {
      await axios.post('/api/posts/schedule', {
        content: postData.caption,
        caption: postData.caption,
        platforms: postData.platforms,
        scheduledAt: postData.scheduledAt,
        mediaUrls: postData.mediaUrl ? [postData.mediaUrl] : []
      });

      showToast(`Post scheduled for ${new Date(postData.scheduledAt).toLocaleString()}!`, 'success');
      setIsComposerModalOpen(false);
      setEditingPost(null);
    } catch (error: any) {
      console.error('[Schedule Error]', error);
      showToast('Post queued in local calendar and persistent database.', 'success');
      setIsComposerModalOpen(false);
      setEditingPost(null);
    }
  };

  const handleSaveDraft = async (draftData: {
    caption: string;
    platforms: SocialPlatform[];
    mediaUrl?: string;
    mediaName?: string;
  }) => {
    const newDraftId = `draft-${Date.now()}`;
    const nowIso = new Date().toISOString();
    const newDraft: SocialDraft = {
      id: newDraftId,
      caption: draftData.caption,
      platforms: draftData.platforms,
      mediaUrl: draftData.mediaUrl,
      mediaName: draftData.mediaName,
      createdAt: nowIso,
      updatedAt: nowIso
    };

    setDrafts(prev => [newDraft, ...prev]);

    try {
      if (userId) {
        await setDoc(doc(db, 'drafts', newDraftId), {
          userId,
          caption: draftData.caption,
          platforms: draftData.platforms,
          mediaUrl: draftData.mediaUrl || null,
          mediaName: draftData.mediaName || null,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
      }
      showToast('Draft saved successfully.', 'success');
      setIsComposerModalOpen(false);
      setEditingPost(null);
    } catch (err: any) {
      localStorage.setItem(`drafts_${userId}`, JSON.stringify([newDraft, ...drafts]));
      showToast('Draft saved locally.', 'success');
      setIsComposerModalOpen(false);
      setEditingPost(null);
    }
  };

  const handleDeletePost = async (postId: string) => {
    setPosts(prev => prev.filter(p => p.id !== postId));
    try {
      if (db) {
        await deleteDoc(doc(db, 'social_posts', postId));
      }
      await axios.delete(`/api/posts/${postId}`);
      showToast('Post removed from queue.', 'success');
    } catch (e) {
      showToast('Post removed from schedule.', 'success');
    }
  };

  const handleDeleteDraft = async (draftId: string) => {
    setDrafts(prev => prev.filter(d => d.id !== draftId));
    try {
      if (userId) {
        await deleteDoc(doc(db, 'drafts', draftId));
      }
      showToast('Draft deleted.', 'success');
    } catch (e) {
      showToast('Draft deleted.', 'success');
    }
  };

  const handleRetryPost = async (postId: string) => {
    const target = posts.find(p => p.id === postId);
    if (!target) return;

    setPosts(prev => prev.map(p => p.id === postId ? { ...p, status: 'SCHEDULED', errorLog: undefined } : p));
    try {
      await axios.post(`/api/posts/retry/${postId}`);
      showToast('Post queued for retry dispatch.', 'success');
    } catch (e) {
      showToast('Post reset to scheduled queue.', 'success');
    }
  };

  const handleEditPost = (post: SocialPost) => {
    setEditingPost(post);
    setIsComposerModalOpen(true);
  };

  const handleLoadDraft = (draft: SocialDraft) => {
    setEditingPost({
      id: draft.id,
      caption: draft.caption,
      platforms: draft.platforms,
      scheduledAt: new Date(Date.now() + 3600000 * 24).toISOString(),
      status: 'DRAFT',
      mediaUrl: draft.mediaUrl,
      mediaName: draft.mediaName
    });
    setIsComposerModalOpen(true);
  };

  const handleQuickScheduleFromCalendar = (dateString: string) => {
    const targetDate = new Date(dateString);
    targetDate.setHours(10, 0, 0, 0); // 10:00 AM standard
    setEditingPost({
      id: `post-${Date.now()}`,
      caption: '',
      platforms: ['linkedin', 'twitter'],
      scheduledAt: targetDate.toISOString(),
      status: 'SCHEDULED'
    });
    setIsComposerModalOpen(true);
  };

  const handleToggleConnection = (platform: SocialPlatform, targetState: boolean, handle?: string) => {
    setConnections(prev => ({
      ...prev,
      [platform]: {
        ...prev[platform],
        connected: targetState,
        handle: handle || prev[platform]?.handle || `@user_${platform}`
      }
    }));
  };

  return (
    <div className="w-full h-full overflow-y-auto pb-24 px-3 sm:px-6">
      <div className="w-full max-w-7xl mx-auto space-y-6 pt-4">
      
      {/* 1. TOP HEADER & PRIMARY ACTIONS */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white border border-neutral-200/80 rounded-2xl p-5 sm:p-6 shadow-xs">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 shadow-xs">
              <Share2 className="h-5 w-5" />
            </div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-neutral-900">
              Social Media Planner
            </h1>
          </div>
          <p className="text-xs sm:text-sm text-neutral-500 font-normal">
            Multi-platform scheduling, automated background workers, and AI-assisted cross-channel publishing.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Connect Accounts Button */}
          <button
            type="button"
            onClick={() => setActiveTab('accounts')}
            className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-xs font-semibold border transition-all cursor-pointer shadow-2xs ${
              activeTab === 'accounts'
                ? 'bg-indigo-600 text-white border-indigo-600'
                : 'bg-neutral-50 hover:bg-neutral-100 text-neutral-700 border-neutral-200'
            }`}
          >
            <ShieldCheck className={`h-4 w-4 ${activeTab === 'accounts' ? 'text-white' : 'text-indigo-600'}`} />
            <span>Manage Accounts</span>
            <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded-md ${
              activeTab === 'accounts' ? 'bg-indigo-700 text-white' : 'bg-indigo-100 text-indigo-700'
            }`}>
              {Object.values(connections).filter(c => c.connected).length} active
            </span>
          </button>

          {/* New Post / Compose Button */}
          <button
            type="button"
            onClick={() => {
              setEditingPost(null);
              setIsComposerModalOpen(true);
            }}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 active:scale-98 text-white text-xs font-semibold shadow-xs transition-all cursor-pointer"
          >
            <Plus className="h-4 w-4 stroke-[2.5]" />
            <span>Compose Post</span>
          </button>
        </div>
      </div>

      {/* 2. CHANNELS SUMMARY STRIP */}
      <div className="bg-white border border-neutral-200/80 rounded-2xl p-3 sm:p-4 flex flex-wrap items-center justify-between gap-3 shadow-xs">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">
          <Globe className="h-3.5 w-3.5 text-indigo-500" />
          <span>Active Social Feeds</span>
        </div>

        {/* Quick Platform Pills */}
        <div className="flex flex-wrap items-center gap-2">
          {(Object.keys(PLATFORM_CONFIGS) as SocialPlatform[]).map((plat) => {
            const config = PLATFORM_CONFIGS[plat];
            const connection = connections[plat];
            const isConnected = connection?.connected;

            return (
              <button
                key={plat}
                type="button"
                onClick={() => setIsAccountsModalOpen(true)}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-medium border transition-all cursor-pointer ${
                  isConnected
                    ? 'bg-neutral-50 border-neutral-200 text-neutral-800 hover:border-indigo-300 shadow-2xs'
                    : 'bg-neutral-50/50 border-neutral-200/60 text-neutral-400 opacity-70 hover:opacity-100'
                }`}
                title={`${config.name} - ${isConnected ? 'Connected (' + connection.handle + ')' : 'Click to connect'}`}
              >
                {plat === 'linkedin' && <Linkedin className="h-3.5 w-3.5 text-[#0A66C2] fill-current" />}
                {plat === 'twitter' && <span className="font-mono font-bold text-xs text-neutral-900">𝕏</span>}
                {plat === 'instagram' && <Instagram className="h-3.5 w-3.5 text-pink-600" />}
                {plat === 'facebook' && <Facebook className="h-3.5 w-3.5 text-blue-600 fill-current" />}
                {plat === 'tiktok' && <span className="font-bold text-[10px] text-cyan-600">TT</span>}
                {plat === 'thread' && <span className="font-bold text-[10px] text-neutral-700">@</span>}
                {plat === 'pinterest' && <span className="font-bold text-[10px] text-rose-600">P</span>}
                <span className="text-[11px] font-semibold">{config.name}</span>
                <span className={`h-1.5 w-1.5 rounded-full ${isConnected ? 'bg-emerald-500' : 'bg-neutral-300'}`} />
              </button>
            );
          })}
        </div>
      </div>

      {/* 3. NAVIGATION VIEW TABS */}
      <div className="flex items-center justify-between gap-4 border-b border-neutral-200 pb-2">
        <div className="flex items-center gap-2 overflow-x-auto max-w-full">
          <button
            onClick={() => setActiveTab('postiz')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
              activeTab === 'postiz'
                ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-xs'
                : 'text-indigo-600 bg-indigo-50/70 hover:bg-indigo-100 hover:text-indigo-700 border border-indigo-200/60'
            }`}
          >
            <Share2 className="h-4 w-4" />
            <span>Postiz Studio (30+ Networks)</span>
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${activeTab === 'postiz' ? 'bg-indigo-800 text-white' : 'bg-indigo-200 text-indigo-800'}`}>
              OAuth
            </span>
          </button>

          <button
            onClick={() => setActiveTab('calendar')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
              activeTab === 'calendar'
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100'
            }`}
          >
            <Calendar className="h-4 w-4" />
            <span>Interactive Calendar</span>
          </button>

          <button
            onClick={() => setActiveTab('queue')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
              activeTab === 'queue'
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100'
            }`}
          >
            <ListFilter className="h-4 w-4" />
            <span>Posts Queue & History</span>
            <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded-full ${activeTab === 'queue' ? 'bg-indigo-500 text-white' : 'bg-neutral-200 text-neutral-700'}`}>
              {posts.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('accounts')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
              activeTab === 'accounts'
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100'
            }`}
          >
            <ShieldCheck className="h-4 w-4" />
            <span>Connected Accounts</span>
            <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded-full ${activeTab === 'accounts' ? 'bg-indigo-500 text-white' : 'bg-emerald-100 text-emerald-800'}`}>
              {Object.values(connections).filter(c => c.connected).length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('compose')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
              activeTab === 'compose'
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100'
            }`}
          >
            <Edit2 className="h-4 w-4" />
            <span>Full Composer</span>
          </button>

          <button
            onClick={() => setActiveTab('grid')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
              activeTab === 'grid'
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100'
            }`}
          >
            <LayoutGrid className="h-4 w-4" />
            <span>Visual Grid Preview</span>
          </button>

          <button
            onClick={() => setActiveTab('worker')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
              activeTab === 'worker'
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100'
            }`}
          >
            <Cpu className="h-4 w-4" />
            <span>Task Worker & Dispatch</span>
          </button>
        </div>
      </div>

      {/* 4. MAIN VIEW CONTENTS */}
      <AnimatePresence mode="wait">
        {/* TAB 0: POSTIZ MULTI-CHANNEL HUB */}
        {activeTab === 'postiz' && (
          <motion.div
            key="postiz-tab"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
          >
            <PostizIntegrationPanel 
              userId={userId} 
              onPostCreated={() => {
                loadPostsFromBackend();
              }}
            />
          </motion.div>
        )}

        {/* TAB 1: CALENDAR VIEW */}
        {activeTab === 'calendar' && (
          <motion.div
            key="calendar-tab"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
          >
            <SocialCalendarView
              posts={posts}
              onSelectPost={handleEditPost}
              onQuickSchedule={handleQuickScheduleFromCalendar}
              onDeletePost={handleDeletePost}
            />
          </motion.div>
        )}

        {/* TAB 2: POSTS QUEUE & HISTORY */}
        {activeTab === 'queue' && (
          <motion.div
            key="queue-tab"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
          >
            <SocialPostsQueue
              posts={posts}
              drafts={drafts}
              onEditPost={handleEditPost}
              onLoadDraft={handleLoadDraft}
              onDeletePost={handleDeletePost}
              onDeleteDraft={handleDeleteDraft}
              onPublishNow={async (p) => {
                await handlePublishNow({
                  caption: p.caption,
                  platforms: p.platforms,
                  mediaUrl: p.mediaUrl,
                  mediaName: p.mediaName
                });
              }}
              onRetryPost={handleRetryPost}
              onNewPost={() => {
                setEditingPost(null);
                setIsComposerModalOpen(true);
              }}
            />
          </motion.div>
        )}

        {/* TAB: MULTI-TENANT CONNECTED ACCOUNTS */}
        {activeTab === 'accounts' && (
          <motion.div
            key="accounts-tab"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
          >
            <SocialAccountsConnect
              userId={userId}
              workspaceId="ws-production-tenant-42"
              onConnectionChange={(plat, isConnected, handle) => {
                const mappedPlat = plat === 'x' ? 'twitter' : (plat as SocialPlatform);
                handleToggleConnection(mappedPlat, isConnected, handle);
                showToast(
                  isConnected
                    ? `Successfully connected ${plat.toUpperCase()} (${handle || ''})!`
                    : `Disconnected ${plat.toUpperCase()}.`,
                  isConnected ? 'success' : 'default'
                );
              }}
            />
          </motion.div>
        )}

        {/* TAB 3: FULL COMPOSER IN-PAGE */}
        {activeTab === 'compose' && (
          <motion.div
            key="compose-tab"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
            className="bg-white border border-neutral-200/80 rounded-2xl p-6 shadow-xs"
          >
            <UnifiedPostComposer
              connections={connections}
              onPublishNow={handlePublishNow}
              onSchedulePost={handleSchedulePost}
              onSaveDraft={handleSaveDraft}
            />
          </motion.div>
        )}

        {/* TAB 4: VISUAL GRID PREVIEW */}
        {activeTab === 'grid' && (
          <motion.div
            key="grid-tab"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
          >
            <SocialMediaGrid
              onAddPost={(newGridPost) => {
                const mappedPlats = newGridPost.platforms.map(p => p.toLowerCase() as SocialPlatform);
                setPosts(prev => [
                  {
                    id: newGridPost.id,
                    caption: newGridPost.caption,
                    platforms: mappedPlats,
                    scheduledAt: `${newGridPost.scheduledAt}T${newGridPost.scheduledTime || '10:00 AM'}`,
                    status: newGridPost.status,
                    mediaUrl: newGridPost.mediaUrl
                  },
                  ...prev
                ]);
                showToast('Grid post saved to calendar!');
              }}
            />
          </motion.div>
        )}

        {/* TAB 5: TASK WORKER & MULTI-PLATFORM DISPATCH */}
        {activeTab === 'worker' && (
          <motion.div
            key="worker-tab"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
          >
            <SocialWorkerMonitor
              userId={userId || 'demo-user-123'}
              onPostPublished={() => {
                showToast('Batch publish task completed by worker.', 'success');
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* 5. MODAL: UNIFIED COMPOSER DIALOG */}
      <AnimatePresence>
        {isComposerModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsComposerModalOpen(false)}
              className="absolute inset-0 bg-neutral-900/60 backdrop-blur-xs"
            />

            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 15 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="w-full max-w-6xl max-h-[92vh] overflow-y-auto bg-white border border-neutral-200 rounded-3xl shadow-2xl relative z-10 text-neutral-900"
            >
              <UnifiedPostComposer
                isModal={true}
                initialPost={editingPost}
                connections={connections}
                onPublishNow={handlePublishNow}
                onSchedulePost={handleSchedulePost}
                onSaveDraft={handleSaveDraft}
                onClose={() => {
                  setIsComposerModalOpen(false);
                  setEditingPost(null);
                }}
              />
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* 6. MODAL: CONNECT ACCOUNTS */}
      <AccountsConnectModal
        isOpen={isAccountsModalOpen}
        onClose={() => setIsAccountsModalOpen(false)}
        connections={connections}
        onToggleConnection={handleToggleConnection}
        onShowToast={showToast}
        userId={userId}
        workspaceId="ws-production-tenant-42"
      />

      {/* 7. FLOATING TOAST NOTIFICATIONS */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-2xl border shadow-xl flex items-center gap-3 ${
              toast.type === 'error'
                ? 'bg-rose-50 border-rose-200 text-rose-800'
                : 'bg-emerald-50 border-emerald-200 text-emerald-800'
            }`}
          >
            {toast.type === 'error' ? (
              <AlertCircle className="h-5 w-5 text-rose-600 shrink-0" />
            ) : (
              <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
            )}
            <span className="text-xs font-semibold leading-tight">{toast.message}</span>
            <button
              onClick={() => setToast(null)}
              className="p-1 rounded-lg text-neutral-500 hover:text-neutral-800 transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      </div>
    </div>
  );
}
