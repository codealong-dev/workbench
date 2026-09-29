# M0 spikes

| # | Question | How | Status |
|---|---|---|---|
| 1 | Does the Agent SDK stream on my Claude login, with approvals over stdin? | `./spikes/01-claude-sdk.sh` (one small turn) | Passed in the build sandbox; run it on your Mac to confirm your login |
| 2 | Does `kill -9` on the BEAM leave agent processes behind? | `./spikes/02-orphans.sh` (no API calls) | Passed on Linux; run on macOS |
| 3 | Does Fluid Functionalism install into Vite + React? | Components are vendored in `web/src/components/ui`; add more with `npx shadcn@latest add @fluid/<name>` from `web/` | Done |

Codex (app-server handshake) moved to M6.
