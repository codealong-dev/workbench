# Codex fixtures

`interrupted-turn.jsonl`: everything `codex app-server` (codex-cli 0.159.2)
wrote during a real session: initialize, thread/start, turn/start, two
retrying `error` notifications, turn/interrupt and turn/completed
(interrupted), then a failed thread/resume. Recorded without network access
to OpenAI, so no model output; paths replaced with `/work/proj`.

`test/workbench/codex_provider_test.exs` replays it through
`Workbench.Provider.Codex.handle_line/2`. Richer flows (streaming, approvals,
patches) run against `test/support/stubs/codex_app_server_stub.js`, which
follows the generated protocol types (`codex app-server generate-ts`).
