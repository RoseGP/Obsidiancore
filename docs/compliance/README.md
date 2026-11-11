# Compliance readiness

This folder describes the security and privacy controls built into Obsidian CRM and how they map to
common frameworks. **Controls support compliance; they don't certify it.** An organization using the CRM is
still responsible for its own policies, contracts, records of processing and audits.

| Document | What it covers |
|---|---|
| [SECURITY_CONTROLS.md](SECURITY_CONTROLS.md) | Authentication, two-step sign-in (and how to enable it), sessions, headers, uploads, encryption, monitoring, environment variables |
| [ACCESS_CONTROL.md](ACCESS_CONTROL.md) | Roles, the permission matrix, guests, how routes are protected |
| [PRIVACY.md](PRIVACY.md) | Consent, data-subject requests, erasure, retention: what each does to which data |
| [INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md) | How to handle a security incident and use the incident register |

In the app: **Settings › Security** (two-step sign-in, organization rules), **Settings › Roles & permissions**
(tab id `roles`), **Settings › Privacy & compliance** (tab id `compliance`; owners and admins only).

## GDPR

| Requirement | How the CRM helps | Your responsibility |
|---|---|---|
| Lawful basis and consent (art. 6–7) | Consent records per email and purpose (`/api/compliance/consents`); the website form records the consent it sends (`consent` field) | Decide the lawful basis; word consent requests correctly |
| Right of access and portability (art. 15, 20) | Access/export requests produce a JSON bundle of everything held about an email across every store | Verify identity; deliver the file securely; answer within one month |
| Right to rectification (art. 16) | Correction requests update the person's leads and contacts after approval | |
| Right to erasure (art. 17) | Deletion requests anonymize the person everywhere (preview first, approval required), keep a hashed tombstone and consent proof | Decide legal exceptions (e.g. invoices kept for tax law; the CRM keeps invoice amounts and clears personal details) |
| Storage limitation (art. 5(1)(e)) | Retention rules per data type (archive or anonymize), dry-run by default | Set periods that match your policy |
| Security of processing (art. 32) | RBAC, two-step sign-in, session limits, audit log, encryption in transit and at rest, upload checks | Configure, review access regularly |
| Breach notification (art. 33–34) | Incident register with personal-data flag and notification dates | Notify the authority within 72 hours where required |
| Records of processing (art. 30) | Audit log, this documentation | Maintain the record itself |

## CCPA / CPRA

Right to know, delete and correct map to the same requests (access/export, deletion, correction). The due date
shown is 30 days; CCPA allows 45 (extendable once). Opt-out of sale/sharing: the CRM doesn't sell or share data;
record opt-outs as consent `withdrawn` for the relevant purpose. Keep requests for 24 months (they are kept; after
erasure the request keeps only the email's domain and a hash).

## SOC 2 (Trust Services Criteria) mapping

| Criteria | Control in the CRM |
|---|---|
| CC6.1 logical access | Firebase authentication; server-side tenant resolution; permission matrix (`requireAccess`) |
| CC6.2/6.3 provisioning and removal | Invitations bound to a verified email; role changes and removals audited; access reviews with snapshots |
| CC6.6 boundary protection | `guard()` on every `/api` mount (tested), CORS allowlist, security headers, rate limits |
| CC6.7 data in transit | HTTPS (HSTS in production) |
| CC6.8 malicious software | Uploads identified by bytes, allowlisted types, no uploaded file served from the app origin |
| CC7.2 monitoring | Audit log; sign-in failure monitoring (429 after repeated bad credentials) |
| CC7.3–7.5 incident response | Incident register; [INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md) |
| CC8.1 change management | Git history, CI (`npm run test:ci`, typecheck), code review (your process) |
| A1.2 backup and recovery | Firestore managed backups / PITR (configure in Google Cloud); see SECURITY_CONTROLS.md |
| CC9.2 vendor management | Sub-processors listed below; obtain their SOC 2 reports and DPAs |

### Sub-processors to review

Google Firebase / Firestore / Identity Platform, the hosting provider, LiveKit (GREET video), Twilio (voice, SMS),
Meta (WhatsApp), Stripe and Square (payments), Postiz (social publishing), Anthropic and Google (AI features, only
when keys are configured), SMTP or Cloudflare (email).

## HIPAA

The CRM **does not claim HIPAA compliance** and has not been assessed for it. Don't store protected health
information (PHI) unless all of the following are true:

1. You have Business Associate Agreements with every provider that would store or transmit PHI (Google Cloud
   offers a BAA for covered services; check Firebase product coverage; LiveKit, Twilio, email and AI providers
   each need their own BAA or must be kept away from PHI).
2. AI features, social publishing and any provider without a BAA are disabled for that organization.
3. Two-step sign-in is required, sessions are limited, access reviews run regularly and the audit log is retained
   for at least six years (set the audit log retention accordingly).
4. A risk assessment has been done and documented.
