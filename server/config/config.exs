import Config

config :workbench,
  ecto_repos: [Workbench.Repo],
  generators: [binary_id: true],
  # Built sidecar bundle (make sidecar). Overridable with WB_SIDECAR.
  sidecar_path: Path.expand("../../sidecar/dist/claude.js", __DIR__),
  # Stop a thread's agent process after this long without activity.
  idle_timeout_ms: :timer.minutes(15),
  # Text/reasoning deltas are pushed in batches at this interval.
  flush_ms: 30

config :workbench, WorkbenchWeb.Endpoint,
  adapter: Bandit.PhoenixAdapter,
  url: [host: "127.0.0.1"],
  render_errors: [formats: [json: WorkbenchWeb.ErrorJSON], layout: false],
  pubsub_server: Workbench.PubSub

config :logger, :default_formatter,
  format: "$time $metadata[$level] $message\n",
  metadata: [:thread_id]

config :phoenix, :json_library, Jason

import_config "#{config_env()}.exs"
