defmodule Workbench.Repo.Migrations.AddThreadPullRequest do
  use Ecto.Migration

  def change do
    alter table(:threads) do
      add(:pr_number, :integer)
      add(:pr_url, :string)
    end

    create(index(:threads, [:project_id, :pr_number]))
  end
end
