/** Small JSON helper for the security and compliance settings screens (auth headers come from apiAuth). */
export async function sapi<T = any>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) {
    const err: any = new Error(data.error || `Request failed (${res.status}).`);
    err.status = res.status; err.code = data.code;
    throw err;
  }
  return data;
}

export interface SecurityPolicy { requireMfa: boolean; maxSessionHours: number; idleSignOutMinutes: number }
export interface PolicyResponse { policy: SecurityPolicy; me: { role: string; method: string; twoStep: boolean; secondFactor: string | null; signedInAt: string | null } }

export const isAdminRole = (role?: string) => role === 'OWNER' || role === 'ADMIN';
