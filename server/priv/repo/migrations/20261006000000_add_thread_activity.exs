defmodule Workbench.Repo.Migrations.AddThreadActivity do
  use Ecto.Migration

  def change do
    alter table(:threads) do
      add :activity, :string
    end
  end
end
