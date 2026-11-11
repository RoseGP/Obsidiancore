# Incident response

Use **Settings › Privacy & compliance › Incidents** as the register (`/api/compliance/incidents`). Each incident has a
title, severity (low → critical), status (open → investigating → contained → resolved → closed), whether personal
data is involved, and the dates the authority and the affected people were notified. Changes are audited.

## Steps

1. **Detect and record** the incident straight away (time detected, what's known).
2. **Contain**: revoke affected sessions (the person: Settings › Security › Sign out on all devices; an admin: remove
   the member or change their role), rotate keys (lead-capture key, embed keys, provider credentials in the
   environment), require two-step sign-in if accounts were taken over.
3. **Investigate** with the audit log (filter by actor or action; export CSV) and server logs.
4. **Assess** whether personal data was affected and the risk to people.
5. **Notify** when required: GDPR: the supervisory authority within **72 hours** of becoming aware, and the people
   affected without undue delay when the risk is high. CCPA/state laws: affected residents per state rules. Record
   the dates in the incident.
6. **Recover and learn**: fix the cause, record actions taken, close the incident, and review access (Access reviews).

## Contacts to keep current

Security owner, privacy/data-protection contact, hosting and Firebase support, payment providers, legal counsel.
