#!/usr/bin/env bash
# M0 spike 1: the sidecar streams a reply on your Claude login and an approval
# round trip works over stdin. Costs one small turn on your subscription.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
[ -f "$root/sidecar/dist/claude.js" ] || make -C "$root" sidecar

dir="$(mktemp -d)"; cd "$dir"
mkfifo in; exec 3<>in
node "$root/sidecar/dist/claude.js" <in >out 2>err &
pid=$!

echo '{"op":"start","mode":"default"}' >&3
echo '{"op":"send","text":"Use the Bash tool to run exactly: touch spike.txt && echo made. Then reply with one short sentence."}' >&3

wait_for() { for _ in $(seq 1 120); do grep -q "$1" out && return 0; sleep 1; done; echo "timed out waiting for $1"; cat out err; exit 1; }
wait_for '"approval.requested"'
rid=$(grep '"approval.requested"' out | head -1 | sed -E 's/.*"request_id":"([^"]+)".*/\1/')
echo "{\"op\":\"approve\",\"request_id\":\"$rid\",\"decision\":\"allow\"}" >&3
wait_for '"turn.completed"'
echo '{"op":"stop"}' >&3; wait $pid || true

echo "--- events (deltas hidden)"; grep -v 'delta"' out
grep -q '"text.delta"' out && echo "PASS: streamed text" || echo "FAIL: no text deltas"
[ -f spike.txt ] && echo "PASS: approval round trip (spike.txt created)" || echo "FAIL: spike.txt missing"
grep -q '"status":"ok"' out && echo "PASS: turn ok" || { echo "FAIL: turn not ok"; tail -5 err; }
