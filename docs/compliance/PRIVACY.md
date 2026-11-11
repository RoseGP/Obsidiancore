# Privacy: consent, data-subject requests, retention

All of this is in **Settings › Privacy & compliance** (owners and admins) and `/api/compliance`.
Every action is written to the audit log with the email masked.

## Consent

`organizations/{org}/consents/{id}`: `{ email, purpose, status: granted|withdrawn, source, at, recordedBy }`.
Purposes: `marketing_email`, `sms`, `phone_calls`, `analytics`, `data_processing`, `meeting_recording`, `other`.
The newest entry per purpose is the current status.

Website form (`POST /api/leads/capture`): send `consent: true` (records `data_processing` granted) or an object such
as `{ "marketing_email": true, "sms": false }`. Unknown purposes are ignored.

## Data-subject requests

Flow: **requested → approved → completed** (or rejected). Nothing changes until approval; erasure and correction
show a preview of what would change. Due date shown: 30 days.

| Type | Result |
|---|---|
| access / export | A JSON bundle (`obsidian-crm/data-subject-export@1`) with everything held about the email; credential-like fields (share-token hashes) are left out. Can be downloaded again later |
| correction | Name, email, phone, company or title updated on the person's leads and contacts |
| deletion | Anonymization everywhere (below); the request keeps only the email's domain and a hash afterwards |

### What erasure does, per store

| Store | Change |
|---|---|
| `leads` | name → "Removed contact"; email, phone, company, title, notes, qualification cleared; `anonymizedAt` set |
| lead `tasks` / `activities` | titles and descriptions replaced |
| `contacts` | personal fields cleared |
| `deals` (linked) | client name replaced; value, stage and dates kept |
| `activities` (linked) | title and description replaced |
| `proposals` (client email) | client name/email/company cleared; items and totals kept |
| `billing/{org}/clients`, `invoices` | client and bill-to details cleared; invoices and amounts kept (accounting law) |
| `scheduled_meetings` | the email removed from guests |
| `meeting_notes` (linked lead) | body replaced |
| `inbound_messages`, `voicemails` (lead's phone) | number, name and text removed |
| inbox conversations | the person's name/email/visitor details removed and their own messages replaced; team replies kept |
| `consents` | email replaced by its SHA-256 hash (proof of consent/withdrawal; prevents re-contact) |
| `dsr_tombstones` | new record: email hash, time, request id, counts |

Nothing is hard-deleted. The same person in another organization is not affected (each organization is a
separate controller).

Not covered (no personal data stored there, or not stored by this server): the Social Planner gateway, payment
providers' own records (Stripe/Square: use their tools), email already sent, LiveKit (no recordings stored).

## Retention

`organizations/{org}/settings/retention`. Per data type: enabled, days, action (`archive` = sets `archivedAt`;
`anonymize` = clears personal fields), apply automatically.

| Type | Minimum | Actions |
|---|---|---|
| Leads that never converted | 30 days | archive, anonymize |
| Activity feed | 30 days | archive, anonymize |
| Meeting notes | 30 days | archive, anonymize |
| WhatsApp/SMS messages, voicemails | 30 days | archive, anonymize |
| Audit log | 365 days | archive only |
| Consent records | not subject to retention | — |

`POST /api/compliance/retention/run` is a dry run unless `apply: true`. The daily sweeper applies only rules marked
"apply automatically" and stores dry-run counts for the rest.

Limitation: `archivedAt` is a marker; list screens that don't filter on it yet still show archived records.
