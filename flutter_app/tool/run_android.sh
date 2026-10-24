#!/bin/bash
# Boot the Android emulator and run the app on it (debug).
# Usage: ./tool/run_android.sh [avd_name]
set -euo pipefail

export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/emulator:$ANDROID_HOME/platform-tools:$PATH"

AVD="${1:-Medium_Phone_API_36.1}"
IMAGE="system-images;android-36.1;google_apis_playstore;arm64-v8a"

echo "==> Android SDK: $ANDROID_HOME"

# 1. Ensure the system image exists (downloads ~1.8 GB on first run).
if [ ! -d "$ANDROID_HOME/system-images/android-36.1/google_apis_playstore/arm64-v8a" ]; then
  echo "==> System image missing — downloading (this is the big one, ~1.8 GB)…"
  yes | sdkmanager "$IMAGE"
fi

# 2. Ensure the AVD exists (create if missing).
if ! emulator -list-avds | grep -qx "$AVD"; then
  echo "==> Creating AVD: $AVD"
  echo "no" | avdmanager create avd -n "$AVD" -k "$IMAGE" -d medium_phone --force
fi

# 3. Boot the emulator (background) and wait for it to come online.
echo "==> Booting emulator: $AVD"
emulator -avd "$AVD" -no-snapshot -netdelay none -netspeed full >/tmp/emu.log 2>&1 &
EMU_PID=$!
echo "   emulator pid: $EMU_PID (logs: /tmp/emu.log)"

echo "==> Waiting for device to come online…"
adb wait-for-device
# Wait for full boot (sys.boot_completed flips to 1).
until [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; do
  sleep 3
done
echo "==> Emulator is up."

# 4. Run the app on it.
cd "$(dirname "$0")/.."
echo "==> flutter run on the emulator"
flutter run --dart-define-from-file=.env
