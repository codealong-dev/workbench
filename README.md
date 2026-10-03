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
| M6 macOS app | Done: login-shell PATH, `make install` (release + launchd agent at login), `make app` (native Workbench.app window), `make dist` (self-contained, signed `.dmg` for a website) |
| M7 remote machine | Done: `WB_BIND`/`WB_ORIGINS`, one-time login link for other machines, SSH "Open in", Push + Open PR. See [docs/remote.md](docs/remote.md) |
| M8 several machines | Next: one UI, threads on several nodes over Tailscale |
| M9 Codex | Done: `codex app-server` over JSON-RPC from Elixir; streaming, approvals (commands, file patches, permissions), interrupt, resume, modes |
| Questions + terminals | Done: AskUserQuestion (Claude) and request_user_input (Codex) as an answer card; real shells (PTY) in the worktree in the right panel |
| File tree + changes panel | Done: right panel with Files (worktree tree) and Changes tabs, diff/file tabs in a middle pane, +a −d pill opens the diff |
| M13 IDE workspace | Done: tabs for chats, terminals, changes and files; drag-and-drop splits saved per workspace; status bar; Monaco editing with editable per-file diffs, preview tabs, save conflict handling, live reload from a worktree watcher |
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
make dev       # Phoenix :4242 + Vite :5173; open http://127.0.0.1:5173
```

Add a project (any local git repo), then press **N** or **+** for a new thread. Choose the project, agent and worktree settings, then click **Next** to add optional initial context: task details, a Linear ticket, a Notion page link, or notes. This context is saved and passed to every agent created in the thread, including review sessions, guides and commit title agents. Links are plain references; Workbench does not fetch ticket or page contents. Each thread gets its own worktree at `~/.workbench/worktrees/<project>/<slug>` on branch `wb/<slug>`, cut from the base branch you pick. Pick **Claude Code**, or **Fake** to work on the UI without spending tokens.

**Workspace.** A thread and its sessions share one worktree, shown as one workspace. Everything you open is a tab along the top: each Claude or Codex chat, terminals, the changes, files. Things open full size; drag a tab onto an edge to split (or right-click a tab: Split right / down, maximize, close others), and the layout is saved per workspace on the server. The **+** on a tab strip starts a new Claude or Codex chat in this worktree, a terminal, or ⌘P to open a file. The status bar at the bottom shows the branch and its base, the worktree, **+a −d** (opens all the changes, unified or split), **Push** (`git push -u origin <branch>`, with an Open PR link), which agents are working or waiting, terminals, and **Open in** (the editor icon; VS Code unless you picked another) for VS Code, Zed, Cursor or Finder.

**Files and changes.** The explorer on the right (toggle it at the right end of the status bar) has **Files**, the worktree's tree (what git tracks plus new files, minus ignored ones), and **Changes**, what changed against the thread's base (merge base with the branch it was cut from; in-repo threads diff against HEAD). Click a file to open it in the editor (Monaco, VS Code's editor), or a change to open that file's diff with the base on the left and the file, editable, on the right. A single click opens a preview tab (italic) that the next click replaces; double-click, or start editing, to keep it. ⌘S saves. Workbench watches the worktree, so open files reload when an agent, a terminal or another editor changes them; if you have unsaved edits you choose between the disk version and yours.

**Sessions.** Click **Branch thread** (the ↳ icon) and choose Claude Code or Codex to start another session with the thread's initial context, in the same worktree and branch (no new worktree, no setup). You can get a second opinion or split work between agents on one branch. Sessions show nested under their thread. The number on a row is how many messages you've sent. The **⋮** menu contains archive actions.

**Initial context.** Every thread has an **Initial context** page beneath it in the sidebar, with a page icon. It opens as an editable Markdown buffer in Monaco. Save with **⌘S** or the save button to update the shared context for all its sessions. New agents receive the latest version, and existing agents pick it up on their next turn; saving does not interrupt work in progress. Unsaved edits stay in the editor when you switch tabs, and changes from another browser are checked before saving.

Archiving a thread stops the agent, runs teardown and deletes the worktree; its sessions are archived with it. The branch is kept. Archiving a session only stops and hides it.

**Reply to a part of an answer.** Select text in an agent's answer (or its thinking) and click the speech-bubble button next to it: the selection is attached above the message box, and goes out as a quote in front of what you type. It's plain markdown in the message, so it works the same with any agent.

**Images.** Drop images anywhere on a chat, paste a screenshot into the message box, or use the image button under it (PNG, JPEG, GIF, WebP; up to 10 per message; big ones are scaled down to 2000 px). They go to the agent as real image input (Claude image blocks, Codex `localImage`), and show above your message; click one to see it full size. Images an agent opens or makes (Claude reading a picture, Codex's view_image and image generation) show under that tool call. They're kept in `~/.workbench/uploads/<thread>` and deleted when the thread is archived.

**Questions.** When an agent asks you something (Claude's AskUserQuestion, Codex's request_user_input), the thread shows a card with the options, multi-select where the agent allows it, and a free-text "Other". **Skip** tells the agent to go on without an answer. What you picked stays in the timeline.

**Terminals.** Terminal tabs run real shells (your login shell on a PTY) in the thread's worktree. They keep running when you close the tab or reload (the last 256 KB of output is replayed), and archiving the thread closes them. ``Ctrl+` `` goes to the next terminal tab (opening one if there's none); ``Ctrl+Shift+` `` opens a new one.

**Workspace keys:** ⌘P open a file, ⌘\ split the current tab to the right, Ctrl+W close it, ⌘S save.

**Model and effort.** Under the message box: the model, its effort level and the permission mode, for Claude and Codex alike. The model picker offers your loadout for that lab (see Settings), or every model if you haven't picked one. The list comes from the agent itself (Claude Code's models, Codex's `model/list`) and is kept on the server across restarts; a change applies from the next response.

**Settings** (⌘, or the gear at the bottom of the sidebar) take over the sidebar with their own sections. **Models** turns labs on or off (Anthropic through Claude Code, OpenAI through Codex, the Fake agent); a lab that's off is hidden when you start a thread or a chat. For each lab you pick a loadout of up to three models, dragged into the order the picker shows them. To list a lab's models without a thread, Workbench starts its agent just to ask, then closes it (no turn, nothing spent). **Appearance** has the theme, **Keyboard shortcuts** the keys. Settings live on the server, so every browser shares them (the theme is per browser).

**Review.** The Changes view has a **Review** button. It starts a second agent (a session on the same worktree, titled "Review") in a panel to the right of the changes, and sends it your review prompt plus which changes to look at (the base and the changed files). The first time, there is nothing to start yet, so it sends you to **Settings → Review**, where you pick the agent, its model, effort and permissions, and write the prompt (a default is filled in). It's saved on the server; after that the button just runs it. Each click is a fresh review session, and further ones open beside the one you already have open.

**Guide.** The Changes view has a **Guide** tab, like Linear's review guide. **Generate guide** has a small model read the diff and group it into a few ordered chunks (core changes first, tests and low-signal files last), each with a title and a short explanation of why. You see a working indicator with a timer (and Cancel) while it runs, then each chunk as a row: its story and files on the left (tick a file as viewed), that chunk's diffs in a strip you scroll sideways on the right, and a rail of ticks at the edge to jump between chunks. The agent runs once, read-only, in the worktree and adds nothing to your chats. It defaults to Claude's Sonnet; **Settings → Guide** picks another agent, model and effort (say a Codex mini model) and the grouping instructions. The guide is kept per workspace: when the changes move on it stays, flagged as out of date, with new files in a last "Not in the guide" chunk until you regenerate.

**Pull requests.** **Pull requests** under New thread swaps the sidebar for your projects' GitHub pull requests (every project whose `origin` is on github.com), through the GitHub CLI, so it needs `gh` installed and `gh auth login` done. Tabs pick **All**, **Open** or **Merged**; the search box narrows the list by title, number, author, branch or repo; the filter button picks a **Repository**, an **Author** (you, or anyone in the list) and **Reviews** (review requested from you, reviewed by you, approved, changes requested, none). Click a pull request to open it as a new branch of its project (no dialog): Workbench fetches its head (`refs/pull/<n>/head`, forks too) into a worktree on a `wb/pr-<n>-…` branch, compared against `origin/<base>` (a merged one against its base as it was before the merge), puts its description in the initial context, and starts writing a guide. The workspace opens on the Changes' Guide beside a chat, and everything else (Review agent, chats, terminals, setup commands) works as in any thread. The row shows a spinner while it's checked out; after that the pull request shows its workspace's status dot, and clicking it goes straight there. **Back to threads** returns to the thread list, where the workspace is listed under its project.

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

`make build && cd server && mix phx.server` serves the built UI from Phoenix at http://127.0.0.1:4242.

### As a Mac app

```bash
make install     # release + launchd agent: starts at login, restarts on crash
```

Then build the app window:

```bash
make app         # Workbench.app in ~/Applications
```

It is a small native shell (`desktop/main.swift`, a `WKWebView`; needs the Xcode command line tools) around the server above, with its own Dock icon and menu bar, so browser shortcuts don't get in the way. It starts the launchd agent if the server isn't running; closing the window quits the app and leaves the server up. Links to other sites open in your browser. `PORT=4100 make app` if you installed the server on another port. It is only ad-hoc signed, so it runs on the Mac that built it; run `make app` again after changing `desktop/`.

To hand the app to other people (the server, Node and the UI all inside one `.dmg`, no `make install` needed), see [docs/distribution.md](docs/distribution.md): `make dist`, with your Developer ID to sign and notarize it.

Without the app, Safari's **File > Add to Dock** on http://127.0.0.1:4242 gives a standalone window too. `make logs`, `make restart`, `make stop` and `make uninstall` manage it; data stays in `~/.workbench`. After pulling new code, run `make install` again.

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
| `WB_WATCH_POLL=1` | Poll for file changes instead of FSEvents/inotify (Linux without inotify-tools) |

## Tests

```bash
make test   # ExUnit (server, channels, real sidecar process via erlexec), sidecar normalize tests, web typecheck
```

## Billing

Claude runs through the Agent SDK on your own login, which counts as programmatic use of your subscription. Fine for personal use; don't distribute it running on other people's subscriptions.
