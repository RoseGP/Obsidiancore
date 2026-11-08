# Integration report: uploaded `obsidian-crm` repository → Obsidiancore

Date: 2026-11-08 · Branch: `ccr-3cb69e97-gobm6h` · Safety checkpoint: tag `backup/pre-merge-2026-11-08` (and branch `backup/pre-merge-2026-11-08-branch`) point at your last commit before the merge (`02ff2b1`).

## 1. What the two codebases are

Both are the same application: React 19 + Vite + Tailwind 4 front end, Express server (`server.ts`), Firebase/Firestore, Stripe/Square, Postiz (social), Twilio/LiveKit (voice). The uploaded repository's first commit ("Original codebase (as uploaded)") is **byte-for-byte identical** to your commit `28d4a28`, apart from your `assets/` folder and `bun.lock`. So the two versions diverged from one shared point:

| | Your branch (since `28d4a28`) | Uploaded repo (since the same base) |
|---|---|---|
| Commits | 1: `02ff2b1` Quick actions + UI/UX | 10: security, tenancy, meeting controls, Postiz fixes, AI, embed calendar, API key, hardening, CLAUDE.md |
| Files | 46 | 157 |
| Invoice pages (`src/features/invoicing`) | untouched | untouched |
| Social Planner | Overview page, PlannerApp, Composer, planner.css | 5 small bug fixes |

Because of this, the merge was done with Git (each of the 10 upload commits replayed on top of your work, with real three-way merges), not by copying files. Their authorship and history are preserved.

### What your branch already had (kept)
- Quick Action button + modal (lead / deal / event) in the top bar.
- Redesigned Dashboard (dark mode), Settings (tabbed layout, Murmura billing page).
- Social Planner Overview page and planner styling.
- Meeting plan tiers (Standard 100 / 60 min, Premium 250, Enterprise 500), duration warnings, capacity counter, muted-mic overlays on every local video tile.
- Deleted the `crm-email-worker` and `email-parser-service` folders (kept deleted).

### What the upload added (merged)
- **Security:** auth required on leads/dashboard/marketing APIs; removed password-less admin login; signed webhooks (Stripe, Square, Meta, Twilio); fail-safe `NODE_ENV`; CORS locked to `APP_URL`.
- **Organizations & roles:** Owner → Read-only, invitations, tenant-scoped data, `Settings → Organization & Members`.
- **Meeting control bar:** accessible bar (mic, camera, share, participants, chat, More, Leave), host/admin-only recording and "End for everyone" with confirmation, phone bottom sheet; fixed a transcript-tab crash.
- **Social Planner bug fixes** (see §3).
- **AI:** dashboard assistant with server-owned prompt and streaming; one AI service for Gemini + Claude with fallback.
- **Embeddable calendar widget** (`public/widget.js`, `/api/v1/events`), **master API key** for Functions/Workers, **per-user encrypted Google tokens**, CI workflow, ~25k lines of legacy/simulated code removed, 60 → 0 type errors.

## 2. Conflicts and how each was resolved

| File | Conflict | Resolution |
|---|---|---|
| `DashboardView.tsx` | Your redesign vs. upload replacing invented fallback numbers (`|| 366500`, `|| 14` calls…) | Kept **your layout and styling**; took the upload's real values (`?? 0`, "not connected yet"), so the dashboard no longer shows fake metrics. |
| `SettingsView.tsx` | Your restructured tabs vs. upload's Organization screen and legacy LinkedIn handler removal | Kept **your file**. Swapped the mock `RolePermissionsManagement` for the server-enforced `OrganizationSettings` (one role UI, not two). LinkedIn "Connect" now opens Social Planner → Accounts (the real Postiz flow) instead of a deleted legacy OAuth handler. |
| `VideoConsultation.tsx` | You added one `id`; upload deleted the file | Deleted: nothing imported it; it was a 1,900-line duplicate of the meeting workspace. |
| `VideoMeetingWorkspace.tsx`, `App.tsx`, `CRMSoftphoneCanvas.tsx`, `Composer.tsx` | Both sides edited different regions | Merged automatically; your plan tiers, muted overlays and quick actions all present. |

## 3. Social Planner and Invoice pages

**Invoice pages: zero changes.** `git diff backup/pre-merge-2026-11-08 HEAD -- src/features/invoicing` is empty. `MurmuraBillingPage` is also unchanged.

**Social Planner: design and layout unchanged.** Changes, each a behavior fix or compatibility requirement:

1. *Upload fix* — "Publish now" really publishes now (asks to confirm first) instead of scheduling +60 s; double-click can't publish twice.
2. *Upload fix* — planner requests use the signed-in user id (a planner-only fallback id split uploads and posts between two identities).
3. *Compatibility* — the upload removed the old "Advanced tools" panel (`SocialPlannerView`, ~10k lines incl. server routes) because it was a second, legacy social-posting stack. Old redirect URLs now open **Accounts**, and the "Open advanced tools" card in planner Settings only appears if that panel exists, so nobody lands on an empty screen.
4. *Pre-existing bug fix* — your Overview page read `PLATFORMS[pid].name`, which doesn't exist (the field is `label`), so platform names rendered blank. Three-word fix; this was also the only remaining type error.

## 4. Video meetings: one unified experience

One implementation now: `MeetingSessionContext` (state, media, recording) → `VideoMeetingWorkspace` (UI) → `MeetingControlBar` + `meetingControls.ts` (tested control model).

**Combined from both versions:** upload's accessible control bar, host/admin permissions, end-for-everyone confirmation, mobile bottom sheet and crash fix + your plan tiers, duration limit banners, capacity counter and muted-mic overlays.

**Added in this integration:**
- **Raise hand** (everyone; More → Participate): shown on the video tile and in the roster (raised hands sorted first), announced to screen readers.
- **Waiting room** (host/admin toggle, remembered): invited guests wait until admitted; Admit / Deny / Admit all respect the plan's participant limit. Hosts see an amber waiting count on the Participants button.
- **Host controls** (host or org Owner/Admin only): mute one participant, mute everyone, remove a participant (inline confirm), lower one or all hands.
- **AI recap** (`POST /api/meetings/ai-summary`): summary, decisions, action items ("Add to follow-ups"), and a follow-up email draft (Copy / Open in email). Uses the shared Gemini/Claude service with **CRM tools disabled**; members with write access only; 10/minute per user. Lives in the existing Meeting Details tab of the end-of-meeting summary.

**Duplicates removed:**
- Header "Leave" button (the control bar's Leave is always visible); header "Share" renamed "Copy link" so it isn't confused with screen sharing.
- `CRMCallCanvas.tsx` (its route was unreachable: `call_canvas` always rendered the workspace first), `MeetingMediaControls.tsx` + `VideoPreviewContainer.tsx` (an unused third control bar), `WebRTCCallToast.tsx` (unused). Each confirmed to have no remaining importers.

**Already present, kept as-is:** screen share, recording with consent + pause/resume (MediaRecorder), transcript tab and PDF/TXT export, meeting notes, follow-up tasks, meeting history, chat (group + private), reactions, speaker/grid layouts, device settings (camera/mic/speaker, quality, noise suppression), invite by link/email, scheduling (`CreateMeetingView`, `/api/meetings`), floating mini-HUD when navigating away.

### Meeting plans (group meetings)

| Plan | Participants (host included) | Time limit |
|---|---|---|
| Standard | 100 | 60 minutes |
| Premium | 250 | none |
| Enterprise | 500 | none |

- The plan belongs to the **organization** (`GET/PUT /api/meetings/plan`, stored at `organizations/{orgId}/settings/meetings`). Every member can see it; only Owners and Admins can change it, in **Settings → Organization & Members → Meeting plan**. The in-meeting plan switcher was removed (anyone could lift the limits with one click). Until billing is connected (Phase B), the plan is set there; Phase B will set it from the subscription.
- A meeting **locks in** the plan it started with; a plan change applies to the next meeting.
- **Capacity:** invites (single or pasted lists), admitting from the waiting room and "Admit all" all stop at the limit, and the participant list itself is capped so nothing can overfill it. A full room names the plan that would fit.
- **60-minute limit (Standard):** a countdown banner for the last 5 minutes, then the meeting ends for everyone: recording saved, camera and microphone released, and the summary opens ("Meeting ended at the 60-minute limit").
- **Large rooms:** the video grid is paged (4 tiles on phones, 9 / 16 / 25 on wider screens) with screen sharers, speakers and raised hands first; tiles go compact above 9; thumbnail strips show 30 plus "+N more"; the Participants list gets search above 8 people.
- Fixed along the way: invites waited 600 ms on a fake "email dispatch" and said the email was sent (it isn't; the message now says to share the link); guests invited in the same millisecond got the same id; the invite dialog closed itself 2 s after each invite.
- Tests: `test:meeting-plans` (19 plan rules + 11 API checks incl. roles and cross-organization isolation); meeting session suite now 26 (100-person cap, batch of 150, simultaneous invites, plan locked per meeting, 60-minute auto-end, Premium running past 60 minutes).

## 5. Important: what is real vs. simulated in meetings

Your own camera, microphone, screen share and recording are real browser media. **Other participants, their chat replies and invitation emails are simulated in the browser**; there is no signaling/media server behind the meeting workspace yet, so two people on two computers cannot see each other. Live captions are a placeholder awaiting a transcription service. The new raise-hand, waiting-room and host controls work on that same in-browser roster and will carry over once a real media provider is connected. This matches the upload's own roadmap item "E · Real multi-person video (XL)". Recommended provider: **LiveKit** (the repo already contains `ts-livekit-ivr`), which also brings server recording, transcription and true participant permissions.

## 6. Database, dependencies, environment

- **Database:** no new tables or migrations from this integration. The upload stores CRM data under `organizations/{orgId}/…` in Firestore; run `src/scripts/migrateLegacyCrmToOrg.ts` (dry run first) to move existing shared data into your organization. Waiting-room preference is a browser setting (`localStorage`).
- **Dependencies added (from upload):** `@anthropic-ai/sdk` 0.132.1, `jsonwebtoken` ^9.0.2, `remark-gfm` 4.0.1; dev: `happy-dom` 15.11.7. `npm ci` works from the lockfile.
- **New environment variables** (see `.env.example`; none contain values): `APP_URL`, `POSTIZ_*`, `SQUARE_WEBHOOK_SIGNATURE_KEY`, `META_APP_SECRET`, `TWILIO_AUTH_TOKEN`, `ANTHROPIC_API_KEY`/`ANTHROPIC_MODEL`, `GEMINI_MODEL`, `EMBED_TOKEN_SECRET`, `CORS_ALLOWED_ORIGINS`, `MASTER_API_KEY` (`npm run key:generate`), `CRM_STORE`, `GOOGLE_TOKEN_ENCRYPTION_KEY`, and dev-only `SOCIAL_ACCOUNTS_DEV_AUTH`.

## 7. Tests performed

| Check | Result |
|---|---|
| `tsc --noEmit` | 0 errors (was 3 after merge, all in Overview page; fixed) |
| Lint guards | pass |
| `npm run test:ci` (18 suites) | all pass: messaging 19, Stripe 17, video 60, invoicing 15, social accounts 50+42+8, local SEO 27, voice IVR 38, security 21+34+47, **meeting controls 42** (was 35), **meeting session 13** (new), **meeting summary 15** (new), assistant 23, AI 24, embed 35, API key 24, Google 25 |
| `npm run test:payments` (not in CI) | 17/22. Before the merge this suite crashed on start; the 5 failures need a real Stripe API key. |
| `npm run build` | pass (only Vite's existing large-chunk warning) |
| Browser (Playwright, sandbox login) | Meeting started; control bar, More menu, raise hand, waiting room invite → Admit, host mute/remove, AI recap card; desktop 1440×900 and phone 390×844 with no horizontal overflow and no page errors. |

## 8. Recommended next features (not built; need your go-ahead)

- **Meetings:** real multi-party media via LiveKit (recording, transcription, enforced host controls); calendar invite (.ics / Google Calendar) from the scheduler; "Create tasks in CRM" from AI action items.
- **AI:** smart scheduling suggestions from availability; AI caption/repurpose assistant inside the Social Planner composer; invoice insights (late-payment risk, cash-flow summary).
- **Social Planner:** approval workflow (draft → review → approved) using org roles; per-post performance analytics from Postiz.
- **Invoices:** automated payment reminders, recurring invoices, Stripe Connect / Square send + webhook → Paid (upload roadmap B).
- **Platform:** move remaining disk-based stores to Firestore (upload roadmap A·2); code-split the 500 kB+ bundle; components that fetch before sign-in produce 401s in the console on the login screen (harmless, worth gating).

## 9. Requires external credentials or services

`GEMINI_API_KEY` or `ANTHROPIC_API_KEY` (assistant, AI recap) · Postiz (`POSTIZ_URL`, client id/secret) · Stripe/Square webhook secrets · Google OAuth client (Calendar, Business Profile) · SMTP (email) · Twilio/Meta secrets · Firebase service account (production Firestore) · a video provider such as LiveKit for real multi-person meetings.
