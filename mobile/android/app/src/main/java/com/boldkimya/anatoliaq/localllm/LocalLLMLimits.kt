package com.boldkimya.anatoliaq.localllm

/**
 * Pure, Android-framework-free resource-safety limits (task spec point 8),
 * split out of [LocalLLMPlugin] specifically so they're testable with a
 * plain JVM `src/test` unit test (no Robolectric/instrumentation needed --
 * see LocalLLMLimitsTest.kt) rather than only via an instrumented test that
 * needs a device/emulator this sandbox doesn't have.
 */
internal object LocalLLMLimits {
    /**
     * Hard server-side cap on generated tokens per call, regardless of what
     * the JS layer requests (llmProvider.js already requests 350-600, but
     * the native side is the real resource boundary and must not trust the
     * caller blindly).
     */
    const val MAX_GENERATION_TOKENS = 768

    fun clampMaxTokens(requested: Int): Int = requested.coerceIn(1, MAX_GENERATION_TOKENS)
}
