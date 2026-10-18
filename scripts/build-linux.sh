#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
[[ $(uname -s) == Linux ]] || { echo 'Run this script on Linux.' >&2; exit 1; }
command -v node >/dev/null || { echo 'Install Node 22.12+ (Node 24 LTS recommended).' >&2; exit 1; }
command -v python3 >/dev/null || { echo 'Install Python 3 for the optional input helper.' >&2; exit 1; }
node scripts/check-source.cjs
node scripts/check-linux.cjs
python3 scripts/check-linux-input.py
bash scripts/setup-engine-linux.sh
if [[ ! -x runtime/electron-linux-x64/electron ]]; then bash scripts/setup-electron-linux.sh; fi
node scripts/package-linux.cjs
