import { initializeApp, getApp, getApps, FirebaseApp } from 'firebase/app';
import { getAuth, Auth } from 'firebase/auth';
import { initializeFirestore, getFirestore, Firestore } from 'firebase/firestore';
import firebaseConfigJson from '../../firebase-applet-config.json';

// Double check configuration state
export const isFirebaseSetup = !!(
  firebaseConfigJson.apiKey ||
  (import.meta.env?.VITE_FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY)
);

const firebaseConfig = {
  apiKey: firebaseConfigJson.apiKey || import.meta.env?.VITE_FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY || '',
  authDomain: firebaseConfigJson.authDomain || import.meta.env?.VITE_FIREBASE_AUTH_DOMAIN || process.env.VITE_FIREBASE_AUTH_DOMAIN || '',
  projectId: firebaseConfigJson.projectId || import.meta.env?.VITE_FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID || '',
  storageBucket: firebaseConfigJson.storageBucket || import.meta.env?.VITE_FIREBASE_STORAGE_BUCKET || process.env.VITE_FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: firebaseConfigJson.messagingSenderId || import.meta.env?.VITE_FIREBASE_MESSAGING_SENDER_ID || process.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
  appId: firebaseConfigJson.appId || import.meta.env?.VITE_FIREBASE_APP_ID || process.env.VITE_FIREBASE_APP_ID || '',
};

let appInstance: FirebaseApp;
let dbInstance: Firestore;
let authInstance: Auth;

if (getApps().length === 0) {
  // Use a fallback initialization if config is missing to avoid crashing the dev server entirely,
  // in accordance with key-security and zero-crash initialization rules.
  if (isFirebaseSetup) {
    appInstance = initializeApp(firebaseConfig);
  } else {
    // Lazy fallback mock app structure or basic init
    appInstance = initializeApp({
      apiKey: "MOCK_API_KEY_PREVENT_CRASH",
      projectId: "mock-project-id",
      authDomain: "mock-project-id.firebaseapp.com"
    });
  }
} else {
  appInstance = getApp();
}

function isValidDatabaseId(dbId: string | undefined): boolean {
  if (!dbId) return false;
  if (dbId === '(default)') return true;
  return /^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/.test(dbId);
}

const envDbId = import.meta.env?.VITE_FIREBASE_FIRESTORE_DATABASE_ID || process.env.VITE_FIREBASE_FIRESTORE_DATABASE_ID;
const dbId = isValidDatabaseId(firebaseConfigJson.firestoreDatabaseId)
  ? firebaseConfigJson.firestoreDatabaseId
  : (isValidDatabaseId(envDbId) ? envDbId : undefined);

try {
  if (dbId) {
    dbInstance = initializeFirestore(appInstance, {
      experimentalAutoDetectLongPolling: true,
    }, dbId);
  } else {
    dbInstance = initializeFirestore(appInstance, {
      experimentalAutoDetectLongPolling: true,
    });
  }
} catch (e) {
  if (dbId) {
    dbInstance = getFirestore(appInstance, dbId);
  } else {
    dbInstance = getFirestore(appInstance);
  }
}
authInstance = getAuth(appInstance);

export { appInstance as app, dbInstance as db, authInstance as auth };
export default appInstance;
