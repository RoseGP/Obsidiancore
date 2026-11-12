// Native unit tests for the media analysis kernels (no framework: plain asserts, non-zero exit on failure).
// Build and run: cmake -S native/media-analysis -B build/media-analysis && cmake --build build/media-analysis && ctest --test-dir build/media-analysis
#include <cmath>
#include <cstdio>
#include <cstring>

#include "../include/media_analysis.h"

static int g_failures = 0;
static int g_passed = 0;

#define CHECK(cond, msg)                                              \
  do {                                                                \
    if (cond) { ++g_passed; std::printf("  ok  %s\n", msg); }         \
    else { ++g_failures; std::printf("  FAIL %s (%s:%d)\n", msg, __FILE__, __LINE__); } \
  } while (0)

static void fill_solid(int w, int h, unsigned char r, unsigned char g, unsigned char b) {
  unsigned char* px = ma_rgba_buffer();
  for (int i = 0; i < w * h; ++i) { px[i * 4] = r; px[i * 4 + 1] = g; px[i * 4 + 2] = b; px[i * 4 + 3] = 255; }
}

static void fill_checker(int w, int h, int cell) {
  unsigned char* px = ma_rgba_buffer();
  for (int y = 0; y < h; ++y)
    for (int x = 0; x < w; ++x) {
      const unsigned char v = (((x / cell) + (y / cell)) % 2) ? 230 : 25;
      unsigned char* p = px + (y * w + x) * 4;
      p[0] = p[1] = p[2] = v; p[3] = 255;
    }
}

static void fill_gradient(int w, int h) {
  unsigned char* px = ma_rgba_buffer();
  for (int y = 0; y < h; ++y)
    for (int x = 0; x < w; ++x) {
      const unsigned char v = (unsigned char)(40 + (x * 170) / (w - 1));
      unsigned char* p = px + (y * w + x) * 4;
      p[0] = p[1] = p[2] = v; p[3] = 255;
    }
}

static void test_frames() {
  const float* r = ma_frame_result();

  CHECK(ma_analyze_frame(2, 2) == -1, "rejects frames smaller than 3x3");
  CHECK(ma_analyze_frame(MA_MAX_WIDTH + 1, 10) == -1, "rejects frames wider than the buffer");
  CHECK(ma_rgba_capacity() == MA_MAX_WIDTH * MA_MAX_HEIGHT * 4, "RGBA capacity matches the declared maximum");

  fill_solid(160, 120, 0, 0, 0);
  CHECK(ma_analyze_frame(160, 120) == 0, "analyzes a 160x120 frame");
  CHECK(r[MA_FRAME_MEAN_LUMA] == 0.0f && r[MA_FRAME_DARK_FRACTION] == 1.0f, "black frame: mean 0, all pixels dark");
  CHECK(r[MA_FRAME_SHARPNESS] == 0.0f && r[MA_FRAME_STDDEV_LUMA] == 0.0f, "black frame: no contrast, no edges");

  fill_solid(160, 120, 255, 255, 255);
  ma_analyze_frame(160, 120);
  CHECK(r[MA_FRAME_CLIPPED_FRACTION] == 1.0f && r[MA_FRAME_MEAN_LUMA] >= 254.0f, "white frame: every pixel clipped");

  // BT.601 weights: pure green is brighter than pure red, which is brighter than pure blue.
  fill_solid(16, 16, 0, 255, 0); ma_analyze_frame(16, 16); const float g = r[MA_FRAME_MEAN_LUMA];
  fill_solid(16, 16, 255, 0, 0); ma_analyze_frame(16, 16); const float red = r[MA_FRAME_MEAN_LUMA];
  fill_solid(16, 16, 0, 0, 255); ma_analyze_frame(16, 16); const float b = r[MA_FRAME_MEAN_LUMA];
  CHECK(std::fabs(g - 149.0f) <= 1.0f && std::fabs(red - 76.0f) <= 1.0f && std::fabs(b - 28.0f) <= 1.0f, "luma uses BT.601 weights");

  fill_checker(160, 120, 4);
  ma_analyze_frame(160, 120);
  const float sharp = r[MA_FRAME_SHARPNESS];
  CHECK(std::fabs(r[MA_FRAME_MEAN_LUMA] - 127.5f) < 1.0f, "checkerboard: mean is mid-grey");
  CHECK(r[MA_FRAME_STDDEV_LUMA] > 100.0f, "checkerboard: high contrast");

  fill_gradient(160, 120);
  ma_analyze_frame(160, 120);
  const float soft = r[MA_FRAME_SHARPNESS];
  CHECK(sharp > 1000.0f && soft < 5.0f && sharp > soft * 100.0f, "sharp edges score far higher than a smooth gradient");
}

static void fill_sine(int n, float amp, float cycles_per_sample) {
  float* a = ma_audio_buffer();
  for (int i = 0; i < n; ++i) a[i] = amp * std::sin(2.0f * 3.14159265f * cycles_per_sample * i);
}

static void test_audio() {
  const float* r = ma_audio_result();
  ma_audio_reset();

  CHECK(ma_analyze_audio(1) == -1 && ma_analyze_audio(MA_MAX_AUDIO + 1) == -1, "rejects invalid block sizes");

  std::memset(ma_audio_buffer(), 0, sizeof(float) * 2048);
  CHECK(ma_analyze_audio(2048) == 0, "analyzes a 2048-sample block");
  CHECK(r[MA_AUDIO_RMS] == 0.0f && r[MA_AUDIO_PEAK] == 0.0f && r[MA_AUDIO_SPEECH_LIKELY] == 0.0f, "silence: zero level, no speech");
  CHECK(r[MA_AUDIO_NOISE_FLOOR] > 0.0f, "noise floor never collapses to zero");

  // Quiet background, then a louder voice-band tone: the floor stays low and the tone counts as speech-like.
  ma_audio_reset();
  for (int k = 0; k < 20; ++k) { fill_sine(2048, 0.002f, 0.07f); ma_analyze_audio(2048); }
  const float floor_quiet = r[MA_AUDIO_NOISE_FLOOR];
  fill_sine(2048, 0.3f, 0.02f);  // ~960 Hz at 48 kHz
  ma_analyze_audio(2048);
  CHECK(std::fabs(r[MA_AUDIO_RMS] - 0.3f / std::sqrt(2.0f)) < 0.005f, "sine RMS is amplitude/sqrt(2)");
  CHECK(std::fabs(r[MA_AUDIO_PEAK] - 0.3f) < 0.002f, "peak matches amplitude");
  CHECK(r[MA_AUDIO_SPEECH_LIKELY] == 1.0f, "a loud voice-band block over a quiet floor is speech-like");
  CHECK(r[MA_AUDIO_NOISE_FLOOR] < floor_quiet * 1.05f, "one loud block barely raises the floor");
  CHECK(std::fabs(r[MA_AUDIO_ZERO_CROSSING] - 0.04f) < 0.005f, "zero-crossing rate is twice the frequency in cycles/sample");

  // Clipping: a square wave at full scale.
  float* a = ma_audio_buffer();
  for (int i = 0; i < 1000; ++i) a[i] = (i / 10) % 2 ? 1.0f : -1.0f;
  ma_analyze_audio(1000);
  CHECK(r[MA_AUDIO_CLIP_FRACTION] == 1.0f, "full-scale samples count as clipped");

  // A sustained louder background is eventually accepted as the floor (so it stops reading as speech).
  ma_audio_reset();
  for (int k = 0; k < 400; ++k) { fill_sine(1024, 0.05f, 0.02f); ma_analyze_audio(1024); }
  CHECK(r[MA_AUDIO_SPEECH_LIKELY] == 0.0f, "a steady background stops reading as speech once the floor adapts");
}

int main() {
  std::printf("media analysis (ABI %d)\n", ma_abi_version());
  test_frames();
  test_audio();
  std::printf("\n%d passed, %d failed\n", g_passed, g_failures);
  return g_failures == 0 ? 0 : 1;
}
