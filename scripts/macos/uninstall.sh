#!/usr/bin/env bash
# Stop Workbench and remove the launchd agent. Your data in ~/.workbench stays.
set -euo pipefail
label="dev.workbench.server"
agent="$HOME/Library/LaunchAgents/$label.plist"
launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
rm -f "$agent"
echo "Removed $label. Data in ${WB_HOME:-$HOME/.workbench} is untouched; delete the Dock app by dragging it out."
