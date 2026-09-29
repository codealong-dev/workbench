import Config

home = System.get_env("WB_HOME") || Path.expand("~/.workbench")

config :workbench, home: home

if sidecar = System.get_env("WB_SIDECAR") do
  config :workbench, sidecar_path: sidecar
end

# erlexec refuses to spawn children as root unless told to (CI/containers).
if System.get_env("WB_ALLOW_ROOT") in ~w(1 true) do
  config :erlexec, root: true, user: "root"
end

if config_env() != :test do
  config :workbench, Workbench.Repo,
    database: System.get_env("WB_DB") || Path.join(home, "workbench.db"),
    pool_size: 5,
    journal_mode: :wal

  if token = System.get_env("WB_TOKEN"), do: config(:workbench, token: token)
end

if config_env() == :prod do
  config :workbench, WorkbenchWeb.Endpoint,
    http: [ip: {127, 0, 0, 1}, port: String.to_integer(System.get_env("PORT") || "4000")],
    check_origin: ["//127.0.0.1", "//localhost"],
    secret_key_base:
      System.get_env("SECRET_KEY_BASE") ||
        Base.encode64(:crypto.strong_rand_bytes(48)),
    server: true
end
