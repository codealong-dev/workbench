# Running Workbench on another machine

Workbench runs where the code is. Put it on a Mac mini, a Linux box or a VPS
and drive it from your laptop's browser; the agents, repos and worktrees all
live on that machine.

## 1. Network: Tailscale, never a public port

Install [Tailscale](https://tailscale.com) on both machines and note the
server's Tailscale IP (`tailscale ip -4`, e.g. `100.101.102.103`) and name
(`macmini`, or `macmini.tail1234.ts.net`).

Workbench only listens on `127.0.0.1` unless told otherwise:

| Variable | Example | What it does |
| --- | --- | --- |
| `WB_BIND` | `100.101.102.103` | Address to listen on. Use the Tailscale IP, not `0.0.0.0`. |
| `WB_ORIGINS` | `macmini,macmini.tail1234.ts.net` | Host names your browser will use to reach it (checked on the WebSocket). The `WB_BIND` IP is always allowed. |
| `WB_SSH_HOST` | `macmini` or `tiago@macmini` | What your laptop's editor connects to over SSH for "Open in". Defaults to `<user>@<hostname>`. |
| `PORT` | `4242` | Port. |

## 2. On the server

```bash
git clone <this repo> ~/dev/projects/workbench && cd ~/dev/projects/workbench
make setup
claude            # log in to Claude Code once on this machine, then /exit
```

**macOS server** (runs at login via launchd):

```bash
WB_BIND=100.101.102.103 WB_ORIGINS=macmini WB_SSH_HOST=macmini make install
```

**Linux server** (systemd user service): build the release with
`make sidecar web && cd server && MIX_ENV=prod mix release`, then create
`~/.config/systemd/user/workbench.service`:

```ini
[Unit]
Description=Workbench
After=network-online.target

[Service]
ExecStart=%h/dev/projects/workbench/server/_build/prod/rel/workbench/bin/workbench start
Environment=PORT=4242 WB_BIND=100.101.102.103 WB_ORIGINS=box WB_SSH_HOST=box LANG=C.UTF-8
Restart=on-failure

[Install]
WantedBy=default.target
```

```bash
systemctl --user daemon-reload && systemctl --user enable --now workbench
loginctl enable-linger $USER   # keep it running when you're logged out
```

## 3. Sign in from your laptop, once

On the server:

```bash
make link HOST=macmini
# http://macmini:4242/?token=...
```

Open that link in your laptop's browser. It sets a cookie for a year and
redirects to the app. Without it the page shows a sign-in notice and never
reveals the token. (Browsers on the server itself never need the link.)

## 4. Working with the code

- **Open in Zed / VS Code / Cursor** from another machine becomes an SSH deep
  link (`zed://ssh/...`, `vscode://vscode-remote/ssh-remote+...`), so your
  local editor opens the worktree on the server. Needs SSH access to the
  server (`ssh macmini` works) and, for VS Code/Cursor, the Remote - SSH
  extension.
- **Push** in the changes panel runs `git push -u origin <branch>` on the
  server and, for GitHub/GitLab remotes, offers **Open PR**. Pull the branch
  on your laptop or review the PR.
- The server needs its own git credentials for pushing (SSH key or
  credential helper).
