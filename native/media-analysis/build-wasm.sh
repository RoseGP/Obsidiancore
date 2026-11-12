#!/usr/bin/env bash
# Builds public/wasm/media_analysis.wasm from src/media_analysis.cpp with plain clang + wasm-ld (no Emscripten:
# the module is freestanding, with no libc and no allocation). Requires clang >= 13 with the wasm32 target and lld.
#
#   npm run build:wasm            (from the repository root)
#   CXX=clang++-18 npm run build:wasm
#
# The built module is committed so the app builds without a C++ toolchain; rebuild it after changing the C++.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/../.." && pwd)"
out="$root/public/wasm/media_analysis.wasm"
CXX="${CXX:-clang++}"

if ! "$CXX" -print-targets 2>/dev/null | grep -q wasm32; then
  echo "error: $CXX has no wasm32 target. Install clang (>= 13) and lld, or set CXX." >&2
  exit 1
fi

mkdir -p "$(dirname "$out")"
"$CXX" --target=wasm32 -std=c++17 -O3 -flto \
  -nostdlib -fno-exceptions -fno-rtti -fvisibility=hidden \
  -Wall -Wextra -Werror \
  -Wl,--no-entry -Wl,--strip-all -Wl,--lto-O3 \
  -Wl,--initial-memory=1048576 -Wl,--max-memory=1048576 \
  -o "$out" "$here/src/media_analysis.cpp"

echo "built $out ($(wc -c < "$out") bytes)"
