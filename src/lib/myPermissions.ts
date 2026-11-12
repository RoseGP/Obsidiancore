/**
 * The signed-in member's grants from the organization role matrix (GET /api/orgs/me → current.permissions),
 * used to hide actions the server would refuse. This is presentation only: the server enforces the same
 * matrix on every request (src/server/security/permissions.ts), so a hidden button is never the protection.
 *
 * Until the grants have loaded, `can()` returns true (no flicker; the server still refuses what isn't allowed).
 */
import { useEffect, useState } from 'react';

export type Grants = Record<string, string[]>;
const TTL_MS = 60_000;
let cache: { at: number; promise: Promise<Grants | null> } | null = null;

export function loadMyPermissions(force = false): Promise<Grants | null> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.promise;
  const promise = fetch('/api/orgs/me', { headers: { Accept: 'application/json' } })
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => (d?.current?.permissions && typeof d.current.permissions === 'object' ? (d.current.permissions as Grants) : null))
    .catch(() => null);
  cache = { at: Date.now(), promise };
  return promise;
}

/** Forget cached grants (after switching organization or signing out). */
export function resetMyPermissions() { cache = null; }

export function canWith(grants: Grants | null, module: string, permission: string): boolean {
  return grants ? (grants[module] || []).includes(permission) : true;
}

/** `const can = useCan(); can('deals', 'create')` */
export function useCan(): (module: string, permission: string) => boolean {
  const [grants, setGrants] = useState<Grants | null>(null);
  useEffect(() => {
    let live = true;
    loadMyPermissions().then((g) => { if (live) setGrants(g); });
    return () => { live = false; };
  }, []);
  return (module, permission) => canWith(grants, module, permission);
}
