#include <jni.h>
#include <whisper.h>
#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstdint>
#include <exception>
#include <memory>
#include <mutex>
#include <string>
#include <unordered_map>
#include <vector>

namespace {
struct Engine {
    whisper_context *context;
    std::mutex inference;
    std::atomic<uint64_t> cancel_epoch{0};
    explicit Engine(whisper_context *ctx) : context(ctx) {}
    ~Engine() { if (context) whisper_free(context); }
};
std::mutex registry_mutex;
std::unordered_map<jlong, std::shared_ptr<Engine>> engines;
std::atomic<jlong> next_handle{1};

void fail(JNIEnv *env, const char *message, const char *type = "java/lang/IllegalStateException") {
    jclass klass = env->FindClass(type);
    if (klass) { env->ThrowNew(klass, message); env->DeleteLocalRef(klass); }
}
std::shared_ptr<Engine> lookup(jlong handle) {
    std::lock_guard<std::mutex> guard(registry_mutex);
    const auto found = engines.find(handle);
    return found == engines.end() ? nullptr : found->second;
}
std::string java_path(JNIEnv *env, jstring value) {
    if (!value) return {};
    const char *chars = env->GetStringUTFChars(value, nullptr);
    if (!chars) return {};
    std::string result(chars);
    env->ReleaseStringUTFChars(value, chars);
    return result;
}
struct AbortState { Engine *engine; uint64_t expected; };
bool should_abort(void *data) {
    auto *state = static_cast<AbortState *>(data);
    return state->engine->cancel_epoch.load(std::memory_order_acquire) != state->expected;
}
}

extern "C" JNIEXPORT jlong JNICALL
Java_org_inkvoice_keyboard_WhisperNative_create(JNIEnv *env, jobject, jstring model_path) {
    try {
        const auto path = java_path(env, model_path);
        if (env->ExceptionCheck()) return 0;
        if (path.empty()) { fail(env, "Model path is empty"); return 0; }
        auto params = whisper_context_default_params();
        params.use_gpu = false;
        params.flash_attn = false;
        auto *context = whisper_init_from_file_with_params(path.c_str(), params);
        if (!context) { fail(env, "Cannot load the verified local Whisper model"); return 0; }
        std::unique_ptr<whisper_context, decltype(&whisper_free)> pending(context, &whisper_free);
        auto engine = std::make_shared<Engine>(context);
        pending.release();
        const jlong handle = next_handle.fetch_add(1);
        std::lock_guard<std::mutex> guard(registry_mutex);
        engines.emplace(handle, std::move(engine));
        return handle;
    } catch (const std::exception &) { fail(env, "Native model initialization failed"); return 0; }
}

extern "C" JNIEXPORT jlong JNICALL
Java_org_inkvoice_keyboard_WhisperNative_epoch(JNIEnv *, jobject, jlong handle) {
    auto engine = lookup(handle);
    return engine ? static_cast<jlong>(engine->cancel_epoch.load(std::memory_order_acquire)) : -1;
}
extern "C" JNIEXPORT void JNICALL
Java_org_inkvoice_keyboard_WhisperNative_abort(JNIEnv *, jobject, jlong handle) {
    auto engine = lookup(handle);
    if (engine) engine->cancel_epoch.fetch_add(1, std::memory_order_acq_rel);
}
extern "C" JNIEXPORT void JNICALL
Java_org_inkvoice_keyboard_WhisperNative_release(JNIEnv *, jobject, jlong handle) {
    std::shared_ptr<Engine> engine;
    {
        std::lock_guard<std::mutex> guard(registry_mutex);
        auto found = engines.find(handle);
        if (found == engines.end()) return;
        engine = found->second;
        engines.erase(found);
    }
    // An in-flight transcription keeps its shared reference until it has stopped.
    engine->cancel_epoch.fetch_add(1, std::memory_order_acq_rel);
}

extern "C" JNIEXPORT jbyteArray JNICALL
Java_org_inkvoice_keyboard_WhisperNative_transcribe(JNIEnv *env, jobject, jlong handle,
        jfloatArray pcm, jstring language, jint threads, jlong expected_epoch) {
    auto engine = lookup(handle);
    if (!engine) { fail(env, "Whisper context has been released"); return nullptr; }
    try {
        std::lock_guard<std::mutex> serialize(engine->inference);
        AbortState cancellation{engine.get(), static_cast<uint64_t>(expected_epoch)};
        if (should_abort(&cancellation)) {
            fail(env, "Transcription cancelled", "java/util/concurrent/CancellationException"); return nullptr;
        }
        if (!pcm) { fail(env, "PCM data is missing"); return nullptr; }
        const auto count = env->GetArrayLength(pcm);
        if (count < 4000 || count > 16000 * 300) { fail(env, "PCM duration is outside the accepted range"); return nullptr; }
        std::vector<float> samples(static_cast<size_t>(count));
        env->GetFloatArrayRegion(pcm, 0, count, samples.data());
        if (env->ExceptionCheck()) return nullptr;
        double power = 0;
        for (const float sample : samples) {
            if (!std::isfinite(sample) || sample < -1.0f || sample > 1.0f) { fail(env, "PCM data is invalid"); return nullptr; }
            power += sample * sample;
        }
        if (std::sqrt(power / count) < 0.0008) { fail(env, "PCM input is silent"); return nullptr; }
        const auto lang = java_path(env, language);
        if (env->ExceptionCheck()) return nullptr;
        if (!lang.empty() && lang != "auto" && whisper_lang_id(lang.c_str()) < 0) { fail(env, "Unsupported speech language"); return nullptr; }
        auto params = whisper_full_default_params(WHISPER_SAMPLING_GREEDY);
        params.n_threads = std::max(1, std::min(4, static_cast<int>(threads)));
        params.language = lang.empty() ? "auto" : lang.c_str();
        params.translate = false;
        params.no_context = true;
        params.print_realtime = false;
        params.print_progress = false;
        params.print_timestamps = false;
        params.print_special = false;
        params.abort_callback = should_abort;
        params.abort_callback_user_data = &cancellation;
        const int status = whisper_full(engine->context, params, samples.data(), count);
        if (should_abort(&cancellation)) {
            fail(env, "Transcription cancelled", "java/util/concurrent/CancellationException"); return nullptr;
        }
        if (status != 0) { fail(env, "Local Whisper inference failed"); return nullptr; }
        std::string text;
        const int segments = whisper_full_n_segments(engine->context);
        for (int i = 0; i < segments; ++i) {
            const char *part = whisper_full_get_segment_text(engine->context, i);
            if (part) text += part;
        }
        // JNI NewStringUTF uses modified UTF-8. Return ordinary UTF-8 bytes instead;
        // Kotlin decodes these via Charsets.UTF_8, including four-byte code points.
        auto output = env->NewByteArray(static_cast<jsize>(text.size()));
        if (output && !text.empty()) env->SetByteArrayRegion(output, 0, static_cast<jsize>(text.size()),
            reinterpret_cast<const jbyte *>(text.data()));
        return output;
    } catch (const std::exception &) { fail(env, "Native transcription failed"); return nullptr; }
}
