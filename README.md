# Workbench

A local-first workbench for running coding agents in parallel. A Phoenix app runs one supervised process per thread, streams normalized chat events from Claude Code (through the official Agent SDK in a Node sidecar), and renders them in a React UI built with Fluid Functionalism.

"Workbench" is a working name. The design is in the plan doc, "Agent Workbench: Technical Plan".

## Status

| Milestone | State |
|---|---|
| M0 spikes | Claude SDK and orphan-kill passed in the build sandbox; run `make spikes` on macOS to confirm |
| M1 one Claude thread end to end | Done: channel, `Threads.Server`, sidecar, chat UI |
| Pulled forward | Items persisted in SQLite (history survives reloads), resume via `session_id`, approvals, interrupt, mode switch, idle shutdown |
| M2 projects and worktrees | Done: projects, a worktree + `wb/<slug>` branch per thread, `.workbench.json` setup/teardown, archive, project sidebar |
| M3 control | Mostly done in M1 (approvals, stop, modes); tool rendering by name is in |
| M4 persistence | Mostly done in M1; "Load earlier" paging is left |
| M5 review | Done: changes panel (diff vs base, split/unified, untracked files), Open in Zed / VS Code / Cursor / Finder |
| M6 Codex | Next |

## Requirements

- Erlang/OTP 27+ and Elixir 1.17+ (`.tool-versions` pins what it was built with; erlexec needs OTP 27)
- Node 22+
- A working Claude Code login on this machine (`claude` in a terminal works)

## Run

```bash
make setup     # deps, DB, sidecar build
make dev       # Phoenix :4000 + Vite :5173; open http://127.0.0.1:5173
```

Add a project (any local git repo), then press **N** or **+** for a new thread. Each thread gets its own worktree at `~/.workbench/worktrees/<project>/<slug>` on branch `wb/<slug>`, cut from the base branch you pick. Pick **Claude Code**, or **Fake** to work on the UI without spending tokens.

**Changes** in the thread header shows the diff against the thread's base (merge base with the branch it was cut from, so commits and uncommitted edits both count; in-repo threads diff against HEAD). It refreshes whenever the agent finishes a turn. **Open in** opens the worktree in Zed, VS Code, Cursor or Finder, using the editor's CLI if it's on PATH or `open -a` otherwise; the icon on each file in the diff opens that file.

Archiving a thread stops the agent, runs teardown and deletes the worktree. The branch is kept.

### Project config

Optional `.workbench.json` at the repo root:

```json
{
  "setup": ["npm ci", "cp $WB_REPO/.env .env"],
  "teardown": ["docker compose down"]
}
```

Commands run with `sh -c` inside the worktree, with `WB_REPO` and `WB_WORKTREE` set. Setup output shows up in the thread as "Setup" tool calls; a failing step skips the rest but leaves the thread usable.

`make build && cd server && mix phx.server` serves the built UI from Phoenix at http://127.0.0.1:4000.

Data lives in `~/.workbench` (`WB_HOME` overrides it): the SQLite DB and the socket token.

## Layout

```
server/    Phoenix app (no LiveView, no HTML): channels, one GenServer per thread
  lib/workbench/threads/server.ex   the core: provider I/O, coalescing, persistence, status
  lib/workbench/provider/           behaviour + Claude (sidecar), Fake (replay/generated)
  lib/workbench_web/channels/       lobby + thread:<id> protocol
sidecar/   Node wrapper around @anthropic-ai/claude-agent-sdk; stdin ops in, events out
  src/normalize.ts                  the only code that knows SDK message shapes
web/       Vite + React + Fluid Functionalism
  src/contracts.ts                  the wire contract (mirrors the plan's table)
  src/store.ts                      applyEvent: the only reducer
fixtures/  recorded provider output for Provider.Fake and tests
spikes/    M0 checks
```

## Useful knobs

| Env | Effect |
|---|---|
| `WB_HOME` | Data dir (default `~/.workbench`) |
| `WB_FAKE_SCRIPT=fixtures/x.jsonl` | Fake provider replays a recording instead of generating replies |
| `WB_CLAUDE_BIN=$(which claude)` | Use your installed Claude Code instead of the SDK's pinned binary |
| `WB_SIDECAR` | Path to an alternative sidecar bundle |

## Tests

```bash
make test   # ExUnit (server, channels, real sidecar process via erlexec), sidecar normalize tests, web typecheck
```

## Billing

Claude runs through the Agent SDK on your own login, which counts as programmatic use of your subscription. Fine for personal use; don't distribute it running on other people's subscriptions.
