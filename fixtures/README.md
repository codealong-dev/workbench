# Fixtures

Recorded provider output (one normalized event per line) for `Provider.Fake`:

```bash
WB_FAKE_SCRIPT=../fixtures/claude-approval.jsonl mix phx.server
```

Then create a thread with the "Fake" provider. Each send replays the next turn
(turns are split by `{"fake":"turn"}` lines; `{"fake":"sleep","ms":50}` pauses).

- `claude-approval.jsonl`: a real Claude Code turn from the sidecar: Bash
  approval, tool output, final message.

To record more, pipe ops into `node sidecar/dist/claude.js` and keep its stdout.
