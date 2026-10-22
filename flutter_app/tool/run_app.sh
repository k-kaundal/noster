#!/bin/bash
# Run the app with the build-time env wired in.
# Usage: ./tool/run_app.sh [device-id]   e.g. ./tool/run_app.sh emulator-5554
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "No .env found — copy .env.example to .env and fill in real values." >&2
  exit 1
fi

DEVICE_ARGS=()
if [ $# -ge 1 ]; then
  DEVICE_ARGS=(-d "$1")
fi

exec flutter run "${DEVICE_ARGS[@]}" --dart-define-from-file=.env
