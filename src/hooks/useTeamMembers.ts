/**
 * The signed-in person and their organization's members (from /api/orgs/current/members).
 * Used wherever the UI offers "owner" / "assign to": only real people are listed.
 */
import { useEffect, useMemo, useState } from 'react';
import { useOptionalAuth } from '../context/AuthContext';
import { getApiAuthHeaders } from '../lib/apiAuth';

export interface TeamMember { id: string; name: string; email: string; role: string }

export function useTeamMembers() {
  const auth = useOptionalAuth();
  const myName = auth?.userProfile?.displayName || auth?.user?.email || auth?.userProfile?.email || '';
  const [members, setMembers] = useState<TeamMember[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/orgs/current/members', { headers: await getApiAuthHeaders() });
        const data = await res.json().catch(() => ({}));
        if (!cancelled && res.ok && Array.isArray(data.members)) {
          setMembers(data.members.map((m: any) => ({ id: String(m.userId), name: m.name || m.email || 'Team member', email: m.email || '', role: m.role || '' })));
        }
      } catch { /* offline: only "me" is offered */ }
    })();
    return () => { cancelled = true; };
  }, []);

  /** Unique display names, the signed-in person first. */
  const names = useMemo(() => {
    const list = [myName, ...members.map((m) => m.name)].filter(Boolean);
    return [...new Set(list)];
  }, [myName, members]);

  return { me: myName, members, names };
}
