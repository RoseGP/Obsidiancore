/**
 * Samples the local camera and microphone preview for the C++ analysis module (pre-join only).
 *
 * Read-only taps, off the send path:
 * - video: once a second, the preview frame is drawn into a 160x120 canvas and its pixels are analyzed;
 * - audio: an AnalyserNode (not connected to any output) is read 5 times a second.
 * Nothing is modified, recorded or sent anywhere; everything stays in this tab. Cost is a 160x120 readback
 * per second and a 2048-sample copy every 200 ms (well under 1 ms of CPU each in the WebAssembly module).
 */
import { accumulateAudio, audioHints, frameHints, type AudioWindow, type QualityHint } from './qualityHints';
import type { MediaAnalyzer } from './wasmAnalyzer';

export interface ProbeResult { video: QualityHint[]; audio: QualityHint[] }

const FRAME_W = 160, FRAME_H = 120;

export class MediaQualityProbe {
  private videoEl: HTMLVideoElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private videoTimer: ReturnType<typeof setInterval> | null = null;
  private audioCtx: AudioContext | null = null;
  private audioSource: MediaStreamAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private audioTimer: ReturnType<typeof setInterval> | null = null;
  private audioWindow: AudioWindow | null = null;
  private result: ProbeResult = { video: [], audio: [] };
  private stopped = false;

  constructor(private analyzer: MediaAnalyzer, private onResult: (r: ProbeResult) => void) {}

  setVideoTrack(track: MediaStreamTrack | null) {
    this.stopVideo();
    if (!track || this.stopped || typeof document === 'undefined') return;
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.autoplay = true;
    v.srcObject = new MediaStream([track]);
    v.play().catch(() => { /* autoplay of a muted preview is allowed; ignore if not */ });
    this.videoEl = v;
    this.canvas = document.createElement('canvas');
    this.canvas.width = FRAME_W; this.canvas.height = FRAME_H;
    const ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) { this.stopVideo(); return; }
    this.videoTimer = setInterval(() => {
      if (!this.videoEl || this.videoEl.readyState < 2 || track.readyState !== 'live' || !track.enabled) return;
      ctx.drawImage(this.videoEl, 0, 0, FRAME_W, FRAME_H);
      const m = this.analyzer.analyzeFrame(ctx.getImageData(0, 0, FRAME_W, FRAME_H).data, FRAME_W, FRAME_H);
      this.result = { ...this.result, video: frameHints(m) };
      this.onResult(this.result);
    }, 1000);
  }

  setAudioTrack(track: MediaStreamTrack | null) {
    this.stopAudio();
    if (!track || this.stopped) return;
    const AC: typeof AudioContext | undefined = (globalThis as any).AudioContext || (globalThis as any).webkitAudioContext;
    if (!AC) return;
    try {
      this.audioCtx = new AC();
      this.audioSource = this.audioCtx.createMediaStreamSource(new MediaStream([track]));
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.audioSource.connect(this.analyser); // analysis only: never connected to the speakers or the call
    } catch { this.stopAudio(); return; }
    this.analyzer.resetAudio();
    const buf = new Float32Array(this.analyser.fftSize);
    this.audioTimer = setInterval(() => {
      if (!this.analyser || track.readyState !== 'live') return;
      this.analyser.getFloatTimeDomainData(buf);
      const m = this.analyzer.analyzeAudio(buf);
      if (!m) return;
      this.audioWindow = accumulateAudio(this.audioWindow, m);
      const hints = audioHints(this.audioWindow);
      if (hints.length) { this.result = { ...this.result, audio: hints }; this.onResult(this.result); }
    }, 200);
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.stopVideo();
    this.stopAudio();
  }

  private stopVideo() {
    if (this.videoTimer) clearInterval(this.videoTimer);
    this.videoTimer = null;
    if (this.videoEl) { this.videoEl.pause(); this.videoEl.srcObject = null; } // don't stop the track: it belongs to the preview
    this.videoEl = null;
    this.canvas = null;
    this.result = { ...this.result, video: [] };
  }

  private stopAudio() {
    if (this.audioTimer) clearInterval(this.audioTimer);
    this.audioTimer = null;
    try { this.audioSource?.disconnect(); } catch { /* ignore */ }
    this.audioSource = null;
    this.analyser = null;
    this.audioCtx?.close().catch(() => {});
    this.audioCtx = null;
    this.audioWindow = null;
    this.result = { ...this.result, audio: [] };
  }
}
