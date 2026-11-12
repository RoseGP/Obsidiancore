# GREET meeting room (LiveKit)

A browser meeting room for GREET meetings: device check before joining, join through the server's token
boundary, camera / microphone / screen sharing with permission and device recovery, and a clean leave.
View id `meeting_room`; opened from GREET → "Join with a code" → **Check camera & mic, then join**, or
`/?room=<code>#meeting_room` (pre-fills the code; joining always waits for a click).

## Architecture

```
GreetHub ──onOpenRoom(code)──▶ MeetingRoom.tsx  (scenes: pre-join · joining/waiting · meeting · leaving · disconnected)
                                   │ useMeetingRoom (useSyncExternalStore; StrictMode-safe)
                                   ▼
                     MeetingRoomController.ts   ← all LiveKit objects, listeners and capture live here
                     │            │                       │
       meetingTokenClient.ts   livekit-client 2.22      deviceErrors.ts (permissions, error classification)
       POST /api/meetings/rooms/:code/join | /media-token | /leave
                     │
       src/routes/meetings.ts → sessions.ts mediaTokenFor → media.ts createMediaToken (livekit-server-sdk)

Optional (pre-join only): MediaQualityProbe.ts → wasmAnalyzer.ts → public/wasm/media_analysis.wasm
                          (C++: native/media-analysis, compiled with clang --target=wasm32)
```

| File | Role |
|---|---|
| `src/features/meeting-room/room/MeetingRoomController.ts` | Room and track lifecycle, state machine, recovery, teardown |
| `src/features/meeting-room/room/types.ts` | Snapshot types; the narrow livekit-client surface the controller uses |
| `src/features/meeting-room/room/layout.ts` | Stable tile order, screen-share stage, grid columns, aspect handling |
| `src/features/meeting-room/media/deviceErrors.ts` | Permission queries/watchers, capture and screen-share error classification |
| `src/features/meeting-room/api/meetingTokenClient.ts` | The only path to LiveKit credentials (the app's server) |
| `src/features/meeting-room/components/*` | Pre-join and meeting scenes, tiles, controls, track attach/detach |
| `src/features/meeting-room/analysis/*` | Optional C++/WASM camera and microphone quality hints |
| `native/media-analysis/` | C++ kernels, native tests (CMake), WASM build script |

### Scenes and transitions

`prejoin → joining → (waiting →) connected ⇄ reconnecting → leaving → prejoin`, plus `→ disconnected` when
the server ends the meeting, the host removes you, another tab takes your seat, or reconnection fails.

1. **Pre-join.** Permissions are read with the Permissions API (no prompt). Nothing is captured until the user
   turns the camera or microphone on; that creates the preview with `createLocalVideoTrack` /
   `createLocalAudioTrack`. Blocked states (insecure page, permissions policy, no API) are detected before asking.
2. **Join.** `POST …/join` puts you on the meeting's roster (capacity, lock and waiting room apply). While waiting,
   the client asks again every 4 s until admitted or cancelled. `POST …/media-token` returns `{url, token}`. The
   controller connects and publishes **only** the preview tracks the user turned on: the same `LocalTrack`
   objects, so there's no second permission prompt and LiveKit treats them as its own (it restarts them if
   the device disappears).
3. **Meeting.** Camera and microphone toggles call `LocalParticipant.setCameraEnabled` / `setMicrophoneEnabled`;
   the UI's "on" state is read back from the publication (track exists, not muted, `readyState` live), never from
   the button. Tiles are keyed by LiveKit identity and keep arrival order.
4. **Screen sharing.** `setScreenShareEnabled(true, {audio: false, contentHint: 'detail', selfBrowserSurface:
   'exclude', surfaceSwitching: 'include'})`. Cancelling the picker is not an error. OS-level denial ("Permission
   denied by system") gets instructions. When the user ends sharing from the browser's own control, LiveKit
   unpublishes the track (`LocalTrackUnpublished`) and the UI resets. The share takes the stage at its source
   aspect ratio (16:9 until known, shown whole); camera tiles fill and crop, never stretch.
5. **Leave / recovery.** `leave()` removes the controller's room listeners first, stops every local track,
   `room.disconnect(true)`, tells the server (`…/leave`) and returns to pre-join with everything off; it's
   idempotent. Device unplugged → fallback device + notice; permission revoked → shown as blocked with Retry;
   LiveKit muting a track it couldn't restart → shown as a device problem. Unmount disposes everything.

## Security: the token boundary

The browser never sends a room name or identity. The server:
- requires a signed-in tenant user (`requireTenant`, `requirePermission('read')`, rate limited);
- validates the meeting code (`^[a-z0-9][a-z0-9-]{2,62}$`) and looks up the running session;
- issues a token only to roster participants with status `in`, for that meeting's LiveKit room (the session id),
  with identity = roster participant id, `roomAdmin` only for host/co-host/org admins, and a TTL that ends at the
  plan's time limit; every issuance is audited (`greet.media_token.issued`);
- answers `503 media_not_configured` without LiveKit credentials.
`LIVEKIT_API_SECRET` exists only in the server environment. No new endpoint was needed.

## The C++ component, and why it's WebAssembly

**What:** analysis-only kernels for the pre-join check: per-frame luma statistics (mean, contrast, dark/clipped
share), sharpness (variance of the Laplacian), and per-block microphone level, peak, clipping, zero-crossing rate
and an adaptive noise-floor tracker with a speech-likely flag. The UI turns these into hints ("your video looks
dark", "your microphone is distorting", "no sound is reaching the microphone").

**Why WASM, not a native service:** the inputs are the local preview, which is private and already in the browser;
shipping frames to a server would add latency and a privacy cost for no benefit. The module is freestanding
(no libc, no allocation) so it compiles with stock `clang --target=wasm32` (no Emscripten) to ~1.5 KB, and the same
source builds natively for unit tests.

**Honest sizing:** at 160×120 once a second and 2048-sample blocks five times a second, this work would also be
cheap in plain TypeScript. C++ earns its place as a portable, tested kernel library that can grow (e.g. SIMD,
higher-resolution or per-frame analysis) and be reused natively (e.g. a server-side recording QA job), but the
current workload isn't a performance necessity.

**Guarantees:** it never touches the media sent to LiveKit (read-only copies: a canvas readback and an
`AnalyserNode` that isn't connected to any output), adds no latency to the call, runs only in pre-join while the
checkbox is on, keeps everything in the tab, and is optional: if `/wasm/media_analysis.wasm` is missing, corrupt or
a different ABI, the loader returns `null` and the room works the same without hints. No effects, filters, face
tracking or reframing are applied.

## Configure, build, run

```bash
npm ci
# .env (server only; never in the frontend):
#   LIVEKIT_URL=wss://<your-project>.livekit.cloud      (or your self-hosted wss:// URL)
#   LIVEKIT_API_KEY=<api key>
#   LIVEKIT_API_SECRET=<api secret>
npm run dev                  # http://localhost:3000 (localhost counts as a secure context for camera/mic)
npm run build                # production build; public/wasm/media_analysis.wasm is copied to dist/

npm run build:wasm           # rebuild the WASM after changing native/media-analysis (clang >= 13 + lld)
```
Production needs HTTPS (browsers refuse camera/microphone/screen capture on insecure origins) and a LiveKit server
reachable from users' networks (UDP, or TURN/TLS on 443 for restrictive networks).

## Tests

```bash
npm run test:meeting-room            # controller (34), units incl. the real WASM in Node (17), UI in happy-dom (8)
npm run test:media-analysis-native   # C++ kernels natively (CMake + CTest); needs cmake and a C++17 compiler
npm run typecheck
```
LiveKit and the browser are faked (`__tests__/fakes.ts`) with the same event names and semantics as
livekit-client 2.22 (including `LocalTrackUnpublished` when a screen share ends and `MediaDevicesError`).

## Manual verification (real devices)

Use two browsers/profiles (A and B) signed in to the same organization, with LiveKit configured. Start a GREET
meeting in A (host), copy its code, then in B open GREET → "Check camera & mic, then join".

1. **Not yet requested:** fresh profile → badges say "Not asked yet"; no camera light until you click the camera.
2. **Grant:** click the camera → browser prompt → Allow → preview appears, badge "On". Same for the microphone.
3. **Deny:** reset site permissions, click the camera → Block → "Camera access is blocked…" with "Check again";
   allow it in site settings → "Check again" → preview starts.
4. **Dismiss (Chrome):** close the prompt with ✕ → "The camera permission prompt was closed. Try again…".
5. **In use:** open the camera in another app that holds it exclusively (Windows) → "may be in use" message.
6. **Join with camera only:** A sees B's video, B's tile shows the microphone off; no second prompt in B.
7. **Toggles:** B turns the camera off → A sees the avatar, B's camera light goes off; mic on/off → A's tile icon follows.
8. **Screen share:** B shares a window → A sees it on the stage at its own aspect ratio; B stops with the
   browser's "Stop sharing" bar → stage disappears in both, B sees "You stopped sharing your screen".
9. **Cancel picker:** B clicks Share, then Cancel → no error, control not stuck.
10. **macOS OS denial:** remove the browser from System Settings → Screen Recording → share → instructions shown.
11. **Unplug** B's USB camera mid-meeting → falls back to another camera with a notice, or shows "Your camera stopped".
12. **Revoke** camera in B's site settings mid-meeting → camera shows as blocked with "Check again".
13. **Network:** toggle B's Wi-Fi off for ~5 s → "Reconnecting…", then "Reconnected."
14. **Autoplay:** reload B and join without clicking → if audio is blocked, "Start audio" appears and fixes it.
15. **Leave:** B clicks Leave → camera light off, screen share stopped, A sees B leave; B is back in pre-join.
16. **Host ends / removes:** A ends the meeting → B sees "The meeting has ended."; removal → "The host removed you…".
17. **Waiting room** (plan with waiting room on): B waits with "Waiting for the host…" until A admits; Cancel works.
18. **Analysis:** cover the lens → "camera image is black"; tap the mic → distortion hint; delete
    `dist/wasm/media_analysis.wasm` → the checkbox disappears and the room still works.

## Limitations

- The existing GREET workspace (`VideoMeetingWorkspace` via `MeetingSessionContext`) is unchanged and still
  hosts started meetings; both join the same LiveKit room with the same identities, so they interoperate. Moving
  the workspace onto this controller is the natural next step.
- Joining needs a signed-in organization user; external guests still use invitation links (`GreetGuestPage`).
- Screen-share audio is off; mobile browsers can't share the screen (the control is hidden there).
- `navigator.permissions.query({name: 'camera'|'microphone'})` isn't available in every browser; there the state
  shows as "Off" and the first click asks.
- The quality thresholds are heuristics tuned on synthetic inputs; validate them with real cameras before
  relying on them.
- Not verified against a live LiveKit server in CI (no credentials there); run the manual checks above.
