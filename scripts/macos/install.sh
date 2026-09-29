#!/usr/bin/env bash
# Build a release and run it at login via launchd (macOS).
#   make install          # build + (re)load the agent
#   PORT=4100 make install
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
label="dev.workbench.server"
port="${PORT:-4000}"
wb_home="${WB_HOME:-$HOME/.workbench}"
agent="$HOME/Library/LaunchAgents/$label.plist"
release="$root/server/_build/prod/rel/workbench"

[ "$(uname)" = "Darwin" ] || { echo "install.sh is for macOS (launchd). On Linux, run the release under systemd."; exit 1; }

echo "==> building the sidecar and web UI"
make -C "$root" sidecar web >/dev/null

echo "==> building the release"
(cd "$root/server" && MIX_ENV=prod mix deps.get --only prod >/dev/null && MIX_ENV=prod mix release --overwrite --quiet)

echo "==> installing the launchd agent ($agent)"
mkdir -p "$wb_home/logs" "$(dirname "$agent")"
sed -e "s|__RELEASE__|$release|g" -e "s|__HOME__|$HOME|g" -e "s|__PORT__|$port|g" -e "s|__WB_HOME__|$wb_home|g" \
  "$root/scripts/macos/workbench.plist.template" > "$agent"
# M7: carry remote-access settings into the agent when they are set
for var in WB_BIND WB_ORIGINS WB_SSH_HOST; do
  if [ -n "${!var:-}" ]; then plutil -replace "EnvironmentVariables.$var" -string "${!var}" "$agent"; fi
done
plutil -lint "$agent" >/dev/null

launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$agent"

echo -n "==> waiting for http://127.0.0.1:$port "
for _ in $(seq 1 60); do
  if curl -fs "http://127.0.0.1:$port/api/health" >/dev/null; then echo "up"; break; fi
  echo -n "."; sleep 1
done
curl -fs "http://127.0.0.1:$port/api/health" >/dev/null || { echo; echo "not up yet; see: tail -f $wb_home/logs/workbench.log"; exit 1; }

cat <<MSG

Workbench runs at login now (logs: $wb_home/logs/workbench.log).
${WB_BIND:+Other machines: open the link from \`make link\` once in their browser.}

Dock app: in Safari, open http://127.0.0.1:$port and choose File > Add to Dock.
(Chrome: ⋮ > Cast, save and share > Install page as app.)
MSG
open "http://127.0.0.1:$port"
