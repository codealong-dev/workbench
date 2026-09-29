import Config

config :workbench, Workbench.Repo,
  database: Path.expand("../_build/test/workbench_test.db", __DIR__),
  pool: Ecto.Adapters.SQL.Sandbox,
  pool_size: 5

config :workbench, WorkbenchWeb.Endpoint,
  http: [ip: {127, 0, 0, 1}, port: 4002],
  secret_key_base: "test-only-secret-key-base-test-only-secret-key-base-test-only-secret",
  server: false

config :workbench, token: "test-token", flush_ms: 5, migrate_on_boot: false

config :logger, level: :warning
config :phoenix, :plug_init_mode, :runtime
