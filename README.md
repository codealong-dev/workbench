# Workbench

A local-first workbench for running coding agents in parallel. A Phoenix app runs one supervised process per thread, streams normalized chat events from Claude Code (through the official Agent SDK in a Node sidecar), and renders them in a React UI built with Fluid Functionalism.

"Workbench" is a working name. The design is in the plan doc, "Agent Workbench: Technical Plan".

## Status

| Milestone | State |
|---|---|
| M0 spikes | Claude SDK and orphan-kill passed in the build sandbox; run `make spikes` on macOS to confirm |
| M1 one Claude thread end to end | Done: channel, `Threads.Server`, sidecar, chat UI |
| Pulled forward | Items persisted in SQLite (history survives reloads), resume via `session_id`, approvals, interrupt, mode switch, idle shutdown |
| M2 projects and worktrees | Next. Threads currently run directly in the directory you give them |

## Requirements

- Erlang/OTP 27+ and Elixir 1.17+ (`.tool-versions` pins what it was built with; erlexec needs OTP 27)
- Node 22+
- A working Claude Code login on this machine (`claude` in a terminal works)

## Run

```bash
make setup     # deps, DB, sidecar build
make dev       # Phoenix :4000 + Vite :5173; open http://127.0.0.1:5173
```

Press **+**, give it a directory, pick **Claude Code** (or **Fake** to work on the UI without spending tokens), and send a message.

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
