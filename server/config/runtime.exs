import Config

home =
  System.get_env("WB_HOME") ||
    if(config_env() == :test,
      do: Path.join(System.tmp_dir!(), "workbench-test"),
      else: Path.expand("~/.workbench")
    )

config :workbench, home: home

if sidecar = System.get_env("WB_SIDECAR") do
  config :workbench, sidecar_path: sidecar
end

# erlexec refuses to spawn children as root unless told to (CI/containers).
if System.get_env("WB_ALLOW_ROOT") in ~w(1 true) do
  config :erlexec, root: true, user: "root"
end

# M7: listen beyond localhost (e.g. your Tailscale IP) and accept those origins.
#   WB_BIND=100.101.102.103  WB_ORIGINS=macmini,macmini.tail1234.ts.net
bind = System.get_env("WB_BIND")
origins = (System.get_env("WB_ORIGINS") || "") |> String.split(",", trim: true) |> Enum.map(&String.trim/1)

if config_env() != :test do
  ip =
    case bind && :inet.parse_address(String.to_charlist(bind)) do
      nil -> {127, 0, 0, 1}
      {:ok, ip} -> ip
      {:error, _} -> raise "WB_BIND=#{bind} is not an IP address"
    end

  port = String.to_integer(System.get_env("PORT") || "4000")
  config :workbench, WorkbenchWeb.Endpoint, http: [ip: ip, port: port]
  config :workbench, allowed_origins: Enum.uniq(origins ++ List.wrap(bind))
  if ssh_host = System.get_env("WB_SSH_HOST"), do: config(:workbench, ssh_host: ssh_host)

  config :workbench, Workbench.Repo,
    database: System.get_env("WB_DB") || Path.join(home, "workbench.db"),
    pool_size: 5,
    journal_mode: :wal

  if token = System.get_env("WB_TOKEN"), do: config(:workbench, token: token)
end

if config_env() == :prod do
  config :workbench, WorkbenchWeb.Endpoint,
    secret_key_base:
      System.get_env("SECRET_KEY_BASE") ||
        Base.encode64(:crypto.strong_rand_bytes(48)),
    server: true
end

# File watching for editors: FSEvents on macOS, inotify on Linux (needs
# inotify-tools). WB_WATCH_POLL=1 polls instead, e.g. on Linux without it.
if System.get_env("WB_WATCH_POLL") in ~w(1 true) do
  config :workbench, watch_opts: [backend: :fs_poll, interval: 1000]
end
