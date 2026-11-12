/**
 * Camera, microphone and screen-capture permission handling for the meeting room.
 *
 * Browsers report capture failures as DOMExceptions with standard names (Media Capture and Streams spec):
 *   NotAllowedError       the user or the browser refused (also: a dismissed prompt in Chromium, "Permission dismissed")
 *   NotFoundError         no such device
 *   NotReadableError      the device exists but can't be opened (another app has it, or a hardware/OS error)
 *   OverconstrainedError  the requested device/resolution doesn't exist (e.g. a removed device id)
 *   SecurityError         capture is disabled for this document (permissions policy)
 *   AbortError            something else interrupted capture
 *   NotSupportedError     capture isn't supported in this context
 * Screen capture (getDisplayMedia) uses NotAllowedError both when the user cancels the picker and when the
 * operating system blocks screen recording (Chromium: "Permission denied by system").
 *
 * Everything here is pure or takes the browser objects as parameters, so it's testable without a browser.
 */

export type DeviceKind = 'camera' | 'microphone';
/** 'unknown' = the browser can't tell us without asking (Permissions API missing or unsupported for this kind). */
export type PermissionStatus = 'unknown' | 'prompt' | 'granted' | 'denied';

export type DeviceIssueCode =
  | 'denied'            // refused: the user must allow it in the browser's site settings
  | 'dismissed'         // the prompt was closed without an answer: asking again works
  | 'not_found'         // no camera / microphone connected
  | 'in_use'            // another app or tab holds the device, or the OS refused to open it
  | 'overconstrained'   // the chosen device is gone or can't do what was asked
  | 'insecure_context'  // the page isn't served over HTTPS (or localhost)
  | 'policy_blocked'    // a permissions policy (e.g. an iframe without allow="camera") forbids capture
  | 'unsupported'       // this browser has no capture API
  | 'ended'             // the device stopped while in use (unplugged, revoked, taken by the OS)
  | 'unknown';

export interface DeviceIssue {
  code: DeviceIssueCode;
  message: string;
  /** Whether trying again (without changing browser settings) can succeed. */
  retryable: boolean;
}

const label = (kind: DeviceKind) => (kind === 'camera' ? 'camera' : 'microphone');
const Label = (kind: DeviceKind) => (kind === 'camera' ? 'Camera' : 'Microphone');

export function issueFor(code: DeviceIssueCode, kind: DeviceKind): DeviceIssue {
  const k = label(kind), K = Label(kind);
  switch (code) {
    case 'denied': return { code, retryable: false, message: `${K} access is blocked for this site. Allow it in your browser's site settings (the icon next to the address bar), then try again.` };
    case 'dismissed': return { code, retryable: true, message: `The ${k} permission prompt was closed. Try again and choose Allow.` };
    case 'not_found': return { code, retryable: true, message: `No ${k} was found. Connect one, then try again.` };
    case 'in_use': return { code, retryable: true, message: `Your ${k} couldn't be started. Another app or browser tab may be using it; close it and try again.` };
    case 'overconstrained': return { code, retryable: true, message: `The selected ${k} isn't available any more. Choose another one or try again.` };
    case 'insecure_context': return { code, retryable: false, message: `The browser only allows the ${k} on secure (HTTPS) pages.` };
    case 'policy_blocked': return { code, retryable: false, message: `This page isn't allowed to use the ${k} (blocked by the site's permissions policy).` };
    case 'unsupported': return { code, retryable: false, message: `This browser can't use a ${k} here.` };
    case 'ended': return { code, retryable: true, message: `Your ${k} stopped (it may have been unplugged or taken by another app).` };
    default: return { code: 'unknown', retryable: true, message: `Your ${k} couldn't be started. Try again.` };
  }
}

/** Maps a getUserMedia / LiveKit capture error to an issue the UI can show. */
export function classifyCaptureError(err: unknown, kind: DeviceKind): DeviceIssue {
  const e = err as { name?: string; message?: string } | null;
  const name = e?.name || '';
  const message = (e?.message || '').toLowerCase();
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return issueFor(/dismiss/.test(message) ? 'dismissed' : 'denied', kind);
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return issueFor('not_found', kind);
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') return issueFor('in_use', kind);
  if (name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError') return issueFor('overconstrained', kind);
  if (name === 'SecurityError') return issueFor('policy_blocked', kind);
  if (name === 'NotSupportedError' || (name === 'TypeError' && /getusermedia|mediadevices/.test(message))) return issueFor('unsupported', kind);
  return issueFor('unknown', kind);
}

export type ScreenShareIssueCode = 'cancelled' | 'denied_by_system' | 'unsupported' | 'in_use' | 'policy_blocked' | 'unknown';
export interface ScreenShareIssue {
  code: ScreenShareIssueCode;
  message: string;
  /** Cancelling the picker is a choice, not an error: the UI shouldn't show an alert for it. */
  quiet: boolean;
}

export function classifyScreenShareError(err: unknown): ScreenShareIssue {
  const e = err as { name?: string; message?: string } | null;
  const name = e?.name || '';
  const message = (e?.message || '').toLowerCase();
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    if (/system/.test(message)) {
      return { code: 'denied_by_system', quiet: false, message: 'Your operating system blocked screen sharing. Allow screen recording for this browser in your system settings (on macOS: Privacy & Security, Screen Recording), restart the browser, then try again.' };
    }
    return { code: 'cancelled', quiet: true, message: 'Screen sharing was cancelled.' };
  }
  if (name === 'NotReadableError' || name === 'AbortError') return { code: 'in_use', quiet: false, message: 'The screen couldn\'t be captured. Try again, or choose a different window or tab.' };
  if (name === 'SecurityError') return { code: 'policy_blocked', quiet: false, message: 'This page isn\'t allowed to share the screen (blocked by the site\'s permissions policy).' };
  if (name === 'NotSupportedError' || (name === 'TypeError' && /getdisplaymedia/.test(message))) {
    return { code: 'unsupported', quiet: false, message: 'This browser can\'t share the screen. Use a desktop browser such as Chrome, Edge, Firefox or Safari.' };
  }
  return { code: 'unknown', quiet: false, message: 'Screen sharing couldn\'t start. Try again.' };
}

/** What the browser environment allows before we ask for anything. */
export interface CaptureEnvironment {
  secure: boolean;
  camera: boolean;       // getUserMedia exists and the permissions policy doesn't forbid the camera
  microphone: boolean;
  screen: boolean;       // getDisplayMedia exists (desktop browsers; not iOS/Android browsers)
  blockedBy: { camera: DeviceIssueCode | null; microphone: DeviceIssueCode | null };
}

interface PolicyLike { allowsFeature?: (feature: string) => boolean }

export function captureEnvironment(win: { isSecureContext?: boolean; navigator?: Navigator; document?: Document } | undefined): CaptureEnvironment {
  const nav = win?.navigator as (Navigator & { mediaDevices?: MediaDevices }) | undefined;
  const secure = win?.isSecureContext !== false;
  const hasGum = !!nav?.mediaDevices && typeof nav.mediaDevices.getUserMedia === 'function';
  const hasDisplay = !!nav?.mediaDevices && typeof (nav.mediaDevices as MediaDevices & { getDisplayMedia?: unknown }).getDisplayMedia === 'function';
  const doc = win?.document as (Document & { permissionsPolicy?: PolicyLike; featurePolicy?: PolicyLike }) | undefined;
  const policy = doc?.permissionsPolicy ?? doc?.featurePolicy;
  const allows = (f: string) => { try { return policy?.allowsFeature ? policy.allowsFeature(f) : true; } catch { return true; } };
  const block = (feature: string): DeviceIssueCode | null => (!secure ? 'insecure_context' : !hasGum ? 'unsupported' : !allows(feature) ? 'policy_blocked' : null);
  const cam = block('camera'), mic = block('microphone');
  return { secure, camera: cam === null, microphone: mic === null, screen: secure && hasDisplay && allows('display-capture'), blockedBy: { camera: cam, microphone: mic } };
}

type PermissionsLike = { query: (d: { name: string }) => Promise<{ state: string; onchange: ((this: unknown, ev: Event) => unknown) | null; addEventListener?: (t: string, f: () => void) => void; removeEventListener?: (t: string, f: () => void) => void }> };

/**
 * The current permission without prompting. 'camera'/'microphone' queries work in Chromium and Safari 16+,
 * and in Firefox from version 131; elsewhere this answers 'unknown' and the UI shows "Turn on" (which asks).
 */
export async function queryPermission(kind: DeviceKind, nav: { permissions?: PermissionsLike } | undefined): Promise<PermissionStatus> {
  try {
    const status = await nav?.permissions?.query({ name: kind });
    const s = status?.state;
    return s === 'granted' || s === 'denied' || s === 'prompt' ? s : 'unknown';
  } catch {
    return 'unknown';
  }
}

/** Calls `onChange` when the permission changes (e.g. revoked in site settings mid-meeting). Returns an unsubscribe. */
export async function watchPermission(kind: DeviceKind, nav: { permissions?: PermissionsLike } | undefined, onChange: (s: PermissionStatus) => void): Promise<() => void> {
  try {
    const status = await nav?.permissions?.query({ name: kind });
    if (!status) return () => {};
    const handler = () => { const s = status.state; onChange(s === 'granted' || s === 'denied' || s === 'prompt' ? s : 'unknown'); };
    if (status.addEventListener && status.removeEventListener) {
      status.addEventListener('change', handler);
      return () => status.removeEventListener!('change', handler);
    }
    status.onchange = handler;
    return () => { if (status.onchange === handler) status.onchange = null; };
  } catch {
    return () => {};
  }
}
