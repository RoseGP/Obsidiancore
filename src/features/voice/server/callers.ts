/**
 * Caller lookup by phone number.
 *
 * SECURITY: caller ID (Twilio `From`) can be spoofed. Use the result only to
 * personalise wording and to pick the number on file for SMS — never as
 * authentication, and never to read out account details.
 *
 * Replace `createSimulatedCallerDirectory` with a real implementation backed by
 * your CRM/user database (same interface). The simulated one exists only because
 * the specification asks for a simulated lookup.
 */
export interface CallerRecord { userId: string; fullName: string; phoneE164: string }

export interface CallerDirectory {
  findByPhone(phoneE164: string): Promise<CallerRecord | null>;
}

export const E164 = /^\+[1-9]\d{6,14}$/;

/** SIMULATED: in-memory directory with artificial latency. Not for production data. */
export function createSimulatedCallerDirectory(records: CallerRecord[], latencyMs = 30): CallerDirectory {
  const byPhone = new Map(records.filter((r) => E164.test(r.phoneE164)).map((r) => [r.phoneE164, r]));
  return {
    async findByPhone(phone) {
      await new Promise((r) => setTimeout(r, latencyMs));
      return byPhone.get(phone) ?? null;
    },
  };
}

/**
 * Seed for the simulated directory: IVR_SIMULATED_CALLERS='[{"userId":"u1","fullName":"Ada Lovelace","phoneE164":"+15125550123"}]'
 * Ignored in production unless IVR_ALLOW_SIMULATED_CALLERS=true.
 */
export function simulatedCallersFromEnv(env: NodeJS.ProcessEnv): CallerRecord[] {
  if (env.NODE_ENV === 'production' && env.IVR_ALLOW_SIMULATED_CALLERS !== 'true') return [];
  try {
    const parsed = JSON.parse(env.IVR_SIMULATED_CALLERS || '[]');
    return Array.isArray(parsed) ? parsed.filter((r) => r && typeof r.userId === 'string' && typeof r.fullName === 'string' && typeof r.phoneE164 === 'string') : [];
  } catch { return []; }
}
