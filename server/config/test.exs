import Config

config :workbench, Workbench.Repo,
  database: Path.expand("../_build/test/workbench_test.db", __DIR__),
  pool: Ecto.Adapters.SQL.Sandbox,
  # one connection: thread servers share the test's sandbox connection, and
  # several connections racing to open the same SQLite file log "database is locked"
  pool_size: 1

config :workbench, WorkbenchWeb.Endpoint,
  http: [ip: {127, 0, 0, 1}, port: 4002],
  secret_key_base: "test-only-secret-key-base-test-only-secret-key-base-test-only-secret",
  server: false

config :workbench, token: "test-token", flush_ms: 5, migrate_on_boot: false, login_path: false

config :logger, level: :warning
config :phoenix, :plug_init_mode, :runtime

# no inotify-tools in CI containers: poll, quickly
config :workbench, watch_opts: [backend: :fs_poll, interval: 100]
