defmodule Workbench.Repo.Migrations.CreateSettings do
  use Ecto.Migration

  # App-wide preferences, one JSON value per key (see Workbench.Settings).
  def change do
    create table(:settings, primary_key: false) do
      add :key, :string, primary_key: true
      add :value, :text, null: false
      timestamps(type: :utc_datetime_usec)
    end
  end
end
