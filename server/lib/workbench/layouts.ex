defmodule Workbench.Layouts do
  @moduledoc """
  A workspace's dock layout (tabs, splits), stored as the UI's JSON. Opaque
  here: the server only keeps the latest one per root thread.
  """
  use Ecto.Schema
  alias Workbench.Repo

  @max_bytes 256_000

  @primary_key {:root_id, :binary_id, autogenerate: false}
  schema "workspace_layouts" do
    field :layout, :string
    timestamps(type: :utc_datetime_usec)
  end

  def get(root_id) do
    case Repo.get(__MODULE__, root_id) do
      nil -> nil
      row -> Jason.decode!(row.layout)
    end
  end

  def put(root_id, layout) when is_map(layout) do
    json = Jason.encode!(layout)

    if byte_size(json) > @max_bytes do
      {:error, "layout too large"}
    else
      now = DateTime.utc_now()

      Repo.insert_all(__MODULE__, [%{root_id: root_id, layout: json, inserted_at: now, updated_at: now}],
        on_conflict: {:replace, [:layout, :updated_at]},
        conflict_target: :root_id
      )

      :ok
    end
  end

  def put(_, _), do: {:error, "layout must be an object"}
end
