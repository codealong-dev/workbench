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
| M6 macOS app | Done: login-shell PATH, `make install` (release + launchd agent at login), Dock web app |
| M7 remote machine | Done: `WB_BIND`/`WB_ORIGINS`, one-time login link for other machines, SSH "Open in", Push + Open PR. See [docs/remote.md](docs/remote.md) |
| M8 several machines | Next: one UI, threads on several nodes over Tailscale |
| M9 Codex | Done: `codex app-server` over JSON-RPC from Elixir; streaming, approvals (commands, file patches, permissions), interrupt, resume, modes |
| Questions + terminals | Done: AskUserQuestion (Claude) and request_user_input (Codex) as an answer card; real shells (PTY) in the worktree in the right panel |
| File tree + changes panel | Done: right panel with Files (worktree tree) and Changes tabs, diff/file tabs in a middle pane, +a −d pill opens the diff |
| Sidebar + sessions | Done: Fluid Functionalism sidebar (inset, no icon rail, hover-peek, `[` toggles, drag to resize), search (⌘K), per-project filter, several Claude/Codex sessions per worktree as a tree, theme toggle |
| M10 polish | Next |

## Requirements

- Erlang/OTP 27+ and Elixir 1.17+ (`.tool-versions` pins what it was built with; erlexec needs OTP 27)
- Node 22+
- A working Claude Code login on this machine (`claude` in a terminal works)
- For Codex threads: the Codex CLI (`npm i -g @openai/codex`) and `codex login`

## Run

```bash
make setup     # deps, DB, sidecar build
make dev       # Phoenix :4000 + Vite :5173; open http://127.0.0.1:5173
```

Add a project (any local git repo), then press **N** or **+** for a new thread. Each thread gets its own worktree at `~/.workbench/worktrees/<project>/<slug>` on branch `wb/<slug>`, cut from the base branch you pick. Pick **Claude Code**, or **Fake** to work on the UI without spending tokens.

**Files and changes.** The panel on the right (toggle it with the icon at the far right of the thread header) has two tabs. **Files** is the worktree's file tree (what git tracks plus new files, minus ignored ones), with changed files coloured and a filter; click a file to read it. **Changes** lists what changed against the thread's base (merge base with the branch it was cut from, so commits and uncommitted edits both count; in-repo threads diff against HEAD), grouped by folder or as a tree, with **Push** (`git push -u origin <branch>`, plus an Open PR link). The **+a −d** pill in the header opens the full diff (unified or split). Diffs and open files sit in tabs in the middle pane and refresh when the agent finishes a turn. **Open in** (the editor icon; VS Code unless you picked another) opens the worktree in VS Code, Zed, Cursor or Finder, using the editor's CLI if it's on PATH or `open -a` otherwise; the ↗ icon on a file opens that file.

**Sessions.** A thread's **⋮** menu adds another Claude or Codex session to the same worktree and branch (no new worktree, no setup), so you can get a second opinion or split work between agents on one branch. Sessions show nested under their thread. The number on a row is how many messages you've sent. **Branch thread** (the ↳ icon) is a placeholder for now.

Archiving a thread stops the agent, runs teardown and deletes the worktree; its sessions are archived with it. The branch is kept. Archiving a session only stops and hides it.

**Questions.** When an agent asks you something (Claude's AskUserQuestion, Codex's request_user_input), the thread shows a card with the options, multi-select where the agent allows it, and a free-text "Other". **Skip** tells the agent to go on without an answer. What you picked stays in the timeline.

**Terminals.** The right panel's **Terminal** tab runs real shells (your login shell on a PTY) in the thread's worktree. Sessions of a thread share its terminals, they keep running when you close the tab or reload (the last 256 KB of output is replayed), and archiving the thread closes them. ``Ctrl+` `` opens the terminal, or moves to the next one if a terminal already has focus; ``Ctrl+Shift+` `` opens a new one.

**Model and effort.** Under the message box: the model, its effort level and the permission mode, for Claude and Codex alike. The list comes from the agent itself (Claude Code's models, Codex's `model/list`) the first time you open it; a change applies from the next response.

**Sidebar keys:** `[` hides or shows the sidebar (hover the left edge to peek while hidden), ⌘K / Ctrl+K searches threads by title, branch, agent or project, `N` opens a new thread.

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

### As a Mac app

```bash
make install     # release + launchd agent: starts at login, restarts on crash
```

Then in Safari open http://127.0.0.1:4000 and choose **File > Add to Dock** for a standalone window with its own Dock icon. `make logs`, `make restart`, `make stop` and `make uninstall` manage it; data stays in `~/.workbench`. After pulling new code, run `make install` again.

Launched outside a terminal, Workbench reads `PATH` from your login shell at boot, so Homebrew/asdf tools (`git`, `node`, `zed`) are found.

### On another machine

Run it on a Mac mini or Linux box and use it from your laptop over Tailscale: see [docs/remote.md](docs/remote.md).

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
| `WB_CODEX_BIN` | Path to the `codex` binary (default: `codex` on PATH) |
| `WB_SIDECAR` | Path to an alternative sidecar bundle |

## Tests

```bash
make test   # ExUnit (server, channels, real sidecar process via erlexec), sidecar normalize tests, web typecheck
```

## Billing

Claude runs through the Agent SDK on your own login, which counts as programmatic use of your subscription. Fine for personal use; don't distribute it running on other people's subscriptions.
