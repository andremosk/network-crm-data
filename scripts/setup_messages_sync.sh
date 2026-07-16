#!/bin/zsh
set -euo pipefail

APP_DIR="$HOME/Library/Application Support/Network CRM"
BIN_DIR="$APP_DIR/bin"
CONFIG="$APP_DIR/messages-sync.json"
PLIST="$HOME/Library/LaunchAgents/com.networkcrm.messages-sync.plist"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="4.2.0"

mkdir -p "$BIN_DIR" "$HOME/Library/LaunchAgents"
ARCH="$(uname -m)"
if [[ "$ARCH" == "arm64" ]]; then
  ASSET="imessage-exporter-aarch64-apple-darwin"
  EXPECTED_SHA="d3c09effb096dabac2979652f37182cf305969c1a5ef2fbad8850929ab02e502"
else
  ASSET="imessage-exporter-x86_64-apple-darwin"
  EXPECTED_SHA="d67a7876c098d49a9dd88040e7b20ecc64f7e7943bc0f9f6b6caae336d99685e"
fi

EXPORTER="$BIN_DIR/imessage-exporter"
curl -L --fail --silent --show-error \
  "https://github.com/ReagentX/imessage-exporter/releases/download/$VERSION/$ASSET" \
  -o "$EXPORTER"
ACTUAL_SHA="$(shasum -a 256 "$EXPORTER" | awk '{print $1}')"
if [[ "$ACTUAL_SHA" != "$EXPECTED_SHA" ]]; then
  echo "Downloaded parser did not match its expected checksum. Setup stopped."
  exit 1
fi
chmod 700 "$EXPORTER"

echo "Paste your Network.crm access key, then press Return:"
read -rs TOKEN
echo
if [[ -z "$TOKEN" ]]; then
  echo "An access key is required."
  exit 1
fi

/usr/bin/python3 - "$CONFIG" "$TOKEN" "$EXPORTER" <<'PY'
import json, os, sys
path, token, exporter = sys.argv[1:]
with open(path, "w", encoding="utf-8") as handle:
    json.dump({
        "url": "https://network-crm-data.vercel.app",
        "token": token,
        "exporter": exporter,
    }, handle, indent=2)
    handle.write("\n")
os.chmod(path, 0o600)
PY

cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.networkcrm.messages-sync</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/python3</string>
    <string>$REPO_DIR/scripts/messages_sync.py</string>
  </array>
  <key>StartCalendarInterval</key>
  <array>
    <dict><key>Hour</key><integer>12</integer><key>Minute</key><integer>0</integer></dict>
    <dict><key>Hour</key><integer>18</integer><key>Minute</key><integer>0</integer></dict>
  </array>
  <key>StandardOutPath</key><string>$APP_DIR/messages-sync.log</string>
  <key>StandardErrorPath</key><string>$APP_DIR/messages-sync-error.log</string>
</dict>
</plist>
PLIST

plutil -lint "$PLIST"
launchctl bootout "gui/$(id -u)/com.networkcrm.messages-sync" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"

echo
echo "Setup installed the twice-daily schedule."
echo "Next: give this file Full Disk Access in System Settings:"
echo "$EXPORTER"
echo
echo "Then test with:"
echo "/usr/bin/python3 '$REPO_DIR/scripts/messages_sync.py' --dry-run"
