/**
 * Fail-safe environment checks.
 *
 * Development conveniences (the X-Dev-User-Id header, unsigned webhooks) are allowed ONLY when
 * NODE_ENV is explicitly "development" or "test". An unset or misspelled NODE_ENV is treated
 * like production, so a deployment that forgets to set it cannot accidentally open these paths.
 */
export function isExplicitDevOrTest(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = (env.NODE_ENV || '').trim().toLowerCase();
  return v === 'development' || v === 'test';
}

/** The X-Dev-User-Id identity header: explicit dev/test mode AND explicit opt-in. */
export function devIdentityHeaderAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return isExplicitDevOrTest(env) && env.SOCIAL_ACCOUNTS_DEV_AUTH === 'true';
}

/** Accepting a provider webhook without a signature: explicit dev/test mode AND explicit opt-in. */
export function unsignedWebhooksAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return isExplicitDevOrTest(env) && env.ALLOW_UNSIGNED_WEBHOOKS === 'true';
}
