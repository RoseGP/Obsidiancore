/*
 * Media analysis kernels for the meeting pre-join check (camera and microphone quality hints).
 *
 * Analysis only: these functions read copies of local preview frames and microphone samples and report
 * measurements. They never modify, filter or re-encode media, and nothing here is on the send path to
 * LiveKit, so they add no latency to the call and can be skipped entirely.
 *
 * The same source builds two ways:
 *   - WebAssembly (freestanding: no libc, no allocation, static buffers) for the browser, see build-wasm.sh;
 *   - native (any C++17 compiler) for the unit tests, see CMakeLists.txt.
 *
 * ABI (C linkage, all sizes in elements):
 *   ma_abi_version()                      → 1
 *   ma_rgba_buffer(), ma_rgba_capacity()  → caller writes RGBA8 pixels (width*height*4 bytes) here
 *   ma_analyze_frame(width, height)       → 0 ok, -1 invalid size; results in ma_frame_result()[0..MA_FRAME_FIELDS)
 *   ma_audio_buffer(), ma_audio_capacity()→ caller writes mono float32 samples in [-1, 1] here
 *   ma_analyze_audio(count)               → 0 ok, -1 invalid count; results in ma_audio_result()[0..MA_AUDIO_FIELDS)
 *   ma_audio_reset()                      → forget the noise-floor history (new device or new session)
 */
#ifndef OBSIDIAN_MEDIA_ANALYSIS_H
#define OBSIDIAN_MEDIA_ANALYSIS_H

#ifdef __cplusplus
extern "C" {
#endif

/* Largest frame accepted: the browser samples at 160x120; 320x240 leaves headroom. */
#define MA_MAX_WIDTH 320
#define MA_MAX_HEIGHT 240
/* Largest audio block accepted (an AnalyserNode with fftSize 8192 at most). */
#define MA_MAX_AUDIO 8192

/* ma_frame_result() layout */
#define MA_FRAME_MEAN_LUMA 0       /* 0..255, BT.601 luma */
#define MA_FRAME_STDDEV_LUMA 1     /* 0..~128, global contrast */
#define MA_FRAME_DARK_FRACTION 2   /* share of pixels with luma < 24 */
#define MA_FRAME_CLIPPED_FRACTION 3/* share of pixels with luma >= 250 */
#define MA_FRAME_SHARPNESS 4       /* variance of the 3x3 Laplacian over the luma plane */
#define MA_FRAME_FIELDS 5

/* ma_audio_result() layout */
#define MA_AUDIO_RMS 0             /* linear, 0..1 */
#define MA_AUDIO_PEAK 1            /* linear, 0..1 */
#define MA_AUDIO_CLIP_FRACTION 2   /* share of samples with |x| >= 0.999 */
#define MA_AUDIO_ZERO_CROSSING 3   /* zero crossings per sample, 0..1 */
#define MA_AUDIO_NOISE_FLOOR 4     /* tracked background level (linear RMS) */
#define MA_AUDIO_SPEECH_LIKELY 5   /* 1 when the block is well above the noise floor with a voice-like ZCR, else 0 */
#define MA_AUDIO_FIELDS 6

int ma_abi_version(void);

unsigned char* ma_rgba_buffer(void);
int ma_rgba_capacity(void);
int ma_analyze_frame(int width, int height);
const float* ma_frame_result(void);

float* ma_audio_buffer(void);
int ma_audio_capacity(void);
int ma_analyze_audio(int count);
const float* ma_audio_result(void);
void ma_audio_reset(void);

#ifdef __cplusplus
}
#endif

#endif /* OBSIDIAN_MEDIA_ANALYSIS_H */
