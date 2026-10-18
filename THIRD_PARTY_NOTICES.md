# Third-party notices

InkVoice is independently implemented. It does not bundle Typeless code, assets, native libraries, servers or branding.

## whisper.cpp and ggml

The portable local speech engine in `runtime/whisper` is the official Windows x64 CPU binary from [whisper.cpp b5454](https://github.com/ggml-org/whisper.cpp/releases/tag/b5454), commit `d1be6fde11ac6e0407606b4e42fe72d34add8037`. The [v1.9.5 release](https://github.com/ggml-org/whisper.cpp/releases/tag/v1.9.5) links that build. Source and license: [ggml-org/whisper.cpp](https://github.com/ggml-org/whisper.cpp/blob/b5454/LICENSE). Runtime artifact details and hashes are in `evidence/engine-setup.json`.

MIT License

Copyright (c) 2023-2026 The ggml authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Whisper model

The bundled `models/ggml-base-q5_1.bin` is a quantized multilingual base Whisper model distributed by [ggerganov/whisper.cpp](https://huggingface.co/ggerganov/whisper.cpp) under MIT, pinned to repository revision `5359861c739e955e79d9a303bcbc70fb988958b1`. It derives from [OpenAI Whisper](https://github.com/openai/whisper), whose code and model weights are released under MIT. The model card and dependency evidence record the original source. The following notice covers the upstream model:

MIT License

Copyright (c) 2022 OpenAI

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Electron

The desktop shell uses Electron (MIT); a packaged build retains its upstream `LICENSE`, `LICENSES.chromium.html` and other license files from the official Electron distribution. Transitive dependency metadata is preserved in `package-lock.json`. See [Electron license](https://github.com/electron/electron/blob/main/LICENSE).
