defmodule Workbench.Repo.Migrations.CreateWorkspaceLayouts do
  use Ecto.Migration

  # The tabs and splits of a workspace (a root thread's worktree), as the UI
  # serialized them, so every browser opens the same layout.
  def change do
    create table(:workspace_layouts, primary_key: false) do
      add :root_id, references(:threads, type: :binary_id, on_delete: :delete_all), primary_key: true
      add :layout, :text, null: false
      timestamps(type: :utc_datetime_usec)
    end
  end
end
