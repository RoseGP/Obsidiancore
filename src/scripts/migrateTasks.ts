/**
 * One task list: copies tasks that exist only on leads (leads/{id}/tasks) or in inbox conversations
 * (inbox meta/crm.tasks) into organizations/{orgId}/tasks, keeping the same id for lead tasks and a
 * back-reference (legacy) to where each came from. The originals stay where they are. Safe to re-run.
 *
 *   npx tsx src/scripts/migrateTasks.ts                 # dry run, every organization
 *   npx tsx src/scripts/migrateTasks.ts --org <orgId>   # dry run, one organization
 *   npx tsx src/scripts/migrateTasks.ts --apply         # write
 */
import '../routes/messagingPlatform'; // registers the inbox task reader
import { migrateTasks, orgIds } from '../server/crm/backfill';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const org = args.includes('--org') ? args[args.indexOf('--org') + 1] : undefined;

const rows = [];
for (const id of await orgIds(org)) rows.push(await migrateTasks(id, { apply }));
console.table(rows);
console.log(apply ? 'Applied.' : 'Dry run: nothing was written. Re-run with --apply to write.');
process.exit(0);
