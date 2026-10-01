defmodule Workbench.Repo.Migrations.AddThreadInitialContext do
  use Ecto.Migration

  def change do
    alter table(:threads) do
      add(:initial_context, :text)
    end
  end
end
