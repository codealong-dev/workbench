defmodule Workbench.Threads.Thread do
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  @providers ~w(claude codex fake)
  @modes ~w(default acceptEdits plan bypassPermissions)

  schema "threads" do
    field :project_id, :binary_id
    field :parent_id, :binary_id
    field :provider, :string
    field :title, :string
    field :branch, :string
    field :base_ref, :string
    field :worktree_path, :string
    field :session_id, :string
    field :mode, :string, default: "default"
    field :model, :string
    field :effort, :string
    field :status, :string, default: "idle"
    field :archived_at, :utc_datetime_usec
    # user messages sent, filled in by `Threads.list/0`
    field :message_count, :integer, virtual: true
    timestamps(type: :utc_datetime_usec)
  end

  def providers, do: @providers
  def modes, do: @modes

  def create_changeset(attrs) do
    %__MODULE__{}
    |> cast(attrs, [:project_id, :parent_id, :provider, :title, :branch, :base_ref, :worktree_path, :mode, :model, :effort])
    |> validate_required([:provider, :worktree_path])
    |> validate_inclusion(:provider, @providers)
    |> validate_inclusion(:mode, @modes)
    |> validate_change(:worktree_path, fn :worktree_path, path ->
      if File.dir?(path), do: [], else: [worktree_path: "is not a directory"]
    end)
  end

  # message_count is only known to Threads.list/0; upserts leave it out so
  # clients keep the count they have.
  def to_json(%__MODULE__{} = t) do
    t
    |> Map.take([
      :id,
      :project_id,
      :parent_id,
      :provider,
      :title,
      :branch,
      :base_ref,
      :worktree_path,
      :session_id,
      :mode,
      :model,
      :effort,
      :status,
      :message_count,
      :archived_at,
      :inserted_at,
      :updated_at
    ])
    |> Map.reject(fn {k, v} -> k == :message_count and is_nil(v) end)
  end
end
