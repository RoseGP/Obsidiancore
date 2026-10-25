import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { 
  getFirestore, initializeFirestore, collection, doc, setDoc, deleteDoc, 
  onSnapshot, query, where, Timestamp, writeBatch 
} from 'firebase/firestore';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

// Interfaces for our database context consumer (matching SettingsView expects)
export interface DbChannel {
  id: string;
  platform: 'LINKEDIN' | 'FACEBOOK' | 'INSTAGRAM' | 'TIKTOK' | 'THREAD' | 'TWITTER' | 'PINTEREST' | string;
  handle: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  userId: string;
}

export interface DbPost {
  id: string;
  text: string;
  imageUrls: string[];
  scheduledAt: string;
  createdById: string;
}

export interface DbPostTarget {
  id: string;
  postId: string;
  channelId: string;
  status: 'PENDING' | 'PUBLISHED' | 'FAILED' | string;
  errorLog: string | null;
  publishedAt: string | null;
}

interface DatabaseContextType {
  dbChannels: DbChannel[];
  dbPosts: DbPost[];
  dbPostTargets: DbPostTarget[];
  addChannel: (channel: Omit<DbChannel, 'userId'>) => Promise<void>;
  deleteChannel: (id: string) => Promise<void>;
  createPost: (post: Omit<DbPost, 'createdById'>, targets: Omit<DbPostTarget, 'status' | 'errorLog' | 'publishedAt'>[]) => Promise<void>;
  deletePost: (id: string) => Promise<void>;
  simulatePublish: (targetId: string, forceFail?: boolean, isReset?: boolean) => Promise<void>;
  isLoading: boolean;
  userId: string | null;
}

const DatabaseContext = createContext<DatabaseContextType | undefined>(undefined);

// Local Storage Fallback Initializer
const INITIAL_CHANNELS: DbChannel[] = [
  { id: 'ch-1', platform: 'LINKEDIN', handle: '@flowforge', accessToken: 'ghp_Li739s8fW823ks8F92F', refreshToken: 'ref_388910s', expiresAt: new Date(Date.now() + 86400000 * 30).toISOString(), userId: 'demo-user-123' },
  { id: 'ch-2', platform: 'FACEBOOK', handle: '@flowforgepage', accessToken: 'eaac_Fb992js8Fl10sk37G2', refreshToken: 'ref_98231aa', expiresAt: new Date(Date.now() + 86400000 * 60).toISOString(), userId: 'demo-user-123' }
];

const INITIAL_POSTS: DbPost[] = [
  { id: 'post-1', text: 'Excited to announce our brand new Obsidian CRM Dashboard with direct real-time visualizers! 🚀 #marketing #sales', imageUrls: ['https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=300'], scheduledAt: new Date(Date.now() + 3600000 * 2).toISOString(), createdById: 'demo-user-123' },
  { id: 'post-2', text: 'Maximize your lead conversion using our high-reliability speed-to-lead routing protocols.', imageUrls: [], scheduledAt: new Date(Date.now() + 3600000 * 24).toISOString(), createdById: 'demo-user-123' }
];

const INITIAL_POST_TARGETS: DbPostTarget[] = [
  { id: 'pt-1', postId: 'post-1', channelId: 'ch-1', status: 'PENDING', errorLog: null, publishedAt: null },
  { id: 'pt-2', postId: 'post-1', channelId: 'ch-2', status: 'PUBLISHED', errorLog: null, publishedAt: new Date().toISOString() },
  { id: 'pt-3', postId: 'post-2', channelId: 'ch-1', status: 'PENDING', errorLog: null, publishedAt: null }
];

export function DatabaseProvider({ children }: { children: ReactNode }) {
  const [dbChannels, setDbChannels] = useState<DbChannel[]>(() => {
    try {
      const saved = localStorage.getItem('obsidian_db_channels');
      return saved ? JSON.parse(saved) : INITIAL_CHANNELS;
    } catch {
      return INITIAL_CHANNELS;
    }
  });

  const [dbPosts, setDbPosts] = useState<DbPost[]>(() => {
    try {
      const saved = localStorage.getItem('obsidian_db_posts');
      return saved ? JSON.parse(saved) : INITIAL_POSTS;
    } catch {
      return INITIAL_POSTS;
    }
  });

  const [dbPostTargets, setDbPostTargets] = useState<DbPostTarget[]>(() => {
    try {
      const saved = localStorage.getItem('obsidian_db_post_targets');
      return saved ? JSON.parse(saved) : INITIAL_POST_TARGETS;
    } catch {
      return INITIAL_POST_TARGETS;
    }
  });

  const [userId, setUserId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Initialize Firebase App & Firestore
  let dbInstance: any = null;
  let authInstance: any = null;

  try {
    const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
    const databaseId = firebaseConfig.firestoreDatabaseId || '(default)';
    try {
      dbInstance = initializeFirestore(app, {
        experimentalAutoDetectLongPolling: true,
      }, databaseId);
    } catch (innerErr) {
      dbInstance = getFirestore(app, databaseId);
    }
    authInstance = getAuth(app);
  } catch (err) {
    console.error('[Firebase Database] Failed to initialize SDK:', err);
  }

  // Handle Firebase Auth & Real-time Listeners
  useEffect(() => {
    if (!authInstance || !dbInstance) {
      setIsLoading(false);
      return;
    }

    const unsubscribeAuth = onAuthStateChanged(authInstance, async (user) => {
      if (user) {
        setUserId(user.uid);
        console.log('[Firebase Database] Authenticated as user ID:', user.uid);
      } else {
        try {
          console.log('[Firebase Database] No active session. Launching anonymous authentication...');
          const cred = await signInAnonymously(authInstance);
          setUserId(cred.user.uid);
        } catch (err) {
          console.warn('[Firebase Database] Anonymous authentication is disabled or restricted in the Firebase console. Falling back to secure local-only sandbox storage mode.', err);
          setIsLoading(false);
        }
      }
    });

    return () => {
      unsubscribeAuth();
    };
  }, []);

  // Sync state with Firestore once authenticated
  useEffect(() => {
    if (!dbInstance || !userId) {
      return;
    }

    // 1. Listen to User's Channels sub-collection
    const channelsRef = collection(dbInstance, 'users', userId, 'channels');
    const unsubscribeChannels = onSnapshot(channelsRef, (snapshot) => {
      if (!snapshot.empty) {
        const channelsData = snapshot.docs.map(doc => {
          const d = doc.data();
          return {
            id: d.id,
            platform: d.platform.toUpperCase(),
            handle: d.handle || '',
            accessToken: d.accessToken,
            refreshToken: d.refreshToken || '',
            expiresAt: d.tokenExpiry || new Date(Date.now() + 86400000 * 30).toISOString(),
            userId: userId
          } as DbChannel;
        });
        setDbChannels(channelsData);
        localStorage.setItem('obsidian_db_channels', JSON.stringify(channelsData));
      } else {
        // If Firestore is completely empty for this newly created anonymous session, seed standard fallbacks
        INITIAL_CHANNELS.forEach(async (ch) => {
          try {
            const chDoc = doc(dbInstance, 'users', userId, 'channels', ch.id);
            await setDoc(chDoc, {
              id: ch.id,
              platform: ch.platform.toLowerCase(),
              connected: true,
              handle: ch.handle,
              accessToken: ch.accessToken,
              refreshToken: ch.refreshToken,
              tokenExpiry: ch.expiresAt,
              updatedAt: Timestamp.now()
            });
          } catch (e) {
            console.warn('[Firebase Seed] Failed to seed channel:', e);
          }
        });
      }
    }, (error) => {
      console.warn('[Firebase Snapshot] Channels listener error:', error.message);
    });

    // 2. Listen to Posts collection for the current user
    const postsQuery = query(collection(dbInstance, 'posts'), where('userId', '==', userId));
    const unsubscribePosts = onSnapshot(postsQuery, (snapshot) => {
      if (!snapshot.empty) {
        const postsData = snapshot.docs.map(doc => {
          const d = doc.data();
          const schedDate = d.scheduledAt instanceof Timestamp ? d.scheduledAt.toDate().toISOString() : d.scheduledAt;
          return {
            id: doc.id,
            text: d.caption,
            imageUrls: d.media || [],
            scheduledAt: schedDate,
            createdById: d.userId
          } as DbPost;
        });
        // Sort posts descending by schedule time
        postsData.sort((a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime());
        setDbPosts(postsData);
        localStorage.setItem('obsidian_db_posts', JSON.stringify(postsData));
      } else {
        // Seed default posts
        INITIAL_POSTS.forEach(async (post) => {
          try {
            const postDoc = doc(dbInstance, 'posts', post.id);
            await setDoc(postDoc, {
              userId: userId,
              caption: post.text,
              media: post.imageUrls,
              scheduledAt: Timestamp.fromDate(new Date(post.scheduledAt)),
              channelIds: ['ch-1', 'ch-2'],
              status: 'scheduled',
              createdAt: Timestamp.now(),
              updatedAt: Timestamp.now()
            });
          } catch (e) {
            console.warn('[Firebase Seed] Failed to seed post:', e);
          }
        });
      }
    }, (error) => {
      console.warn('[Firebase Snapshot] Posts listener error:', error.message);
    });

    // 3. Listen to Post Targets collection
    const targetsRef = collection(dbInstance, 'post_targets');
    const unsubscribeTargets = onSnapshot(targetsRef, (snapshot) => {
      if (!snapshot.empty) {
        const targetsData = snapshot.docs.map(doc => {
          const d = doc.data();
          return {
            id: doc.id,
            postId: d.postId,
            channelId: d.channelId,
            status: d.status,
            errorLog: d.errorLog || null,
            publishedAt: d.publishedAt || null
          } as DbPostTarget;
        });
        setDbPostTargets(targetsData);
        localStorage.setItem('obsidian_db_post_targets', JSON.stringify(targetsData));
      } else {
        // Seed default post targets
        INITIAL_POST_TARGETS.forEach(async (pt) => {
          try {
            const targetDoc = doc(dbInstance, 'post_targets', pt.id);
            await setDoc(targetDoc, {
              postId: pt.postId,
              channelId: pt.channelId,
              status: pt.status,
              errorLog: pt.errorLog,
              publishedAt: pt.publishedAt
            });
          } catch (e) {
            console.warn('[Firebase Seed] Failed to seed target:', e);
          }
        });
      }
      setIsLoading(false);
    }, (error) => {
      console.warn('[Firebase Snapshot] Targets listener error:', error.message);
      setIsLoading(false);
    });

    return () => {
      unsubscribeChannels();
      unsubscribePosts();
      unsubscribeTargets();
    };
  }, [userId]);

  // Firestore DB Actions
  const addChannel = async (channel: Omit<DbChannel, 'userId'>) => {
    const activeUserId = userId || 'demo-user-123';
    
    // Update local state first for instant response
    const newChannel: DbChannel = { ...channel, userId: activeUserId };
    setDbChannels(prev => [...prev.filter(c => c.id !== channel.id), newChannel]);

    if (!dbInstance || !userId) return;

    try {
      const channelDoc = doc(dbInstance, 'users', userId, 'channels', channel.id);
      await setDoc(channelDoc, {
        id: channel.id,
        platform: channel.platform.toLowerCase(),
        connected: true,
        handle: channel.handle,
        accessToken: channel.accessToken,
        refreshToken: channel.refreshToken,
        tokenExpiry: channel.expiresAt,
        updatedAt: Timestamp.now()
      });
    } catch (e) {
      console.error('[Firebase Action] Failed to save channel:', e);
    }
  };

  const deleteChannel = async (id: string) => {
    // Update local state first
    setDbChannels(prev => prev.filter(c => c.id !== id));
    setDbPostTargets(prev => prev.filter(pt => pt.channelId !== id));

    if (!dbInstance || !userId) return;

    try {
      const channelDoc = doc(dbInstance, 'users', userId, 'channels', id);
      await deleteDoc(channelDoc);

      // Cascade delete related targets in Firestore
      const batch = writeBatch(dbInstance);
      dbPostTargets.forEach(pt => {
        if (pt.channelId === id) {
          const ptDoc = doc(dbInstance, 'post_targets', pt.id);
          batch.delete(ptDoc);
        }
      });
      await batch.commit();
    } catch (e) {
      console.error('[Firebase Action] Failed to delete channel:', e);
    }
  };

  const createPost = async (
    post: Omit<DbPost, 'createdById'>, 
    targets: Omit<DbPostTarget, 'status' | 'errorLog' | 'publishedAt'>[]
  ) => {
    const activeUserId = userId || 'demo-user-123';

    const newPost: DbPost = { ...post, createdById: activeUserId };
    const newTargets: DbPostTarget[] = targets.map(t => ({
      ...t,
      status: 'PENDING',
      errorLog: null,
      publishedAt: null
    }));

    setDbPosts(prev => [newPost, ...prev]);
    setDbPostTargets(prev => [...prev, ...newTargets]);

    if (!dbInstance || !userId) return;

    try {
      // 1. Save post to Firestore
      const postDoc = doc(dbInstance, 'posts', post.id);
      await setDoc(postDoc, {
        userId: userId,
        caption: post.text,
        media: post.imageUrls,
        scheduledAt: Timestamp.fromDate(new Date(post.scheduledAt)),
        channelIds: targets.map(t => t.channelId),
        status: 'scheduled',
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now()
      });

      // 2. Batch write targets to Firestore
      const batch = writeBatch(dbInstance);
      newTargets.forEach(target => {
        const ptDoc = doc(dbInstance, 'post_targets', target.id);
        batch.set(ptDoc, {
          postId: target.postId,
          channelId: target.channelId,
          status: 'PENDING',
          errorLog: null,
          publishedAt: null
        });
      });
      await batch.commit();
    } catch (e) {
      console.error('[Firebase Action] Failed to create post & targets:', e);
    }
  };

  const deletePost = async (id: string) => {
    setDbPosts(prev => prev.filter(p => p.id !== id));
    setDbPostTargets(prev => prev.filter(pt => pt.postId !== id));

    if (!dbInstance || !userId) return;

    try {
      const postDoc = doc(dbInstance, 'posts', id);
      await deleteDoc(postDoc);

      // Cascade delete related targets in Firestore
      const batch = writeBatch(dbInstance);
      dbPostTargets.forEach(pt => {
        if (pt.postId === id) {
          const ptDoc = doc(dbInstance, 'post_targets', pt.id);
          batch.delete(ptDoc);
        }
      });
      await batch.commit();
    } catch (e) {
      console.error('[Firebase Action] Failed to delete post & targets:', e);
    }
  };

  const simulatePublish = async (targetId: string, forceFail = false, isReset = false) => {
    const status = isReset ? 'PENDING' : (!forceFail && Math.random() > 0.2 ? 'PUBLISHED' : 'FAILED');
    const publishedAt = status === 'PUBLISHED' ? new Date().toISOString() : null;
    const errorLog = status === 'FAILED' ? (forceFail ? 'Simulated developer hard-failure rule' : 'OAuth Access Token Revoked by remote service API') : null;

    setDbPostTargets(prev => prev.map(pt => {
      if (pt.id === targetId) {
        return { ...pt, status, publishedAt, errorLog };
      }
      return pt;
    }));

    if (!dbInstance) return;

    try {
      const targetDoc = doc(dbInstance, 'post_targets', targetId);
      await setDoc(targetDoc, {
        status,
        publishedAt,
        errorLog
      }, { merge: true });
    } catch (e) {
      console.error('[Firebase Action] Failed to update post target status:', e);
    }
  };

  return (
    <DatabaseContext.Provider value={{
      dbChannels,
      dbPosts,
      dbPostTargets,
      addChannel,
      deleteChannel,
      createPost,
      deletePost,
      simulatePublish,
      isLoading,
      userId
    }}>
      {children}
    </DatabaseContext.Provider>
  );
}

export function useDatabase() {
  const context = useContext(DatabaseContext);
  if (context === undefined) {
    throw new Error('useDatabase must be used within a DatabaseProvider');
  }
  return context;
}
