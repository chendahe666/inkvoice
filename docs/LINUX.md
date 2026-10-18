# Linux development preview

InkVoice's Linux preview provides local Whisper transcription, microphone recording,
editable results, history and explicit copying. X11 text injection is optional and
experimental. Wayland uses manual copy; its global shortcut also depends on the
desktop's GlobalShortcuts portal. A failed shortcut never prevents the recording
button from working.

## Build from source

Use Linux x86_64 with Node 22.12+ (Node 24 LTS recommended), Python 3, `curl`,
`sha256sum`, `tar`, CMake, a C/C++ compiler and Make. On Ubuntu, install
`build-essential cmake curl python3 unzip` using your normal package manager.
Electron additionally needs the distribution's GTK, NSS, GBM and ALSA runtime
libraries and a graphical desktop. The scripts do not install system packages.

```sh
npm ci
bash scripts/build-linux.sh
```

The build downloads pinned official Whisper source and the multilingual base Q5_1
model, verifies SHA-256, and builds CPU inference without native-only CPU flags,
OpenMP or shared Whisper libraries. Electron is downloaded separately with its
official release checksum. Output is `release/InkVoice-linux-x64`.
Do not run the desktop application as root or disable Chromium's sandbox to work
around a local sandbox configuration problem.

The source build is intended for Ubuntu 22.04+ x86_64. A binary built on Ubuntu
24.04 is a **Ubuntu 24.04+ development preview**, not evidence that it runs on
22.04. Other distributions may need to build locally; glibc, libstdc++ and desktop
runtime requirements still apply. No ARM64 binary is claimed by this preview.

## Running

```sh
cd release/InkVoice-linux-x64
./start-inkvoice.sh
./install-desktop-entry.sh
```

The optional desktop entry is installed for the current user and gives Wayland
portals the identity `org.inkvoice.InkVoice.desktop`. No automatic startup is
installed. Store settings/history in the normal Electron userData directory or
override with `INKVOICE_DATA_DIR`. Optional cloud text processing remains disabled
by default. API keys can be saved only when Electron has a real Secret Service or
KWallet backend; `basic_text` is rejected.

## Optional X11 insertion

Install `xdotool` through your distribution if you want to try automatic input.
Python 3 and Xlib are also required. Run `python3 native/linux-input.py --check`
from a source checkout to inspect capability without typing anything.

The helper captures an X11 window id, waits for Ctrl/Alt/Shift/Super to be released,
and checks the current window before each small batch. It never activates a window,
changes the clipboard, starts a daemon or requests root. Some applications may
ignore synthetic input; send success means events were requested, not that every
editor accepted the text. Interrupted delivery keeps the result visible and may
report partial/uncertain input; inspect the target before trying again.

If Wayland is detected, the helper refuses injection even when an XWayland DISPLAY
also exists. Copy the result and paste it yourself. `ydotool`, privileged input
devices and unattended RemoteDesktop portal sessions are not configured.

## Checks and evidence boundaries

```sh
npm run check
python3 scripts/check-linux-input.py
# Optional integration checks after the engine build:
node scripts/check-linux-runtime.cjs
xvfb-run -a python3 scripts/check-linux-input-desktop.py
```

`check-linux.cjs` is an offline, cross-host service test with a synthetic filesystem.
`check-linux-input.py` checks helper logic without a display or input. Neither proves
Linux microphone access or real typing. Real Linux CLI recognition, Electron/Xvfb
launch, and input into an isolated test window must be recorded separately. Xvfb
and prerecorded audio do not establish a physical microphone or Wayland desktop
test, and this preview does not claim Typeless accuracy parity.

The recorded Ubuntu 24.04 build requires GLIBC 2.38 or newer. Its pinned CLI
transcribed the public 11-second upstream JFK fixture in about 31 seconds in the
test WSL environment. This conservative CPU build does not promise realtime speed.

Upstream references: [Whisper version](https://github.com/ggml-org/whisper.cpp/releases/tag/v1.9.5),
[Electron global shortcuts](https://www.electronjs.org/docs/latest/api/global-shortcut),
[Electron Linux key storage](https://www.electronjs.org/docs/latest/api/safe-storage),
[xdotool X11/Wayland limitations](https://github.com/jordansissel/xdotool).
