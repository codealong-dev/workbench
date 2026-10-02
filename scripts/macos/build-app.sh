#!/usr/bin/env bash
# Build Workbench.app (a WKWebView window around the local server) and put it in ~/Applications.
#   make app
#   PORT=4100 make app          # must match the port the server was installed with
#
# package.sh reuses this for the downloadable app: APP_OUT=<dir>.app, NO_INSTALL=1, and it fills in
# VERSION, MIN_OS, UPDATE_URL, then adds the server and signs.
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
port="${PORT:-4242}"
dest="${APP_DEST:-$HOME/Applications}"
app="${APP_OUT:-$root/desktop/build/Workbench.app}"
version="${VERSION:-0.1}"
min_os="${MIN_OS:-13.0}"
update_url="${UPDATE_URL:-}"

[ "$(uname)" = "Darwin" ] || { echo "build-app.sh is for macOS."; exit 1; }
command -v swiftc >/dev/null || { echo "swiftc not found: install the Xcode command line tools (xcode-select --install)."; exit 1; }

rm -rf "$app"
mkdir -p "$root/desktop/build"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"

echo "==> compiling"
swiftc -O -swift-version 5 -target "$(uname -m)-apple-macos13.0" -o "$app/Contents/MacOS/Workbench" "$root/desktop/main.swift"

echo "==> icon"
if swiftc -O -o "$root/desktop/build/icon" "$root/desktop/icon.swift" 2>/dev/null \
   && "$root/desktop/build/icon" "$root/web/public/favicon.svg" "$root/desktop/build/icon.iconset" 2>/dev/null \
   && iconutil -c icns "$root/desktop/build/icon.iconset" -o "$app/Contents/Resources/AppIcon.icns" 2>/dev/null; then
  icon_key="<key>CFBundleIconFile</key><string>AppIcon</string>"
else
  echo "    (could not render the icon; using the default one)"
  icon_key=""
fi

cat > "$app/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>Workbench</string>
  <key>CFBundleDisplayName</key><string>Workbench</string>
  <key>CFBundleIdentifier</key><string>dev.workbench.app</string>
  <key>CFBundleExecutable</key><string>Workbench</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$version</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>$min_os</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>LSApplicationCategoryType</key><string>public.app-category.developer-tools</string>
  <key>WBPort</key><string>$port</string>
  <key>WBUpdateURL</key><string>$update_url</string>
  $icon_key
  <!-- the server is on loopback over plain http -->
  <key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict></plist>
PLIST
plutil -lint "$app/Contents/Info.plist" >/dev/null

[ -z "${NO_INSTALL:-}" ] || exit 0

# ad-hoc signature: enough to run on the machine that built it
codesign --force --deep --sign - "$app" >/dev/null

mkdir -p "$dest"
rm -rf "$dest/Workbench.app"
cp -R "$app" "$dest/Workbench.app"
echo "==> installed $dest/Workbench.app"
echo "Open it from Spotlight or the Launchpad; drag it to the Dock to keep it there."
