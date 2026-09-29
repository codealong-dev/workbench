defmodule Workbench.Threads.Thread do
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  @providers ~w(claude codex fake)
  @modes ~w(default acceptEdits plan bypassPermissions)

  schema "threads" do
    field :project_id, :binary_id
    field :provider, :string
    field :title, :string
    field :branch, :string
    field :base_ref, :string
    field :worktree_path, :string
    field :session_id, :string
    field :mode, :string, default: "default"
    field :model, :string
    field :status, :string, default: "idle"
    field :archived_at, :utc_datetime_usec
    timestamps(type: :utc_datetime_usec)
  end

  def providers, do: @providers
  def modes, do: @modes

  def create_changeset(attrs) do
    %__MODULE__{}
    |> cast(attrs, [:project_id, :provider, :title, :branch, :base_ref, :worktree_path, :mode, :model])
    |> validate_required([:provider, :worktree_path])
    |> validate_inclusion(:provider, @providers)
    |> validate_inclusion(:mode, @modes)
    |> validate_change(:worktree_path, fn :worktree_path, path ->
      if File.dir?(path), do: [], else: [worktree_path: "is not a directory"]
    end)
  end

  def to_json(%__MODULE__{} = t) do
    Map.take(t, [
      :id,
      :project_id,
      :provider,
      :title,
      :branch,
      :base_ref,
      :worktree_path,
      :session_id,
      :mode,
      :model,
      :status,
      :archived_at,
      :inserted_at,
      :updated_at
    ])
  end
end
