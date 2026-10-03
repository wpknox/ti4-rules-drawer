#!/bin/sh
# Builds the Safari version of the extension and installs it to ~/Applications.
# Run after any change in extension/ (Safari bundles a copy at build time).
# Usage: sh scripts/build-safari.sh
#
# Signing: put your Apple Team ID (10 characters, e.g. AB12CD34EF) in
# safari/team-id. That file is gitignored, so the ID never reaches GitHub.
# With it, the build is signed with your Apple ID and Safari keeps the
# extension enabled. Without it, the build is unsigned and needs Safari's
# Develop > Allow Unsigned Extensions, which resets whenever Safari quits.
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="TI4 Rules Drawer.app"
TEAM_FILE="$ROOT/safari/team-id"
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer

if [ -s "$TEAM_FILE" ]; then
  TEAM="$(tr -d '[:space:]' < "$TEAM_FILE")"
  echo "Signing with team $TEAM"
  set -- -allowProvisioningUpdates CODE_SIGN_STYLE=Automatic DEVELOPMENT_TEAM="$TEAM"
else
  echo "No safari/team-id; building unsigned"
  set -- CODE_SIGN_IDENTITY="-" CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM=""
fi

cd "$ROOT/safari/TI4 Rules Drawer"
xcodebuild -quiet -scheme "TI4 Rules Drawer" -configuration Release \
  -derivedDataPath ../build "$@" build

mkdir -p "$HOME/Applications"
rm -rf "$HOME/Applications/$APP"
mv "../build/Build/Products/Release/$APP" "$HOME/Applications/"
# Moved rather than copied: a second copy left in the build folder would be
# registered with Safari as a duplicate extension.

# Launching the app once registers (or refreshes) the extension with Safari.
open "$HOME/Applications/$APP"
echo "Installed ~/Applications/$APP"
echo "In Safari: Settings > Extensions > enable TI4 Rules Drawer."
