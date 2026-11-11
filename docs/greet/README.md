# GREET: video meetings in the CRM (LiveKit)

GREET is the CRM's video meeting module. It replaces the old "Video Meetings" / "Greet Hub" / "Meet & Greet"
wording. Audio and video run on [LiveKit](https://docs.livekit.io/); the CRM server decides who may connect.

## What users get

| Where | What |
|---|---|
| **GREET page** (view `greet`) | Start an instant meeting, schedule one, join by code or link, live meetings in the organization, Upcoming, Invitations, History, Recordings, device check |
| **Meeting details** | Reschedule, cancel, guest invitation links (create, copy, withdraw), outcome, follow-up task on the linked lead, schedule another meeting |
| **Meeting room** (`call_canvas`) | Video grid with active speaker, chat over LiveKit data messages, screen sharing, participant list, waiting room, host controls (admit, deny, mute, mute all, remove, co-host, lock), end for everyone, network quality and reconnecting status, notes saved to the CRM, recording with consent |
| **Guest page** (`/?greet_invite=<token>`) | For people without a CRM account: waiting room, then audio/video once the host lets them in |
| **Calendar** | Shows GREET meetings from the server. Every scheduling form in the app creates a GREET meeting |

## Data (all scoped by organization)

| Path | Contents |
|---|---|
| `organizations/{org}/scheduled_meetings/{id}` | Title, times and occurrences, `hostId`, `invitees[]` (members), `guests[]` (emails), `associations` (lead, deal, contact, company: checked against the organization), `status` SCHEDULED/LIVE/ENDED/CANCELLED, `actualStart`/`actualEnd`, `participants[]` (attendance), `outcome`, `roomCode`. Older records without the new fields still load. |
| `…/scheduled_meetings/{id}/invites/{inviteId}` | Guest invitations: email, name, expiry, revoked, last used. **The link token is never stored.** |
| `organizations/{org}/meeting_sessions/{id}` | Live sessions (plan limits, roster, waiting room, recording consent). Ending a session updates its scheduled meeting. |
| `organizations/{org}/meeting_recordings/{id}` | Cloud recording metadata: storage key, consents, retention date, status. No credentials. |
| `organizations/{org}/greet_history_imports/{id}` | Meeting history moved from a browser (older versions kept it in localStorage). Visible to its owner only. |
| `organizations/{org}/settings/greet` | `recordingEnabled` (default **false**), `recordingRetentionDays` (default 30) |
| `organizations/{org}/audit_log/{id}` | `{ at, actorId, action, target, meta }` for tokens issued, recordings (start, stop, view, download link, delete, expire), consent answers, invitations, cancellations and settings. Never contains tokens or keys. |

Scheduling, edits and cancellations are also logged to the organization activity feed and, when a lead is
linked, to that lead's timeline (types `meeting_scheduled`, `meeting_rescheduled`, `meeting_cancelled`, `meeting_outcome`).

## API

Signed-in members (`/api/meetings`, all through `guard()` and the tenant):

| Method and path | Who | Notes |
|---|---|---|
| `POST /create` | write | `{ title, date, time, duration, timezone?, guests?, inviteeIds?, associations?, recurrence? }`; plan limits checked |
| `GET /` (`?mine=true`) | read | Organization meetings with `status`, `yourRole`, `canEdit` |
| `GET /hub` | read | `upcoming`, `invitations`, `history`, `live` for you |
| `GET /:id` | read | Meeting plus its invitations (for the host and managers) |
| `PATCH /:id` | host or `manage_records` | Edit or reschedule (plan limits checked again); not while LIVE |
| `POST /:id/cancel` | host or `manage_records` | Invitation links stop working |
| `POST /:id/outcome` | host, invitee or manager | `{ result, summary }` |
| `POST /:id/invites`, `DELETE /:id/invites/:inviteId` | host or `manage_records` | Signed guest links; 503 `invites_not_configured` without a secret |
| `POST /history/import` | write | Idempotent per browser record |
| `POST /sessions` `{ scheduledMeetingId }` | write | Starts the scheduled meeting (its room code and title) and marks it LIVE |
| `POST /sessions/:id/media-token`, `POST /rooms/:code/media-token` | in the meeting | LiveKit token (below) |
| `POST /sessions/:id/participants/:pid/mute`, `POST /sessions/:id/mute-all` | host, co-host, admin | Through LiveKit `RoomServiceClient.mutePublishedTrack` |
| `POST /sessions/:id/recording` `{ action: request\|start\|stop\|cancel, target? }` | host, co-host, admin | See Recording |
| `POST /sessions/:id/recording/consent` `{ consent }` | in the meeting | Your answer |

Public (`/api/greet`, only these paths pass `guard(PUBLIC.greet)`, rate limited per IP):
`GET /invite/:token`, `POST /invite/:token/join`, `GET /invite/:token/session`, `POST /invite/:token/media-token`,
`POST /invite/:token/recording-consent`, `POST /invite/:token/leave` (guest key in `X-Greet-Guest-Key`), and
`POST /livekit-webhook` (verified with the LiveKit API key and secret).

Signed-in (`/api/greet`): `GET /recordings`, `GET /recordings/:id` (5-minute download link, logged),
`DELETE /recordings/:id`, `GET /settings`, `PUT /settings` (OWNER/ADMIN), `GET /audit` (OWNER/ADMIN).

## Token security

- Tokens are issued **only by the server** (`livekit-server-sdk` `AccessToken`). The browser never sees the API secret.
- The caller must be signed in and in the meeting's roster with status `in`, or be an invited guest the host admitted.
  Waiting, denied, removed or left participants get no token.
- One token per participant: identity is the roster id, the grant is for **that meeting's room only**
  (`room = session id`), and it expires at the meeting's plan time limit.
- `roomAdmin` only for the host, co-hosts and organization admins. Guests never get it.
- Rate limited (sessions: 240/min per user; guest endpoints: 60/min per IP, joins 10/min).
- Each token issued is written to the audit log, without the token.

## Guest invitations

`POST /api/meetings/:id/invites` creates one link per guest: `<APP_URL>/?greet_invite=<payload>.<hmac>`.
The HMAC uses `GREET_INVITE_SECRET` (falls back to `JWT_SECRET`). A link works for one meeting and expires a
day after the meeting's last occurrence (90 days at most). Withdrawing it, or cancelling the meeting, stops it at once.
Guests always land in the waiting room. Their browser gets a random key; the server stores only its hash.

## Recording (optional, off by default)

1. The host asks to record. Every participant, guests included, sees a consent prompt. Nothing is recorded yet.
2. Recording starts only when everyone in the meeting has agreed. The server refuses with `consent_pending` and
   lists who hasn't answered. Everyone sees a red **Recording** label while it runs.
3. **Cloud** (LiveKit Egress, room composite MP4 to S3-compatible storage) is used when the server has the
   `LIVEKIT_EGRESS_*` settings **and** an organization admin turned recording on in GREET settings.
   `target: 'cloud'` returns 501 `recording_not_configured` otherwise. Without cloud, the host's browser can
   record on their own device, as before.
4. Cloud recordings are visible to the meeting host and organization admins only. Downloads are 5-minute
   presigned links. Every view, download link and deletion is logged.
5. **Retention:** each recording gets `deleteAfter` = start + the organization's retention days. An hourly sweeper
   deletes expired files and retries failed deletions; a deleted recording keeps a tombstone for the audit trail.
6. Encryption at rest is the storage bucket's job: turn on default encryption (SSE-S3 or SSE-KMS). The CRM can't verify it.

## Setup

```bash
LIVEKIT_URL=wss://<project>.livekit.cloud
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...
GREET_INVITE_SECRET=<32+ random characters>
# Optional cloud recording
LIVEKIT_EGRESS_ENABLED=true
LIVEKIT_EGRESS_S3_BUCKET=... LIVEKIT_EGRESS_S3_REGION=... LIVEKIT_EGRESS_S3_ACCESS_KEY=... LIVEKIT_EGRESS_S3_SECRET=...
LIVEKIT_EGRESS_S3_ENDPOINT=   # for R2 / MinIO (path-style)
LIVEKIT_EGRESS_S3_PREFIX=greet-recordings
```

In the LiveKit dashboard, add a webhook pointing to `<APP_URL>/api/greet/livekit-webhook`, so finished recordings
are marked ready. Without LiveKit, meetings can still be scheduled and invitations sent, and the app says plainly
that video isn't connected.

## Tests

`npm run test:greet` covers scheduling with associations, invitee checks, the hub, reschedule and cancel
permissions, the meeting/session lifecycle, guest links (forged, tampered, revoked), waiting room → token,
token scope, host mute, consent-first recording (device and cloud with a stand-in Egress), recording access
and deletion, audit entries, outcome, history import and the webhook signature, plus the client calendar mapping.

## Known limits

- The old `VideoWelcomePage.tsx` is no longer rendered (the GREET page replaces it). The file is kept until removal is approved.
- Follow-up tasks are saved on the linked lead (`POST /api/leads/:id/tasks`). When the unified tasks API lands, only
  `createFollowUpTask` in `src/lib/greetClient.ts` needs to change.
- Invitation notifications appear in the in-app notification center when the invitee opens GREET, and as entries in
  the organization feed. Email delivery of invitations isn't built: hosts copy and send the links.
- Google Calendar events aren't merged into the GREET calendar list yet.
