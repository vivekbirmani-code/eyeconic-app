#!/usr/bin/env bash
# Android emulator responsive verification for the Analytics TabSwitcher.
# Drives the installed dev-client app via adb at multiple dp widths and
# asserts (via uiautomator node bounds) that "Proctoring" renders on ONE line.
# Run AFTER: emulator booted, Metro :8081 running, app logged in as admin.
set -u
PKG=com.eyeconicbydrlalla.mentorship
OUT=C:/Projects/eyeconic-app/verify-shots
mkdir -p "$OUT"

density=$(adb shell wm density | grep -o '[0-9]*' | head -1)
echo "density: $density"

declare -a DPS=(320 360 390 430 600)

for dp in "${DPS[@]}"; do
  px=$((dp * density / 160))
  hpx=$((px * 2340 / 1080))  # keep ~1080:2340 aspect
  adb shell wm size ${px}x${hpx}
  sleep 3

  adb shell "screencap -p /sdcard/verify_${dp}.png"
  MSYS_NO_PATHCONV=1 adb pull /sdcard/verify_${dp}.png "$OUT/analytics-${dp}dp.png" >/dev/null

  adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1
  MSYS_NO_PATHCONV=1 adb pull /sdcard/ui.xml "$OUT/ui-${dp}dp.xml" >/dev/null

  # Node bounds for the Proctoring text: height in px
  height=$(python - "$OUT/ui-${dp}dp.xml" "$density" << 'EOF'
import sys, re
import xml.etree.ElementTree as ET
path, density = sys.argv[1], int(sys.argv[2])
tree = ET.parse(path)
found = []
for node in tree.iter('node'):
    text = (node.get('text') or '').strip()
    if text in ('Proctoring', 'Test Analytics', 'Student Analytics', 'Heat Map'):
        m = re.match(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]', node.get('bounds', ''))
        if m:
            x1, y1, x2, y2 = map(int, m.groups())
            dp_h = (y2 - y1) * 160 / density
            found.append((text, round(dp_h, 1)))
for t, h in found:
    print(f"{t}: {h}dp")
EOF
)
  echo "=== ${dp}dp (font 13, single line ~= 16-19dp; two lines >= 30dp) ==="
  echo "$height"
done

adb shell wm size reset
echo "DONE"
