import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import firebaseConfigJson from '../../firebase-applet-config.json';

// Validates if a database ID is a syntactically valid Firestore database ID.
function isValidDatabaseId(dbId: string | undefined): boolean {
  if (!dbId) return false;
  if (dbId === '(default)') return true;
  return /^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/.test(dbId);
}

const resolvedProjectId =
  process.env.VITE_FIREBASE_PROJECT_ID ||
  process.env.FIREBASE_PROJECT_ID ||
  firebaseConfigJson.projectId;

const envDbId =
  process.env.VITE_FIREBASE_FIRESTORE_DATABASE_ID ||
  process.env.FIREBASE_FIRESTORE_DATABASE_ID;

const resolvedDatabaseId = isValidDatabaseId(envDbId)
  ? envDbId
  : (isValidDatabaseId(firebaseConfigJson.firestoreDatabaseId)
      ? firebaseConfigJson.firestoreDatabaseId
      : undefined);

// Initialize firebase-admin if not already initialized
const app = getApps().length === 0
  ? initializeApp({
      projectId: resolvedProjectId,
    })
  : getApps()[0];

export const adminDb = resolvedDatabaseId
  ? getFirestore(app, resolvedDatabaseId)
  : getFirestore(app);

export { app as adminApp };
