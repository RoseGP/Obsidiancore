// Media analysis kernels (see include/media_analysis.h for the ABI and the guarantees).
//
// Freestanding on purpose: no libc, no heap, no exceptions, so it compiles to a small WebAssembly module with
// plain clang (--target=wasm32 -nostdlib) and also builds natively for tests. All state lives in fixed static
// buffers; one caller at a time (the browser runs it on the main thread at about 1 frame/s and a few audio
// blocks/s, which costs well under a millisecond per call).
#include "../include/media_analysis.h"

#if defined(__wasm__)
#define MA_EXPORT(name) __attribute__((export_name(name)))
#else
#define MA_EXPORT(name)
#endif

namespace {

unsigned char g_rgba[MA_MAX_WIDTH * MA_MAX_HEIGHT * 4];
unsigned char g_luma[MA_MAX_WIDTH * MA_MAX_HEIGHT];
float g_frame_result[MA_FRAME_FIELDS];

float g_audio[MA_MAX_AUDIO];
float g_audio_result[MA_AUDIO_FIELDS];
float g_noise_floor = -1.0f;  // < 0 = no history yet

inline double ma_sqrt(double v) { return v > 0.0 ? __builtin_sqrt(v) : 0.0; }
inline float ma_abs(float v) { return v < 0.0f ? -v : v; }

// Noise-floor tracker (minimum statistics, simplified): falls quickly to quieter blocks, rises slowly so a
// sustained louder background is eventually accepted as the new floor while speech bursts are not.
constexpr float kFloorFall = 0.3f;   // weight of a quieter block
constexpr float kFloorRise = 1.02f;  // +2% per block when the block is louder
constexpr float kFloorMin = 1e-5f;   // about -100 dBFS
// "Speech likely": at least ~12 dB above the floor, above ~-50 dBFS, voice-like zero-crossing rate.
constexpr float kSpeechOverFloor = 4.0f;
constexpr float kSpeechMinRms = 0.003f;
constexpr float kZcrMin = 0.01f;
constexpr float kZcrMax = 0.35f;

}  // namespace

extern "C" {

MA_EXPORT("ma_abi_version") int ma_abi_version(void) { return 1; }

MA_EXPORT("ma_rgba_buffer") unsigned char* ma_rgba_buffer(void) { return g_rgba; }
MA_EXPORT("ma_rgba_capacity") int ma_rgba_capacity(void) { return (int)sizeof(g_rgba); }
MA_EXPORT("ma_frame_result") const float* ma_frame_result(void) { return g_frame_result; }

MA_EXPORT("ma_analyze_frame") int ma_analyze_frame(int width, int height) {
  if (width < 3 || height < 3 || width > MA_MAX_WIDTH || height > MA_MAX_HEIGHT) return -1;
  const int n = width * height;

  // RGBA → BT.601 luma (integer weights 77/150/29 sum to 256), with exposure statistics.
  unsigned long long sum = 0, sum_sq = 0;
  int dark = 0, clipped = 0;
  for (int i = 0; i < n; ++i) {
    const unsigned char* p = g_rgba + i * 4;
    const unsigned int y = (77u * p[0] + 150u * p[1] + 29u * p[2]) >> 8;
    g_luma[i] = (unsigned char)y;
    sum += y;
    sum_sq += (unsigned long long)y * y;
    if (y < 24) ++dark;
    if (y >= 250) ++clipped;
  }
  const double mean = (double)sum / n;
  const double var = (double)sum_sq / n - mean * mean;

  // Sharpness: variance of the 4-neighbour Laplacian over interior pixels. Focused, detailed images have
  // strong edges (high variance); blurred or covered lenses have low variance.
  double lap_sum = 0.0, lap_sq = 0.0;
  int count = 0;
  for (int y = 1; y < height - 1; ++y) {
    const unsigned char* row = g_luma + y * width;
    for (int x = 1; x < width - 1; ++x) {
      const int c = row[x];
      const int l = 4 * c - row[x - 1] - row[x + 1] - row[x - width] - row[x + width];
      lap_sum += l;
      lap_sq += (double)l * l;
      ++count;
    }
  }
  const double lap_mean = lap_sum / count;
  const double lap_var = lap_sq / count - lap_mean * lap_mean;

  g_frame_result[MA_FRAME_MEAN_LUMA] = (float)mean;
  g_frame_result[MA_FRAME_STDDEV_LUMA] = (float)ma_sqrt(var);
  g_frame_result[MA_FRAME_DARK_FRACTION] = (float)dark / n;
  g_frame_result[MA_FRAME_CLIPPED_FRACTION] = (float)clipped / n;
  g_frame_result[MA_FRAME_SHARPNESS] = (float)(lap_var > 0.0 ? lap_var : 0.0);
  return 0;
}

MA_EXPORT("ma_audio_buffer") float* ma_audio_buffer(void) { return g_audio; }
MA_EXPORT("ma_audio_capacity") int ma_audio_capacity(void) { return MA_MAX_AUDIO; }
MA_EXPORT("ma_audio_result") const float* ma_audio_result(void) { return g_audio_result; }
MA_EXPORT("ma_audio_reset") void ma_audio_reset(void) { g_noise_floor = -1.0f; }

MA_EXPORT("ma_analyze_audio") int ma_analyze_audio(int count) {
  if (count < 2 || count > MA_MAX_AUDIO) return -1;
  double sum_sq = 0.0;
  float peak = 0.0f;
  int clipped = 0, crossings = 0;
  for (int i = 0; i < count; ++i) {
    const float s = g_audio[i];
    const float a = ma_abs(s);
    sum_sq += (double)s * s;
    if (a > peak) peak = a;
    if (a >= 0.999f) ++clipped;
    if (i > 0 && ((s >= 0.0f) != (g_audio[i - 1] >= 0.0f))) ++crossings;
  }
  const float rms = (float)ma_sqrt(sum_sq / count);
  const float zcr = (float)crossings / (count - 1);

  if (g_noise_floor < 0.0f) g_noise_floor = rms;
  else if (rms < g_noise_floor) g_noise_floor = g_noise_floor * (1.0f - kFloorFall) + rms * kFloorFall;
  else g_noise_floor *= kFloorRise;
  if (g_noise_floor < kFloorMin) g_noise_floor = kFloorMin;

  const bool speech = rms > g_noise_floor * kSpeechOverFloor && rms > kSpeechMinRms && zcr >= kZcrMin && zcr <= kZcrMax;

  g_audio_result[MA_AUDIO_RMS] = rms;
  g_audio_result[MA_AUDIO_PEAK] = peak;
  g_audio_result[MA_AUDIO_CLIP_FRACTION] = (float)clipped / count;
  g_audio_result[MA_AUDIO_ZERO_CROSSING] = zcr;
  g_audio_result[MA_AUDIO_NOISE_FLOOR] = g_noise_floor;
  g_audio_result[MA_AUDIO_SPEECH_LIKELY] = speech ? 1.0f : 0.0f;
  return 0;
}

}  // extern "C"
