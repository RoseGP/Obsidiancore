import { initializeApp, getApp, getApps, FirebaseApp } from 'firebase/app';
import { getAuth, Auth } from 'firebase/auth';
import { getFirestore, initializeFirestore, Firestore, doc, getDocFromServer } from 'firebase/firestore';
import firebaseConfigJson from '../../firebase-applet-config.json';

// Define the operation enum as requested by the Firebase skill rules
export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

// Structure representing complete troubleshooting metadata for permission errors
export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

function getEnvValue(key: string): string | undefined {
  if (typeof process !== 'undefined' && process.env && process.env[key]) {
    return process.env[key];
  }
  if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env[key]) {
    return import.meta.env[key];
  }
  return undefined;
}

let firebaseApp: FirebaseApp | null = null;
let firestoreDb: Firestore | null = null;
let firebaseAuth: Auth | null = null;

/**
 * Checks if the necessary environment configuration is defined.
 */
export function isFirebaseConfigured(): boolean {
  return !!(
    getEnvValue('VITE_FIREBASE_API_KEY') ||
    firebaseConfigJson.apiKey
  );
}

/**
 * Get the initialized Firebase Application instance.
 * Safe from module-load failures by using lazy instantiation.
 */
export function getFirebaseApp(): FirebaseApp {
  if (!firebaseApp) {
    if (!isFirebaseConfigured()) {
      throw new Error(
        'Firebase config is missing in environment variables. ' +
        'Please define VITE_FIREBASE_API_KEY and VITE_FIREBASE_PROJECT_ID.'
      );
    }

    const firebaseConfig = {
      apiKey: getEnvValue('VITE_FIREBASE_API_KEY') || firebaseConfigJson.apiKey,
      authDomain: getEnvValue('VITE_FIREBASE_AUTH_DOMAIN') || firebaseConfigJson.authDomain,
      projectId: getEnvValue('VITE_FIREBASE_PROJECT_ID') || firebaseConfigJson.projectId,
      storageBucket: getEnvValue('VITE_FIREBASE_STORAGE_BUCKET') || firebaseConfigJson.storageBucket,
      messagingSenderId: getEnvValue('VITE_FIREBASE_MESSAGING_SENDER_ID') || firebaseConfigJson.messagingSenderId,
      appId: getEnvValue('VITE_FIREBASE_APP_ID') || firebaseConfigJson.appId,
    };

    if (getApps().length === 0) {
      firebaseApp = initializeApp(firebaseConfig);
    } else {
      firebaseApp = getApp();
    }
  }
  return firebaseApp;
}

/**
 * Validates if a database ID is a syntactically valid Firestore database ID.
 */
function isValidDatabaseId(dbId: string | undefined): boolean {
  if (!dbId) return false;
  if (dbId === '(default)') return true;
  return /^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/.test(dbId);
}

/**
 * Get the lazy-initialized Firestore Database reference.
 */
export function getFirestoreDb(): Firestore {
  if (!firestoreDb) {
    const app = getFirebaseApp();
    const envDbId = getEnvValue('VITE_FIREBASE_FIRESTORE_DATABASE_ID');
    const dbId = isValidDatabaseId(envDbId)
      ? envDbId
      : (isValidDatabaseId(firebaseConfigJson.firestoreDatabaseId) ? firebaseConfigJson.firestoreDatabaseId : undefined);
    
    try {
      firestoreDb = initializeFirestore(app, {
        experimentalAutoDetectLongPolling: true,
      }, dbId || '(default)');
    } catch (e) {
      firestoreDb = getFirestore(app, dbId || '(default)');
    }
  }
  return firestoreDb;
}

/**
 * Get the lazy-initialized Firebase Authentication instance.
 */
export function getFirebaseAuth(): Auth {
  if (!firebaseAuth) {
    const app = getFirebaseApp();
    firebaseAuth = getAuth(app);
  }
  return firebaseAuth;
}

/**
 * Mandatory skill-compliant Firestore Permission/Operation Error Handler.
 * Converts Firebase exceptions into serialized JSON objects to aid in backend diagnosis.
 */
export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  let authUser: any = null;
  try {
    if (isFirebaseConfigured()) {
      authUser = getFirebaseAuth().currentUser;
    }
  } catch (e) {
    // Squelch lazy loading error to prevent circular dependencies during diagnostic logs
  }

  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    operationType,
    path,
    authInfo: {
      userId: authUser?.uid || null,
      email: authUser?.email || null,
      emailVerified: authUser?.emailVerified || null,
      isAnonymous: authUser?.isAnonymous || null,
      tenantId: authUser?.tenantId || null,
      providerInfo: authUser?.providerData?.map((provider: any) => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || [],
    },
  };

  console.error('Firestore Error Payload:', JSON.stringify(errInfo, null, 2));
  throw new Error(JSON.stringify(errInfo));
}

/**
 * Tests the Firestore backend connection at start-up as strictly mandated.
 */
export async function testFirestoreConnection(): Promise<boolean> {
  if (!isFirebaseConfigured()) {
    console.warn('Skipping connection verification - Firebase credentials unconfigured.');
    return false;
  }

  try {
    const db = getFirestoreDb();
    // Fetch a non-existent placeholder path using the network bypass check
    await getDocFromServer(doc(db, 'test', 'connection'));
    console.log('Firebase Firestore verification connection check succeeded.');
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('offline')) {
      console.error('Please verify your Firebase networking setup: the client is currently offline.');
    } else {
      console.error('Firestore Startup Diagnostic check failed:', error);
    }
    return false;
  }
}
export { firestoreDb as db, firebaseAuth as auth };
