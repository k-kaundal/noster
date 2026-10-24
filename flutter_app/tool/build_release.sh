#!/bin/bash
# Release build with the build-time env wired in (house wallet + OpenRouter).
# Without --dart-define-from-file=.env the AAB ships with EMPTY keys and
# house-wallet/AI features silently disable themselves.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "No .env found — copy .env.example to .env and fill in real values." >&2
  exit 1
fi

exec flutter build appbundle --release --analyze-size \
  --target-platform android-arm64 \
  --dart-define-from-file=.env "$@"
