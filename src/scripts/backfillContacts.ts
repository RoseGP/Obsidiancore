/**
 * One contact record: creates missing contacts for converted leads (or links them to the contact with the
 * same email) and adds the contact id to proposals (crmContactId) and invoicing clients (contactId) whose
 * email matches. Only adds; never deletes or overwrites.
 *
 *   npx tsx src/scripts/backfillContacts.ts                 # dry run, every organization
 *   npx tsx src/scripts/backfillContacts.ts --org <orgId>   # dry run, one organization
 *   npx tsx src/scripts/backfillContacts.ts --apply         # write
 *
 * Uses the configured store (CRM_STORE / Firestore credentials). Safe to re-run.
 */
import { backfillContacts, orgIds } from '../server/crm/backfill';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const org = args.includes('--org') ? args[args.indexOf('--org') + 1] : undefined;

const rows = [];
for (const id of await orgIds(org)) rows.push(await backfillContacts(id, { apply }));
console.table(rows);
console.log(apply ? 'Applied.' : 'Dry run: nothing was written. Re-run with --apply to write.');
