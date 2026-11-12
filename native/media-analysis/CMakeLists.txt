# Native build of the media analysis kernels, for unit tests (the browser uses the WebAssembly build:
# build-wasm.sh). Usage:
#   cmake -S native/media-analysis -B build/media-analysis
#   cmake --build build/media-analysis
#   ctest --test-dir build/media-analysis --output-on-failure
cmake_minimum_required(VERSION 3.16)
project(obsidian_media_analysis CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_library(media_analysis STATIC src/media_analysis.cpp)
target_include_directories(media_analysis PUBLIC include)
if(CMAKE_CXX_COMPILER_ID MATCHES "GNU|Clang")
  target_compile_options(media_analysis PRIVATE -Wall -Wextra -Wpedantic -Werror -fno-exceptions -fno-rtti)
endif()

enable_testing()
add_executable(media_analysis_test tests/media_analysis_test.cpp)
target_link_libraries(media_analysis_test PRIVATE media_analysis)
add_test(NAME media_analysis_test COMMAND media_analysis_test)
