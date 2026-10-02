#!/usr/bin/env bash
# Build the downloadable Workbench.app (server, Node and sidecar inside) and a .dmg.
#   make dist                                  # ad-hoc signed: runs on this Mac only
#   SIGN_IDENTITY="Developer ID Application: Name (TEAMID)" make dist
#   SIGN_IDENTITY=... NOTARY_PROFILE=workbench make dist     # also notarizes and staples
#
# Optional:
#   NOTARY_PROFILE  name from `xcrun notarytool store-credentials`
#   DOWNLOAD_URL    where the .dmg will be served; also writes latest.json for the in-app update check
#   UPDATE_URL      where latest.json will be served (default: DOWNLOAD_URL's directory + /latest.json)
#   PORT            port the app's server listens on (default 4242)
#   NODE_VERSION    Node bundled for the Claude sidecar (default 22.22.0)
#
# Output: dist/Workbench-<version>-<arch>.dmg (+ .sha256, latest.json)
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
build="$root/desktop/build/dist"
out="$root/dist"
arch="$(uname -m)"
version="${VERSION:-$(sed -n 's/^ *version: "\(.*\)",/\1/p' "$root/server/mix.exs" | head -1)}"
node_version="${NODE_VERSION:-22.22.0}"
identity="${SIGN_IDENTITY:--}"
port="${PORT:-4242}"
app="$build/Workbench.app"
res="$app/Contents/Resources"
dmg="$out/Workbench-$version-$arch.dmg"

[ "$(uname)" = "Darwin" ] || { echo "package.sh is for macOS."; exit 1; }
if [ "$identity" = "-" ]; then
  echo "NOTE: SIGN_IDENTITY not set, so this build is ad-hoc signed. Gatekeeper will block it on other Macs."
elif [ -n "${NOTARY_PROFILE:-}" ]; then :; else
  echo "NOTE: signing without NOTARY_PROFILE, so the download will still be flagged by Gatekeeper."
fi

# libraries a Mach-O file loads (not its own install name)
deps() { otool -L "$1" | tail -n +2 | awk '{print $1}' | grep -vxF "$(otool -D "$1" | tail -n +2)" || true; }
# Mach-O files under a directory, one per line
macho() { find "$1" -type f -print0 | xargs -0 file | grep ': *Mach-O' | cut -d: -f1 || true; }

update_url="${UPDATE_URL:-}"
if [ -z "$update_url" ] && [ -n "${DOWNLOAD_URL:-}" ]; then update_url="${DOWNLOAD_URL%/*}/latest.json"; fi

echo "==> web UI, sidecar bundle, release"
make -C "$root" web >/dev/null
(cd "$root/sidecar" && npm install --no-audit --no-fund --silent && npm run build:dist --silent)
# its own directory: the launchd server from `make install` runs from server/_build/prod/rel
release="$root/desktop/build/release"
# Natively compiled dependencies (erlexec, file_system) default to this Mac's macOS; build them for the
# Erlang's own minimum instead, or the app would need a newer macOS than Erlang itself does.
otp_root="$(erl -noshell -eval 'io:format("~s", [code:root_dir()])' -s init stop)"
export MACOSX_DEPLOYMENT_TARGET="$(vtool -show-build "$(ls "$otp_root"/erts-*/bin/beam.smp | head -1)" | awk '/minos/{print $2}')"
echo "    Erlang needs macOS $MACOSX_DEPLOYMENT_TARGET; building dependencies for that"
(cd "$root/server" && MIX_ENV=prod mix deps.get --only prod >/dev/null \
  && rm -rf deps/file_system/priv/mac_listener deps/erlexec/priv/*/exec-port deps/erlexec/_build \
  && MIX_ENV=prod mix deps.compile erlexec file_system --force >/dev/null \
  && MIX_ENV=prod mix release --overwrite --quiet --path "$release")

echo "==> node $node_version"
cache="$root/desktop/build/cache"; mkdir -p "$cache"
case "$arch" in arm64) node_arch=arm64 ;; x86_64) node_arch=x64 ;; *) echo "unsupported arch $arch"; exit 1 ;; esac
node_tgz="node-v$node_version-darwin-$node_arch.tar.gz"
if [ ! -f "$cache/$node_tgz" ]; then
  curl -fsSL "https://nodejs.org/dist/v$node_version/$node_tgz" -o "$cache/$node_tgz"
  curl -fsSL "https://nodejs.org/dist/v$node_version/SHASUMS256.txt" -o "$cache/SHASUMS256.txt"
  want="$(grep " $node_tgz\$" "$cache/SHASUMS256.txt" | awk '{print $1}')"
  got="$(shasum -a 256 "$cache/$node_tgz" | awk '{print $1}')"
  [ -n "$want" ] && [ "$want" = "$got" ] || { rm -f "$cache/$node_tgz"; echo "node checksum mismatch"; exit 1; }
fi

echo "==> assembling the app"
rm -rf "$build"; mkdir -p "$build"
# the shell's own Info.plist needs the minimum macOS the bundled binaries need
min_os="$(macho "$release" | while read -r f; do vtool -show-build "$f" 2>/dev/null | awk '/minos/{print $2}'; done | sort -V | tail -1)"
min_os="${min_os:-13.0}"
APP_OUT="$app" NO_INSTALL=1 PORT="$port" VERSION="$version" MIN_OS="$min_os" UPDATE_URL="$update_url" \
  "$root/scripts/macos/build-app.sh" | grep -v "^==> compiling"
mkdir -p "$res/node/bin" "$res/sidecar" "$app/Contents/Frameworks"
cp -R "$release" "$res/server"
tar -xzf "$cache/$node_tgz" -C "$res/node" --strip-components=1 "node-v$node_version-darwin-$node_arch/bin/node"
cp "$root/sidecar/dist/claude.bundle.js" "$res/sidecar/"

echo "==> bundling shared libraries"
# Erlang's crypto NIF links Homebrew's OpenSSL by absolute path; copy it in and point at the copy.
macho "$res" > "$build/macho.txt"
while read -r f; do
  while read -r dep; do
    lib="$(basename "$dep")"
    if [ ! -f "$app/Contents/Frameworks/$lib" ]; then
      cp "$dep" "$app/Contents/Frameworks/$lib"
      chmod u+w "$app/Contents/Frameworks/$lib"
      install_name_tool -id "@rpath/$lib" "$app/Contents/Frameworks/$lib"
    fi
    rel="$(python3 -c 'import os,sys; print(os.path.relpath(sys.argv[1], os.path.dirname(sys.argv[2])))' "$app/Contents/Frameworks/$lib" "$f")"
    chmod u+w "$f"
    install_name_tool -change "$dep" "@loader_path/$rel" "$f"
  done < <(deps "$f" | grep -vE '^(/usr/lib|/System|@)' || true)
done < "$build/macho.txt"
# anything still pointing outside the system or the bundle would only work on this Mac
bad="$(macho "$app" | while read -r f; do deps "$f" | awk -v f="$f" '{print f": "$1}'; done | grep -vE ': (/usr/lib|/System|@)' || true)"
[ -z "$bad" ] || { echo "libraries outside the bundle:"; echo "$bad"; exit 1; }

echo "==> signing ($identity)"
flags=(--force --options runtime --entitlements "$root/desktop/entitlements.plist" --sign "$identity")
[ "$identity" = "-" ] || flags+=(--timestamp)
# every Mach-O inside out (deepest first), then the bundle
macho "$app/Contents" | grep -v "^$app/Contents/MacOS/" | awk '{print length, $0}' | sort -rn | cut -d' ' -f2- > "$build/sign.txt"
while read -r f; do codesign "${flags[@]}" "$f" >/dev/null; done < "$build/sign.txt"
codesign "${flags[@]}" "$app" >/dev/null
codesign --verify --deep --strict "$app"

echo "==> smoke test (server from the bundle, hardened runtime, empty data dir)"
smoke_home="$(mktemp -d)"; smoke_port=$((20000 + RANDOM % 20000))
before="$(mktemp)"; touch "$before"
PORT=$smoke_port WB_HOME="$smoke_home" WB_SIDECAR="$res/sidecar/claude.bundle.js" WB_NODE="$res/node/bin/node" \
  ELIXIR_ERL_OPTIONS=+fnu RELEASE_TMP="$smoke_home/tmp" RELEASE_DISTRIBUTION=none \
  "$res/server/bin/workbench" start >"$smoke_home/out.log" 2>&1 &
smoke_pid=$!
ok=""
for _ in $(seq 1 60); do
  curl -fs "http://127.0.0.1:$smoke_port/api/health" >/dev/null && { ok=1; break; }
  sleep 0.5
done
if [ -n "$ok" ]; then
  curl -fs "http://127.0.0.1:$smoke_port/" | grep -q 'wb-token' || { echo "UI not served"; ok=""; }
  # the sidecar must start under the bundled node (this is where a missing library or JIT entitlement shows up)
  echo '{"op":"stop"}' | "$res/node/bin/node" "$res/sidecar/claude.bundle.js" >/dev/null || { echo "bundled node can't run the sidecar"; ok=""; }
fi
kill "$smoke_pid" 2>/dev/null || true; wait "$smoke_pid" 2>/dev/null || true
[ -n "$ok" ] || { echo "smoke test failed:"; tail -30 "$smoke_home/out.log"; exit 1; }
# running it must not have touched the (sealed) bundle
modified="$(find "$app" -newer "$before" -type f | head -5)"
[ -z "$modified" ] || { echo "the server wrote into the app bundle:"; echo "$modified"; exit 1; }
codesign --verify --deep --strict "$app"
rm -rf "$smoke_home" "$before"
echo "    ok"

echo "==> dmg"
mkdir -p "$out"; rm -f "$dmg"
stage="$build/dmg"; rm -rf "$stage"; mkdir -p "$stage"
cp -R "$app" "$stage/"; ln -s /Applications "$stage/Applications"
hdiutil create -quiet -volname "Workbench" -srcfolder "$stage" -ov -format UDZO "$dmg"
[ "$identity" = "-" ] || codesign --force --timestamp --sign "$identity" "$dmg"

if [ -n "${NOTARY_PROFILE:-}" ] && [ "$identity" != "-" ]; then
  echo "==> notarizing (a few minutes)"
  xcrun notarytool submit "$dmg" --keychain-profile "$NOTARY_PROFILE" --wait
  xcrun stapler staple "$dmg"
  spctl --assess --type open --context context:primary-signature -v "$dmg"
fi

shasum -a 256 "$dmg" | awk '{print $1}' > "$dmg.sha256"
if [ -n "${DOWNLOAD_URL:-}" ]; then
  printf '{"version":"%s","url":"%s"}\n' "$version" "$DOWNLOAD_URL" > "$out/latest.json"
fi
echo "==> $dmg ($(du -h "$dmg" | awk '{print $1}'), macOS $min_os or later, $arch)"
