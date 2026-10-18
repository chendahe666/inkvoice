#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
[[ $(uname -s) == Linux && $(uname -m) == x86_64 ]] || { echo 'This setup targets Linux x86_64 CPU (Ubuntu 22.04+ baseline).' >&2; exit 1; }
for tool in curl sha256sum tar cmake c++ make; do command -v "$tool" >/dev/null || { echo "Missing build tool: $tool. Install build-essential cmake curl before retrying." >&2; exit 1; }; done
commit=d1be6fde11ac6e0407606b4e42fe72d34add8037
archive_sha=645445da884df6dbd52b30f82d7be7c01d1767c938714e477e786b88d529e9f4
model_sha=422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898
model_revision=5359861c739e955e79d9a303bcbc70fb988958b1
work="$PWD/tools/linux-engine"
mkdir -p "$work" runtime/whisper models evidence
verified_download() {
  local url=$1 destination=$2 checksum=$3
  if [[ -f "$destination" ]] && echo "$checksum  $destination" | sha256sum --check --status; then return; fi
  curl --fail --location --retry 3 --connect-timeout 30 "$url" -o "$destination.partial"
  echo "$checksum  $destination.partial" | sha256sum --check
  mv -- "$destination.partial" "$destination"
}
archive="$work/whisper-$commit.tar.gz"
verified_download "https://codeload.github.com/ggml-org/whisper.cpp/tar.gz/$commit" "$archive" "$archive_sha"
verified_download "https://huggingface.co/ggerganov/whisper.cpp/resolve/$model_revision/ggml-base-q5_1.bin?download=true" "$PWD/models/ggml-base-q5_1.bin" "$model_sha"
if [[ ! -f "$work/whisper.cpp-$commit/CMakeLists.txt" ]]; then tar -xzf "$archive" -C "$work"; fi
cmake -S "$work/whisper.cpp-$commit" -B "$work/build" -DCMAKE_BUILD_TYPE=Release \
  -DBUILD_SHARED_LIBS=OFF -DGGML_NATIVE=OFF -DGGML_AVX=OFF -DGGML_AVX2=OFF \
  -DGGML_BMI2=OFF -DGGML_FMA=OFF -DGGML_F16C=OFF -DGGML_SSE42=OFF \
  -DGGML_OPENMP=OFF -DGGML_BLAS=OFF -DGGML_CUDA=OFF -DGGML_VULKAN=OFF \
  -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_SERVER=OFF -DWHISPER_BUILD_IS_DEV=OFF
jobs=$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 2)
(( jobs > 8 )) && jobs=8
cmake --build "$work/build" --config Release --target whisper-cli --parallel "$jobs"
install -m 755 "$work/build/bin/whisper-cli" runtime/whisper/whisper-cli
runtime/whisper/whisper-cli --help >runtime/whisper/cli-help-linux.txt 2>&1
exe_sha=$(sha256sum runtime/whisper/whisper-cli | cut -d' ' -f1)
cat > evidence/engine-setup-linux.json <<EOF
{"kind":"linux-engine-build","sourceCommit":"$commit","sourceArchiveSha256":"$archive_sha","modelSha256":"$model_sha","executableSha256":"$exe_sha","platform":"linux-x64","sharedWhisperLibraries":false,"nativeCpuOptimization":false,"helpPassed":true,"actualTranscriptionVerified":false}
EOF
echo 'Linux local speech engine built. No microphone or cloud was used.'
