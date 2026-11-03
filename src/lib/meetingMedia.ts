/**
 * Media-track helpers for the meeting (kept apart from UI and meeting state).
 * Everything is best-effort: constraints a browser or device doesn't support
 * are skipped and reported back instead of throwing.
 */

export type VideoQuality = '1080p' | '720p' | '480p' | '360p';

export const VIDEO_PRESETS: Record<VideoQuality, { width: number; height: number; frameRate: number }> = {
  '1080p': { width: 1920, height: 1080, frameRate: 30 },
  '720p': { width: 1280, height: 720, frameRate: 30 },
  '480p': { width: 854, height: 480, frameRate: 24 },
  '360p': { width: 640, height: 360, frameRate: 24 },
};
/** Low-bandwidth mode: small, slow video. */
export const LOW_BANDWIDTH_VIDEO = { width: 320, height: 180, frameRate: 12 };

export async function applyVideoQuality(stream: MediaStream | null, quality: VideoQuality, lowBandwidth = false): Promise<boolean> {
  const track = stream?.getVideoTracks()[0];
  if (!track || track.readyState !== 'live') return false;
  const p = lowBandwidth ? LOW_BANDWIDTH_VIDEO : VIDEO_PRESETS[quality];
  try {
    await track.applyConstraints({ width: { ideal: p.width }, height: { ideal: p.height }, frameRate: { ideal: p.frameRate, max: p.frameRate } });
    return true;
  } catch { return false; }
}

export async function applyAudioProcessing(stream: MediaStream | null, opts: { noiseSuppression?: boolean; echoCancellation?: boolean }): Promise<boolean> {
  const track = stream?.getAudioTracks()[0];
  if (!track || track.readyState !== 'live') return false;
  const c: MediaTrackConstraints = {};
  if (opts.noiseSuppression !== undefined) c.noiseSuppression = opts.noiseSuppression;
  if (opts.echoCancellation !== undefined) c.echoCancellation = opts.echoCancellation;
  try { await track.applyConstraints(c); return true; } catch { return false; }
}

/** Platform background blur (Chrome on supported OS/cameras exposes `backgroundBlur`). */
export function supportsBackgroundBlur(stream: MediaStream | null): boolean {
  const track = stream?.getVideoTracks()[0] as (MediaStreamTrack & { getCapabilities?: () => any }) | undefined;
  try { return Boolean(track?.getCapabilities?.()?.backgroundBlur); } catch { return false; }
}

export async function setBackgroundBlur(stream: MediaStream | null, on: boolean): Promise<boolean> {
  const track = stream?.getVideoTracks()[0];
  if (!track || !supportsBackgroundBlur(stream)) return false;
  try { await track.applyConstraints({ backgroundBlur: on } as MediaTrackConstraints); return true; } catch { return false; }
}

/** CSS filters for the appearance presets (applied to your own video). */
export const VIDEO_FILTERS = {
  none: { label: 'Natural', css: 'none' },
  warm: { label: 'Warm', css: 'sepia(0.18) saturate(1.15) brightness(1.03)' },
  cool: { label: 'Cool', css: 'hue-rotate(-8deg) saturate(0.95) brightness(1.02)' },
  bright: { label: 'Bright', css: 'brightness(1.15) contrast(1.05)' },
  mono: { label: 'Mono', css: 'grayscale(1) contrast(1.05)' },
  soft: { label: 'Soft focus', css: 'blur(0.6px) brightness(1.04)' },
} as const;
export type VideoFilterId = keyof typeof VIDEO_FILTERS;

export async function enterPictureInPicture(video: HTMLVideoElement | null): Promise<'ok' | 'unsupported' | 'no-video' | 'failed'> {
  if (typeof document === 'undefined' || !(document as any).pictureInPictureEnabled) return 'unsupported';
  if (!video || !video.srcObject) return 'no-video';
  try {
    if (document.pictureInPictureElement) await document.exitPictureInPicture();
    else await video.requestPictureInPicture();
    return 'ok';
  } catch { return 'failed'; }
}
