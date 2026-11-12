/**
 * Turns measurements from the C++ analysis module into plain-language pre-join hints. Pure functions so the
 * thresholds are easy to test and tune. The hints are advice only: nothing is changed in the media.
 *
 * Thresholds assume frames sampled at 160x120 (MediaQualityProbe) and microphone blocks of ~2048 samples.
 */
import type { AudioMetrics, FrameMetrics } from './wasmAnalyzer';

export interface QualityHint { id: string; tone: 'ok' | 'warning'; text: string }

export function frameHints(m: FrameMetrics | null): QualityHint[] {
  if (!m) return [];
  if (m.stddevLuma < 6 && m.meanLuma < 20) return [{ id: 'covered', tone: 'warning', text: 'Your camera image is black. Is the lens covered or the privacy shutter closed?' }];
  const out: QualityHint[] = [];
  if (m.meanLuma < 50 || m.darkFraction > 0.6) out.push({ id: 'dark', tone: 'warning', text: 'Your video looks dark. More light in front of you will help people see you.' });
  else if (m.clippedFraction > 0.25 || m.meanLuma > 220) out.push({ id: 'bright', tone: 'warning', text: 'Your video looks overexposed. Try facing away from a bright window or lamp.' });
  if (m.stddevLuma >= 6 && m.sharpness < 25) out.push({ id: 'blurry', tone: 'warning', text: 'Your video looks blurry. Check the camera focus or wipe the lens.' });
  if (out.length === 0) out.push({ id: 'video_ok', tone: 'ok', text: 'Lighting and focus look good.' });
  return out;
}

export const toDbfs = (linear: number) => (linear > 0 ? 20 * Math.log10(linear) : -Infinity);

/** Summary over the last few seconds of microphone blocks. */
export interface AudioWindow { blocks: number; maxPeak: number; clipBlocks: number; speechBlocks: number; noiseFloor: number }

export function accumulateAudio(w: AudioWindow | null, m: AudioMetrics, maxBlocks = 40): AudioWindow {
  const base = w && w.blocks < maxBlocks ? w : { blocks: 0, maxPeak: 0, clipBlocks: 0, speechBlocks: 0, noiseFloor: m.noiseFloor };
  return {
    blocks: base.blocks + 1,
    maxPeak: Math.max(base.maxPeak, m.peak),
    clipBlocks: base.clipBlocks + (m.clipFraction > 0.001 ? 1 : 0),
    speechBlocks: base.speechBlocks + (m.speechLikely ? 1 : 0),
    noiseFloor: m.noiseFloor,
  };
}

export function audioHints(w: AudioWindow | null, minBlocks = 12): QualityHint[] {
  if (!w || w.blocks < minBlocks) return [];
  if (w.maxPeak < 0.001) return [{ id: 'silent', tone: 'warning', text: 'No sound is reaching the microphone. Check that the right microphone is selected and not muted on the device.' }];
  const out: QualityHint[] = [];
  if (w.clipBlocks / w.blocks > 0.1) out.push({ id: 'clipping', tone: 'warning', text: 'Your microphone is distorting. Lower its input volume or move it further away.' });
  if (toDbfs(w.noiseFloor) > -45) out.push({ id: 'noisy', tone: 'warning', text: 'There\'s a lot of background noise. A quieter room or a headset will help.' });
  if (w.speechBlocks > 0 && out.length === 0) out.push({ id: 'audio_ok', tone: 'ok', text: 'Your microphone sounds clear.' });
  if (w.speechBlocks === 0 && out.length === 0) out.push({ id: 'say_something', tone: 'ok', text: 'Say something to check your microphone.' });
  return out;
}
