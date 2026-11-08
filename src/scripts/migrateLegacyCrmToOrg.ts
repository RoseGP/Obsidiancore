/**
 * Copies the old shared CRM collections (crm_leads, crm_deals, …) into ONE organization:
 * organizations/{orgId}/leads, /deals, … . Nothing is deleted or modified at the source.
 *
 * Dry run (default) only counts what would be copied. Re-running is safe: documents that already
 * exist at the destination are skipped unless --overwrite is given.
 *
 *   npx tsx src/scripts/migrateLegacyCrmToOrg.ts --org <orgId>                 # dry run
 *   npx tsx src/scripts/migrateLegacyCrmToOrg.ts --org <orgId> --apply
 *   npx tsx src/scripts/migrateLegacyCrmToOrg.ts --owner-uid <firebaseUid> --org-name "Acme" --apply
 *        (creates the organization with that user as OWNER, then copies)
 *
 * Needs Firestore credentials (GOOGLE_APPLICATION_CREDENTIALS or running on Google Cloud) and
 * CRM_STORE=firestore (set automatically by this script).
 */
import { assertId, type DocStore } from '../server/data/docStore';

/** Old root collection → new per-organization collection (and lead subcollections to carry along). */
export const LEGACY_MAP: Array<{ from: string; to: string; sub?: string[] }> = [
  { from: 'crm_leads', to: 'leads', sub: ['tasks', 'activities'] },
  { from: 'crm_deals', to: 'deals' },
  { from: 'crm_tickets', to: 'tickets' },
  { from: 'crm_contacts', to: 'contacts' },
  { from: 'crm_companies', to: 'companies' },
  { from: 'crm_tasks', to: 'tasks' },
  { from: 'crm_activities', to: 'activities' },
  { from: 'crm_social_posts', to: 'social_drafts' },
];

export interface LegacySource {
  list(collection: string): Promise<Array<{ id: string; data: Record<string, any> }>>;
}

export async function migrateLegacy(opts: { source: LegacySource; target: DocStore; orgId: string; apply: boolean; overwrite?: boolean; log?: (m: string) => void }) {
  const { source, target, apply, overwrite = false } = opts;
  const orgId = assertId(opts.orgId);
  const log = opts.log ?? console.log;
  if (!(await target.get(`organizations/${orgId}`))) throw new Error(`Organization ${orgId} does not exist.`);
  const report: Record<string, { found: number; copied: number; skipped: number; invalidIds: number }> = {};

  const copy = async (key: string, srcPath: string, dstPath: string) => {
    const r = (report[key] ??= { found: 0, copied: 0, skipped: 0, invalidIds: 0 });
    const docs = await source.list(srcPath);
    for (const d of docs) {
      r.found++;
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(d.id)) { r.invalidIds++; continue; }
      const dst = `${dstPath}/${d.id}`;
      if (!overwrite && (await target.get(dst))) { r.skipped++; continue; }
      if (apply) await target.set(dst, { ...d.data, id: d.id, ...(dstPath.split('/').length === 3 ? { orgId } : {}), migratedFrom: `${srcPath}/${d.id}` });
      r.copied++;
    }
    return docs;
  };

  for (const m of LEGACY_MAP) {
    const docs = await copy(m.to, m.from, `organizations/${orgId}/${m.to}`);
    for (const sub of m.sub || []) {
      for (const d of docs) {
        if (!/^[A-Za-z0-9_-]{1,128}$/.test(d.id)) continue;
        await copy(`${m.to}/*/${sub}`, `${m.from}/${d.id}/${sub}`, `organizations/${orgId}/${m.to}/${d.id}/${sub}`);
      }
    }
  }

  if (apply) await target.set(`organizations/${orgId}/migrations/legacy_crm_v1`, { id: 'legacy_crm_v1', ranAt: new Date().toISOString(), overwrite, report });
  log(`${apply ? 'Copied' : 'DRY RUN, would copy'} into organizations/${orgId}:`);
  for (const [k, v] of Object.entries(report)) log(`  ${k.padEnd(22)} found ${v.found}, ${apply ? 'copied' : 'to copy'} ${v.copied}, already present ${v.skipped}${v.invalidIds ? `, invalid ids ${v.invalidIds}` : ''}`);
  return report;
}

// ---- CLI ----
const isMain = process.argv[1] && /migrateLegacyCrmToOrg\.ts$/.test(process.argv[1]);
if (isMain) {
  const arg = (n: string) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined; };
  const apply = process.argv.includes('--apply');
  process.env.CRM_STORE = 'firestore';
  (async () => {
    const { adminDb } = await import('../lib/firebaseAdmin');
    const { FirestoreDocStore } = await import('../server/data/docStore');
    const target = new FirestoreDocStore(adminDb);
    let orgId = arg('--org');
    if (!orgId) {
      const owner = arg('--owner-uid'), name = arg('--org-name');
      if (!owner || !name) throw new Error('Give --org <orgId>, or --owner-uid <uid> --org-name "<name>".');
      if (!apply) { console.log(`DRY RUN: would create organization "${name}" owned by ${owner}. Re-run with --apply.`); return; }
      const { createOrg } = await import('../server/tenancy/orgs');
      orgId = (await createOrg({ userId: owner }, name, target)).id;
      console.log(`Created organization ${orgId}`);
    }
    const source: LegacySource = { list: async (c) => (await adminDb.collection(c).get()).docs.map((d) => ({ id: d.id, data: d.data() })) };
    await migrateLegacy({ source, target, orgId, apply, overwrite: process.argv.includes('--overwrite') });
  })().catch((e) => { console.error('Migration failed:', e?.message || e); process.exit(1); });
}
