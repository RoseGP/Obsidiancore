/**
 * Signed-in identity for components that call the app's own API (Social Planner, Local SEO, voice).
 *
 * This used to read and write social channels, posts and their access tokens directly from the
 * browser to Firestore, sign every visitor in anonymously and seed sample channels with made-up
 * tokens. All of that now lives on the server (/api/accounts, /api/posts), where tokens are
 * encrypted and scoped to the organization. Here we only expose who is signed in.
 */
import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { getApps, getApp, initializeApp } from 'firebase/app';
import { getAuth, onAuthStateChanged } from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

interface DatabaseContextType {
  /** Firebase uid of the signed-in (non-anonymous) user, or null. */
  userId: string | null;
  isLoading: boolean;
}

const DatabaseContext = createContext<DatabaseContextType | undefined>(undefined);

export function DatabaseProvider({ children }: { children: ReactNode }) {
  const [userId, setUserId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    try {
      const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
      unsubscribe = onAuthStateChanged(getAuth(app), (user) => {
        setUserId(user && !user.isAnonymous ? user.uid : null);
        setIsLoading(false);
      });
    } catch {
      setIsLoading(false); // Firebase not configured: sandbox/dev identity is used instead.
    }
    return () => unsubscribe?.();
  }, []);

  return <DatabaseContext.Provider value={{ userId, isLoading }}>{children}</DatabaseContext.Provider>;
}

export function useDatabase() {
  const ctx = useContext(DatabaseContext);
  if (ctx === undefined) throw new Error('useDatabase must be used within a DatabaseProvider');
  return ctx;
}
