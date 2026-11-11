/**
 * Single rule for "should this process talk to Firestore?" (same as getDocStore):
 * CRM_STORE=firestore → yes; CRM_STORE=memory → no; unset → yes only when NODE_ENV=production.
 * Legacy modules that mirror data to Firestore check this first, so tests and local development
 * without Google credentials never start a Firestore client (whose failed credential lookup
 * otherwise surfaces as an unhandled rejection and kills the process).
 */
export function firestoreEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const mode = (env.CRM_STORE || '').trim().toLowerCase();
  if (mode === 'firestore') return true;
  if (mode === 'memory') return false;
  return env.NODE_ENV === 'production';
}

export async function requireFirestore() {
  if (!firestoreEnabled()) throw new Error('Firestore disabled (CRM_STORE / NODE_ENV)');
  return import('./firebaseAdmin');
}
