# Meeting plans and subscriptions

Three tiers. The values below are the **first-run defaults**: platform administrators change them in
**Settings → Plan Administration** (stored in `platform_config/meeting_plans`), with no code change.

| | Free | Premium | Enterprise |
|---|---|---|---|
| Participants per meeting (host included) | 100 | 250 | 500, or the agreement's custom limit |
| Meeting length | 60 minutes | 5 hours | 12 hours, or custom |
| Warning before the end | 5 minutes | 5 minutes | 5 minutes |
| "Almost full" notice | at 90% | at 90% | at 90% |
| Recording | – | ✓ | ✓ |
| Waiting room | – | ✓ | ✓ |
| Advanced host controls (mute one person, remove, lower hands) | – | ✓ | ✓ |
| Meeting lock | – | ✓ | ✓ |
| Analytics | – | ✓ | ✓ |
| Co-hosts | – | – | ✓ |
| Attendance reports | – | – | ✓ |
| Custom branding (name, color in meetings) | – | – | ✓ |
| Organization meeting dashboard | – | – | ✓ |
| Priority support (entitlement shown on the plan) | – | – | ✓ |

## How enforcement works

Every rule is checked by the server (`src/server/meetings/*`, routes in `src/routes/meetings.ts`). The UI mirrors it
and explains it, but can't bypass it.

- **Organizer's plan.** A meeting takes the plan of the host's organization (`subscriptions/{orgId}`) when it starts
  (`POST /api/meetings/sessions`). The session stores a snapshot of limits and features.
- **Server clock.** The session has `startedAt`/`endsAt` from the server. Clients sync their countdown to `serverNow`
  on every response and poll `GET /api/meetings/sessions/:id` every 10 seconds.
- **Capacity.** Invites (one or many), joining by link (`POST /api/meetings/rooms/:code/join`), and admitting from
  the waiting room all count seats inside a transaction. A full meeting refuses with `409 meeting_full` and the plan
  that would fit.
- **Features.** Refused with `403 feature_not_in_plan`, naming the feature and the smallest plan that includes it.
  Recording must be approved by the server before the browser starts recording.
- **Time limit.** The host is warned before the end (configurable, 5 minutes by default) and again at 1 minute. At the
  limit the meeting ends for everyone: every read settles expiry, and a background sweeper
  (`startMeetingSweeper`, every 15 s) ends meetings nobody is polling. The recording is saved and cameras/mics are
  released; the summary says why it ended.
- **Upgrades and downgrades.** An upgrade applies to running meetings immediately (more people, more time, more
  features). A downgrade, or an administrator lowering a tier's limits, applies to the next meeting: a running meeting
  is never cut short.
- **Scheduled and recurring meetings** (`POST /api/meetings/create`): every occurrence must fit the organizer's plan
  (duration and guests + host); series are capped at 52. `GET /api/meetings` re-checks them against the current plan
  and flags the ones a downgrade affects. When such a meeting starts, it gets the plan in force at that time.
- **No server, no meeting.** Production builds don't start or join meetings without the server. Sandbox/dev builds
  (`VITE_ENABLE_SANDBOX_LOGIN`) may run an offline preview with Free limits, labeled as such.

## Changing an organization's plan

Organizations can't change their own tier. Owners and Admins **request** a change (`POST /api/meetings/subscription/requests`,
from the plan comparison in meetings and in Settings → Organization); a platform administrator approves or declines
it, or changes the subscription directly. Every change is recorded in `subscription_events` (who, when, why,
upgrade/downgrade). When billing is connected (Phase B), paid changes will be applied from the subscription webhook.

## Platform administrators

User ids in `PLATFORM_ADMIN_USER_IDS` (comma-separated). They see **Settings → Plan Administration**:
plan editor (limits, warning times, features), Enterprise custom limits, change requests, subscriptions, meetings
running now (with End), and usage statistics. All `/api/admin/meetings/*` endpoints refuse anyone else (403).

## Data

| Path | What |
|---|---|
| `platform_config/meeting_plans` | Tier configuration (+ `plan_config_events` history) |
| `subscriptions/{orgId}` | Tier, Enterprise custom limits/features |
| `subscription_events/*`, `subscription_requests/*` | Change history and requests |
| `organizations/{orgId}/meeting_sessions/*` | Sessions (roster, limits snapshot, status) |
| `meeting_rooms/{code}`, `meeting_active/{id}` | Room codes and running meetings (indexes) |
| `meeting_usage/{id}` | One row per ended meeting (analytics, statistics) |
| `organizations/{orgId}/scheduled_meetings/*` | Scheduled and recurring meetings |
| `organizations/{orgId}/settings/branding` | Enterprise branding |

Earlier builds stored only `organizations/{orgId}/settings/meetings.plan`; it's still read (`standard` = Free) until
a subscription document exists.

## Audio and video (LiveKit)

Set `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` (LiveKit Cloud or self-hosted). The server
(`src/server/meetings/media.ts`) issues a token only to people the roster has let in, for that meeting's room only,
expiring at the plan's time limit; hosts/co-hosts/org admins get room-admin rights. When a meeting ends (host,
administrator or time limit) the server deletes the LiveKit room, disconnecting everyone; removing a participant
removes them from the room. The browser (`src/lib/meetingMedia.ts`) publishes camera, microphone and screen,
plays remote audio, shows remote video on the participant tiles, reports active speakers, and carries chat over
the data channel. Without the keys, `POST …/media-token` answers 503 `media_not_configured` and the meeting says
video isn't connected; nothing is simulated.

## Limits of the current build

- The LiveKit browser path is covered by type checks and server tests, but needs one live check with real keys
  (this build environment can't run a LiveKit server).
- Recordings are made in the host's browser; "advanced recording storage" needs a storage provider and isn't built.
- Statistics scan `meeting_usage`; past ~100k meetings, keep daily aggregates.
