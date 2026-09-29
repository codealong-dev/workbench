import Config

config :workbench, WorkbenchWeb.Endpoint,
  http: [ip: {127, 0, 0, 1}, port: String.to_integer(System.get_env("PORT") || "4000")],
  check_origin: ["//127.0.0.1", "//localhost"],
  code_reloader: false,
  debug_errors: true,
  secret_key_base: "dev-only-secret-key-base-dev-only-secret-key-base-dev-only-secret-key"

config :workbench, Workbench.Repo, log: false

config :logger, :default_formatter, format: "[$level] $metadata$message\n"
config :phoenix, :stacktrace_depth, 20
config :phoenix, :plug_init_mode, :runtime
