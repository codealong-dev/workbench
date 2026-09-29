#!/usr/bin/env bash
# M0 spike 2: kill -9 the BEAM in the middle of a turn. Nothing it spawned may
# survive: not the sidecar, not its child, not a grandchild shell.
set -euo pipefail
cd "$(dirname "$0")/../server"

export WB_HOME="$(mktemp -d)" WB_SIDECAR="$(cd ../spikes/support && pwd)/slow_sidecar.js" PORT=4099
work="$(mktemp -d)"

mix run --no-halt -e '
  File.write!(Path.join(System.get_env("WB_HOME"), "beam-pid"), System.pid())
  {:ok, t} = Workbench.Threads.create(%{provider: "claude", worktree_path: System.argv() |> hd(), title: "spike"})
  :ok = Workbench.Threads.send_message(t.id, "go")
' -- "$work" >"$WB_HOME/log" 2>&1 &

for _ in $(seq 1 120); do [ -s "$WB_HOME/agent-pids" ] && break; sleep 0.5; done
[ -s "$WB_HOME/agent-pids" ] || { echo "sidecar never started; log:"; cat "$WB_HOME/log"; exit 1; }
sleep 1

beam=$(cat "$WB_HOME/beam-pid")
read -r -a agents < "$WB_HOME/agent-pids"
# sidecar, its child, the grandchild shell and whatever that shell spawned
all=("${agents[@]}" $(pgrep -P "${agents[2]}" || true))
echo "BEAM $beam; agent tree: ${all[*]}"

kill -9 "$beam"
sleep 4

alive=()
for p in "${all[@]}"; do kill -0 "$p" 2>/dev/null && alive+=("$p"); done
if [ ${#alive[@]} -eq 0 ]; then
  echo "PASS: nothing left running"
else
  echo "FAIL: still running:"; ps -o pid,ppid,pgid,command -p "$(IFS=,; echo "${alive[*]}")"
  exit 1
fi
