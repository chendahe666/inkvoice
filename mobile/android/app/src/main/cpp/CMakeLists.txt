cmake_minimum_required(VERSION 3.22.1)
project(inkvoice_keyboard LANGUAGES C CXX)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)
# A single optimized ggml compile can be large. Keep native jobs sequential so
# Gradle/Kotlin and two concurrent clang processes do not exhaust host memory.
set_property(GLOBAL PROPERTY JOB_POOLS native_compile=1 native_link=1)
set(CMAKE_JOB_POOL_COMPILE native_compile)
set(CMAKE_JOB_POOL_LINK native_link)
# The speech core must remain optimized even in a debuggable application.
set(CMAKE_C_FLAGS_DEBUG "-O2 -g")
set(CMAKE_CXX_FLAGS_DEBUG "-O2 -g")
set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
set(WHISPER_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(WHISPER_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(WHISPER_BUILD_SERVER OFF CACHE BOOL "" FORCE)
set(GGML_NATIVE OFF CACHE BOOL "" FORCE)
set(GGML_OPENMP OFF CACHE BOOL "" FORCE)
set(GGML_METAL OFF CACHE BOOL "" FORCE)
set(GGML_CUDA OFF CACHE BOOL "" FORCE)
set(GGML_VULKAN OFF CACHE BOOL "" FORCE)
set(GGML_CPU_KLEIDIAI OFF CACHE BOOL "" FORCE)
set(GGML_CCACHE OFF CACHE BOOL "" FORCE)
# Apply before FetchContent so upstream ggml/whisper targets inherit the same
# path policy. Quoted options keep Windows workspace paths with spaces intact.
# This covers debug info, __FILE__, and compiler-generated source locations.
add_compile_options(
    "-ffile-prefix-map=${CMAKE_SOURCE_DIR}=/inkvoice/android/src"
    "-ffile-prefix-map=${CMAKE_BINARY_DIR}=/inkvoice/android/build"
    "-fmacro-prefix-map=${CMAKE_SOURCE_DIR}=/inkvoice/android/src"
    "-fmacro-prefix-map=${CMAKE_BINARY_DIR}=/inkvoice/android/build"
    "-fdebug-compilation-dir=/inkvoice/android/build")
include(FetchContent)
# Same fixed upstream source revision as InkVoice desktop's pinned CPU release.
FetchContent_Declare(whisper_core
    URL "https://codeload.github.com/ggml-org/whisper.cpp/tar.gz/d1be6fde11ac6e0407606b4e42fe72d34add8037"
    URL_HASH SHA256=645445da884df6dbd52b30f82d7be7c01d1767c938714e477e786b88d529e9f4)
FetchContent_MakeAvailable(whisper_core)
add_library(inkvoice_whisper SHARED whisper_jni.cpp)
target_link_libraries(inkvoice_whisper PRIVATE whisper log android)
target_compile_options(inkvoice_whisper PRIVATE -Wall -Wextra)
