/**
 * Loader for the optional C++ media analysis module (native/media-analysis → public/wasm/media_analysis.wasm).
 *
 * The module is freestanding WebAssembly with no imports: we copy pixels/samples into its static buffers and
 * read results back. If the file is missing, can't be compiled, or has another ABI version, loading resolves to
 * null and the meeting works exactly the same without camera/microphone hints.
 */

export const MEDIA_ANALYSIS_ABI = 1;
export const MEDIA_ANALYSIS_URL = '/wasm/media_analysis.wasm';

export interface FrameMetrics {
  meanLuma: number;        // 0..255
  stddevLuma: number;      // contrast
  darkFraction: number;    // share of pixels with luma < 24
  clippedFraction: number; // share of pixels with luma >= 250
  sharpness: number;       // variance of the Laplacian (at the analysis resolution)
}

export interface AudioMetrics {
  rms: number;             // linear 0..1
  peak: number;
  clipFraction: number;
  zeroCrossingRate: number;
  noiseFloor: number;      // linear RMS of the tracked background
  speechLikely: boolean;
}

export interface MediaAnalyzer {
  /** RGBA8 pixels, width*height*4 bytes; null if the size isn't accepted (max 320x240). */
  analyzeFrame(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number): FrameMetrics | null;
  /** Mono float samples in [-1, 1]; null if the block size isn't accepted (2..8192). */
  analyzeAudio(samples: Float32Array): AudioMetrics | null;
  resetAudio(): void;
}

interface Exports {
  memory: WebAssembly.Memory;
  ma_abi_version(): number;
  ma_rgba_buffer(): number;
  ma_rgba_capacity(): number;
  ma_analyze_frame(w: number, h: number): number;
  ma_frame_result(): number;
  ma_audio_buffer(): number;
  ma_audio_capacity(): number;
  ma_analyze_audio(n: number): number;
  ma_audio_result(): number;
  ma_audio_reset(): void;
}

const REQUIRED: Array<keyof Exports> = ['memory', 'ma_abi_version', 'ma_rgba_buffer', 'ma_rgba_capacity', 'ma_analyze_frame', 'ma_frame_result', 'ma_audio_buffer', 'ma_audio_capacity', 'ma_analyze_audio', 'ma_audio_result', 'ma_audio_reset'];

/** Wraps an instantiated module; throws if it isn't the expected ABI. */
export function wrapAnalyzer(exportsObj: WebAssembly.Exports): MediaAnalyzer {
  const ex = exportsObj as unknown as Exports;
  for (const k of REQUIRED) if (!(k in ex)) throw new Error(`media analysis module is missing ${k}`);
  if (ex.ma_abi_version() !== MEDIA_ANALYSIS_ABI) throw new Error(`media analysis ABI ${ex.ma_abi_version()} (expected ${MEDIA_ANALYSIS_ABI})`);
  const rgbaPtr = ex.ma_rgba_buffer(), rgbaCap = ex.ma_rgba_capacity();
  const audioPtr = ex.ma_audio_buffer(), audioCap = ex.ma_audio_capacity();
  const framePtr = ex.ma_frame_result(), audioResPtr = ex.ma_audio_result();
  return {
    analyzeFrame(rgba, width, height) {
      const bytes = width * height * 4;
      if (rgba.length < bytes || bytes > rgbaCap) return null;
      new Uint8Array(ex.memory.buffer, rgbaPtr, bytes).set(rgba.subarray(0, bytes));
      if (ex.ma_analyze_frame(width, height) !== 0) return null;
      const r = new Float32Array(ex.memory.buffer, framePtr, 5);
      return { meanLuma: r[0], stddevLuma: r[1], darkFraction: r[2], clippedFraction: r[3], sharpness: r[4] };
    },
    analyzeAudio(samples) {
      if (samples.length < 2 || samples.length > audioCap) return null;
      new Float32Array(ex.memory.buffer, audioPtr, samples.length).set(samples);
      if (ex.ma_analyze_audio(samples.length) !== 0) return null;
      const r = new Float32Array(ex.memory.buffer, audioResPtr, 6);
      return { rms: r[0], peak: r[1], clipFraction: r[2], zeroCrossingRate: r[3], noiseFloor: r[4], speechLikely: r[5] === 1 };
    },
    resetAudio() { ex.ma_audio_reset(); },
  };
}

export async function instantiateAnalyzer(bytes: BufferSource): Promise<MediaAnalyzer> {
  const { instance } = await WebAssembly.instantiate(bytes, {});
  return wrapAnalyzer(instance.exports);
}

let cached: Promise<MediaAnalyzer | null> | null = null;

/** Loads the module once per page; null when it isn't available (never throws). */
export function loadMediaAnalyzer(url = MEDIA_ANALYSIS_URL, fetchImpl: typeof fetch = (input, init) => fetch(input, init)): Promise<MediaAnalyzer | null> {
  if (cached) return cached;
  cached = (async () => {
    try {
      if (typeof WebAssembly === 'undefined') return null;
      const res = await fetchImpl(url);
      if (!res.ok) return null;
      return await instantiateAnalyzer(await res.arrayBuffer());
    } catch {
      return null;
    }
  })();
  return cached;
}

/** Tests only. */
export function resetMediaAnalyzerCache() { cached = null; }
