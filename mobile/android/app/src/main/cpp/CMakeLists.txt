# Builds `libanatolia_llama.so`, the native library LlamaBridge.kt loads
# (System.loadLibrary("anatolia_llama")). NOT BUILT/VERIFIED IN THIS
# SANDBOX -- there is no Android NDK here. See the final report's Android
# follow-up for exact next steps.
#
# ---------------------------------------------------------------------------
# REQUIRED ONE-TIME SETUP BEFORE THIS BUILDS (Android Studio, on a real
# machine with the NDK installed):
#
#   1. Vendor llama.cpp's source as a sibling directory of this file, i.e.
#      mobile/android/app/src/main/cpp/llama.cpp/ , e.g. as a git submodule:
#        git submodule add https://github.com/ggml-org/llama.cpp \
#          mobile/android/app/src/main/cpp/llama.cpp
#        git -C mobile/android/app/src/main/cpp/llama.cpp checkout <pinned-tag>
#      Pin to a specific tagged release (not a moving branch) so a future
#      `git submodule update --remote` can't silently change the JNI ABI
#      this file's llama-android.cpp was written against. llama.cpp is MIT
#      licensed (github.com/ggml-org/llama.cpp/blob/master/LICENSE) --
#      compatible with this app's own licensing, no copyleft obligations.
#   2. Install the NDK (see mobile/android/app/build.gradle's comment on the
#      exact version this project's Gradle/AGP combination expects) via
#      Android Studio's SDK Manager -> SDK Tools -> NDK (side by side).
#   3. `./gradlew assembleDebug` from mobile/android/ will then invoke this
#      CMakeLists.txt automatically via the externalNativeBuild block added
#      to app/build.gradle.
#
# Why vendor-via-submodule instead of a prebuilt AAR: as of the research
# behind this change (2026-08-20), there is no actively maintained,
# permissively-licensed *plain Android AAR* for llama.cpp that this app can
# just add as a Gradle dependency -- the closest widely-used package,
# llama.rn (github.com/mybigday/llama.rn), bundles llama.cpp's Android JNI
# code but ships it as a React Native turbo-module (a `.aar` built for RN's
# bridge, with RN's own native module registration baked in), which this
# Capacitor app cannot consume as-is without either depending on the RN
# runtime or extracting/re-wrapping its JNI layer -- at which point it is
# no longer meaningfully simpler than building directly against upstream
# llama.cpp. llama.cpp's own repo ships a real, maintained Android example
# (examples/llama.android, MIT, Kotlin + JNI + CMake) that this plugin's
# structure deliberately mirrors -- same shape (a Kotlin wrapper class over
# `external fun` JNI declarations, backed by a small hand-written JNI .cpp
# that calls llama.cpp's public C API), so upgrading against a newer
# llama.cpp release later stays a small diff instead of a rewrite.
# ---------------------------------------------------------------------------

cmake_minimum_required(VERSION 3.22.1)
project(anatolia_llama)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Only the llama.cpp targets actually needed (llama + its ggml backends),
# not its own examples/tests/server -- keeps the .so and build time down.
set(LLAMA_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_SERVER OFF CACHE BOOL "" FORCE)
set(LLAMA_CURL OFF CACHE BOOL "" FORCE) # no network fetch capability baked into the native lib (spec point 5/9)
set(GGML_OPENMP OFF CACHE BOOL "" FORCE) # avoid an extra runtime dependency on Android; NEON/CPU backend is enough for a phone

if(EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/llama.cpp/CMakeLists.txt")
    add_subdirectory(llama.cpp llama.cpp-build)

    add_library(anatolia_llama SHARED
        llama-android.cpp
    )

    target_link_libraries(anatolia_llama
        llama
        ggml
        android
        log
    )

    target_include_directories(anatolia_llama PRIVATE
        ${CMAKE_CURRENT_SOURCE_DIR}/llama.cpp/include
        ${CMAKE_CURRENT_SOURCE_DIR}/llama.cpp/ggml/include
    )
else()
    # Do NOT hard-fail the configure step here: this CMakeLists.txt is invoked
    # by every Gradle build of the Android app (including the automated
    # android-release.yml CI pipeline), and until the llama.cpp submodule
    # (see the header comment above) is actually added on a real dev machine,
    # `anatolia_llama.so` simply doesn't exist. LlamaBridge.kt's
    # `System.loadLibrary("anatolia_llama")` then throws UnsatisfiedLinkError,
    # which LocalLLMPlugin.kt already catches as `Throwable` around every
    # LlamaBridge call and reports as a plugin-call failure -- the same
    # "local LLM unavailable" path the JS registry already falls back from to
    # extractive Q LOCAL DATA. So a missing submodule degrades this one
    # feature at runtime instead of breaking the Gradle/CI build.
    message(WARNING
        "llama.cpp source not found at ${CMAKE_CURRENT_SOURCE_DIR}/llama.cpp -- "
        "skipping the anatolia_llama native target for this build (see this "
        "file's header comment for the required `git submodule add` step). "
        "The app will still build; the Android local LLM feature will report "
        "itself unavailable at runtime until the submodule is added.")
endif()
