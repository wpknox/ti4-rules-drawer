#!/bin/sh
# Builds the Safari version of the extension and installs it to ~/Applications.
# Run after any change in extension/ (Safari bundles a copy at build time).
# Usage: sh scripts/build-safari.sh
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="TI4 Rules Drawer.app"
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer

cd "$ROOT/safari/TI4 Rules Drawer"
xcodebuild -quiet -scheme "TI4 Rules Drawer" -configuration Release \
  -derivedDataPath ../build \
  CODE_SIGN_IDENTITY="-" CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM="" \
  build

mkdir -p "$HOME/Applications"
rm -rf "$HOME/Applications/$APP"
mv "../build/Build/Products/Release/$APP" "$HOME/Applications/"
# Moved rather than copied: a second copy left in the build folder would be
# registered with Safari as a duplicate extension.

# Launching the app once registers (or refreshes) the extension with Safari.
open "$HOME/Applications/$APP"
echo "Installed ~/Applications/$APP"
echo "In Safari: Develop > Allow Unsigned Extensions, then Settings > Extensions > enable TI4 Rules Drawer."
