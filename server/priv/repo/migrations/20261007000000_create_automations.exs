defmodule Workbench.Repo.Migrations.CreateAutomations do
  use Ecto.Migration

  # Scheduled agent runs (see Workbench.Automations).
  def change do
    create table(:automations, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :project_id, references(:projects, type: :binary_id, on_delete: :delete_all), null: false
      add :name, :string, null: false
      add :provider, :string, null: false
      add :prompt, :text, null: false
      add :schedule, :string, null: false
      add :enabled, :boolean, null: false, default: true
      add :next_run_at, :utc_datetime_usec
      add :last_run_at, :utc_datetime_usec
      timestamps(type: :utc_datetime_usec)
    end

    create table(:automation_runs, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :automation_id, references(:automations, type: :binary_id, on_delete: :delete_all), null: false
      add :thread_id, :binary_id
      add :status, :string, null: false
      add :error, :text
      add :scheduled_for, :utc_datetime_usec
      timestamps(type: :utc_datetime_usec, updated_at: false)
    end

    create index(:automation_runs, [:automation_id, :inserted_at])

    alter table(:threads) do
      add :automation_id, :binary_id
    end
  end
end
