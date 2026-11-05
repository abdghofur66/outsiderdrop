#!/bin/bash
# Pemakaian: mac/build-app.sh <binary pkg> <nama zip> <versi>
set -e
BIN="$1"; OUT="$2"; VER="$3"
APP="OutsiderDrop.app"
rm -rf "$APP"; mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
sed "s/__VERSION__/$VER/g" mac/Info.plist > "$APP/Contents/Info.plist"
cp mac/launcher.sh "$APP/Contents/MacOS/OutsiderDrop"
cp "$BIN" "$APP/Contents/MacOS/outsiderdrop-server"
chmod +x "$APP/Contents/MacOS/"*
cp build/icon.icns "$APP/Contents/Resources/icon.icns"
codesign --force --sign - "$APP/Contents/MacOS/outsiderdrop-server"
codesign --force --sign - "$APP"
ditto -c -k --keepParent "$APP" "$OUT"
rm -rf "$APP"
