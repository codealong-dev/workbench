defmodule Workbench.Repo.Migrations.AddThreadEffort do
  use Ecto.Migration

  def change do
    alter table(:threads) do
      add :effort, :string
    end
  end
end
