defmodule Workbench.Repo.Migrations.CreateCore do
  use Ecto.Migration

  def change do
    create table(:projects, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :name, :string, null: false
      add :repo_path, :string, null: false
      add :default_branch, :string
      timestamps(type: :utc_datetime_usec)
    end

    create unique_index(:projects, [:repo_path])

    create table(:threads, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :project_id, references(:projects, type: :binary_id, on_delete: :delete_all)
      add :provider, :string, null: false
      add :title, :string
      add :branch, :string
      add :base_ref, :string
      add :worktree_path, :string, null: false
      add :session_id, :string
      add :mode, :string, null: false, default: "default"
      add :model, :string
      add :status, :string, null: false, default: "idle"
      add :archived_at, :utc_datetime_usec
      timestamps(type: :utc_datetime_usec)
    end

    create index(:threads, [:project_id])

    create table(:items) do
      add :item_id, :string, null: false
      add :thread_id, references(:threads, type: :binary_id, on_delete: :delete_all), null: false
      add :turn_id, :string
      add :seq, :integer, null: false
      add :kind, :string, null: false
      add :payload, :map, null: false
      add :inserted_at, :utc_datetime_usec, null: false
    end

    create index(:items, [:thread_id, :seq])
    create unique_index(:items, [:thread_id, :item_id])
  end
end
