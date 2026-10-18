#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
version=$(node -p 'require("./package.json").devDependencies.electron')
arch=$(uname -m)
case "$arch" in x86_64) arch=x64 ;; aarch64) arch=arm64 ;; *) echo 'Unsupported Linux architecture' >&2; exit 1 ;; esac
archive="electron-v${version}-linux-${arch}.zip"
work="runtime/electron-download-${arch}"
target="runtime/electron-linux-${arch}"
if [[ -e "$target" ]]; then echo "Already exists: $target; no files changed."; exit 1; fi
mkdir -p "$work"
base="https://github.com/electron/electron/releases/download/v${version}"
curl --fail --location --retry 3 "$base/SHASUMS256.txt" -o "$work/SHASUMS256.txt"
curl --fail --location --retry 3 "$base/$archive" -o "$work/$archive"
(cd "$work"; awk -v name="$archive" '{sub(/^\*/,"",$2); if($2==name) print $1 "  " $2}' SHASUMS256.txt > selected.sha256; test -s selected.sha256; sha256sum --check selected.sha256)
mkdir -p "$target"
unzip -q "$work/$archive" -d "$target"
chmod +x "$target/electron" "$target/chrome-sandbox" "$target/chrome_crashpad_handler"
echo "Verified Electron $version at $target"
