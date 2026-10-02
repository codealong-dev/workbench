# Distributing Workbench.app

`make dist` builds `dist/Workbench-<version>-<arch>.dmg`: a self-contained Mac app you can host on a website.

## What is inside

```
Workbench.app/Contents/
  MacOS/Workbench            the window (desktop/main.swift, a WKWebView)
  Resources/server/          the Elixir release (Erlang runtime included) with the web UI
  Resources/node/bin/node    Node, pinned and checksum-verified, for the Claude sidecar
  Resources/sidecar/         the sidecar and the Agent SDK as one bundled file
  Frameworks/                OpenSSL, copied from Homebrew and re-pointed (the Erlang crypto NIF needs it)
```

On launch the app starts the server from the bundle, owns it, and stops it on ⌘Q. Closing the window leaves the app (and any running agents) up; click the Dock icon to bring the window back. If something already answers on the port (for example the launchd server from `make install`), the app uses that instead of starting its own. Data is in `~/.workbench`, as always, and the log is `~/.workbench/logs/workbench.log`.

## What users need

- Apple Silicon, macOS 26 or later (see Limits)
- `git`, and Claude Code installed and logged in (`claude` works in a terminal). The app uses that `claude`; it does not ship its own copy
- For Codex threads: the Codex CLI and `codex login`

The app reads `PATH` from the user's login shell at boot, so a `claude` in `~/.local/bin` or Homebrew is found even when the app is opened from Finder. If it isn't found, starting a Claude thread shows an error that says how to install it.

## Releasing

One-time, needs a paid Apple Developer Program membership:

1. Create a **Developer ID Application** certificate (Xcode > Settings > Accounts > Manage Certificates, or developer.apple.com). Without it Gatekeeper blocks the download on other Macs.
2. Store notarization credentials in the keychain (use an app-specific password from appleid.apple.com):
   ```bash
   xcrun notarytool store-credentials workbench --apple-id you@example.com --team-id TEAMID --password xxxx-xxxx-xxxx-xxxx
   ```

Each release:

```bash
SIGN_IDENTITY="Developer ID Application: Your Name (TEAMID)" \
NOTARY_PROFILE=workbench \
DOWNLOAD_URL=https://example.com/downloads/Workbench-0.2.0-arm64.dmg \
make dist
```

Bump `version` in `server/mix.exs` first. The script builds everything, signs every binary with the hardened runtime (`desktop/entitlements.plist`), starts the bundled server as a smoke test (health, UI, and the sidecar under the bundled Node, and it fails if the server wrote into the sealed bundle), builds the DMG, then notarizes and staples it.

Upload `dist/Workbench-<version>-<arch>.dmg` to the site. If you set `DOWNLOAD_URL` the script also writes `dist/latest.json`; host it next to the DMG and the app tells users when a newer version exists (Workbench > Check for Updates…, and once at launch). Without `DOWNLOAD_URL` there is no update check. Publish the `.sha256` file too if you want users to verify.

Without `SIGN_IDENTITY` the build is ad-hoc signed: good for testing on your own Mac, blocked by Gatekeeper elsewhere.

## Limits

- **macOS 26+.** The floor is set by the Erlang that builds the release (Homebrew's Erlang is built for the macOS it was bottled on). A lower floor needs an Erlang built with `MACOSX_DEPLOYMENT_TARGET` set lower. `package.sh` reads the real minimum from the binaries, so the app's `LSMinimumSystemVersion` is always correct.
- **One architecture per build.** It builds for the Mac it runs on. An Intel build needs an Intel (or Rosetta) Erlang; a universal app would need both builds merged with `lipo`.
- **Not sandboxed, so no Mac App Store.** Workbench runs shells, git worktrees and arbitrary paths.
- **Port 4242** is fixed (the browser origin, and so the saved theme, depends on it). If another program has it, the app says so. `PORT=4100 make dist` builds for another port.
- **No Sparkle-style auto-install.** The update check only points to the download page.
- **Claude Code's license.** The Agent SDK's bundled `claude` binary is "All rights reserved" (Anthropic's legal terms), so it is not redistributed here. Bundling it is a decision to check with Anthropic's terms first.
