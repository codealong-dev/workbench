defmodule Workbench.Repo do
  use Ecto.Repo, otp_app: :workbench, adapter: Ecto.Adapters.SQLite3
end
