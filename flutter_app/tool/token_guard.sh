#!/usr/bin/env bash
# token_guard.sh — design-token guardrail (DESIGN_AUDIT.md Phase 0).
#
# Counts token violations in lib/features/ and fails if the count GROWS
# beyond the baseline recorded below. Existing violations are being migrated
# down to zero (Phase 2 sweep); this script stops NEW ones from landing.
#
# Banned in feature code (use tokens instead):
#   - `Colors.<x>`            → colorScheme.* / AppStatusColors / AppActionColors
#   - `TextStyle(fontSize:`   → Theme.of(context).textTheme.*
#   - `BorderRadius.circular` → AppShapes.*
#
# Allowed escapes (rare, deliberate):
#   - Colors.transparent, Colors.white/black ONLY where documented (QR codes,
#     media scrims, video surfaces). Add `// token-guard: allow` on the line.
# Update the baseline ONLY downward as screens get migrated:
#   ./tool/token_guard.sh --update

set -euo pipefail
cd "$(dirname "$0")/.."

BASELINE_FILE="tool/.token_guard_baseline"

count() {
  local pattern="$1"
  grep -rn "$pattern" lib/features/ --include="*.dart" \
    | grep -v "token-guard: allow" \
    | grep -vE "App(Action|Status)Colors\." \
    | wc -l | tr -d ' '
}

colors=$(count 'Colors\.[a-zA-Z]')
radii=$(count 'BorderRadius\.circular')
font_sizes=$(count 'TextStyle(')

total=$((colors + radii + font_sizes))

if [[ "${1:-}" == "--update" ]]; then
  cat > "$BASELINE_FILE" <<EOF
colors=$colors
radii=$radii
font_sizes=$font_sizes
EOF
  echo "Baseline updated: colors=$colors radii=$radii font_sizes=$font_sizes (total $total)"
  exit 0
fi

if [[ ! -f "$BASELINE_FILE" ]]; then
  echo "No baseline found. Run: ./tool/token_guard.sh --update"
  exit 1
fi

# shellcheck disable=SC1090
source "$BASELINE_FILE"
base_colors=$colors; base_radii=$radii; base_font_sizes=$font_sizes
# (source overwrites $colors etc. — recount actuals)
colors=$(count 'Colors\.[a-zA-Z]')
radii=$(count 'BorderRadius\.circular')
font_sizes=$(count 'TextStyle(')

fail=0
check() {
  local name="$1" now="$2" base="$3"
  if (( now > base )); then
    echo "❌ $name violations grew: $now (baseline $base). Use design tokens — see DESIGN_AUDIT.md."
    fail=1
  else
    echo "✅ $name: $now (baseline $base)"
  fi
}

check "Colors.*" "$colors" "$base_colors"
check "BorderRadius.circular" "$radii" "$base_radii"
check "TextStyle(" "$font_sizes" "$base_font_sizes"

if (( fail )); then
  echo
  echo "New token violations detected. Migrate to colorScheme.*/AppShapes/textTheme,"
  echo "or add '// token-guard: allow' with a justification comment."
  exit 1
fi

echo "Token guard passed (total $((colors + radii + font_sizes)) remaining, trending to 0)."
