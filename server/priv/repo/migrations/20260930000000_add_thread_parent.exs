defmodule Workbench.Repo.Migrations.AddThreadParent do
  use Ecto.Migration

  # A child session shares its parent's worktree: another Claude or Codex
  # conversation on the same branch.
  def change do
    alter table(:threads) do
      add :parent_id, references(:threads, type: :binary_id, on_delete: :nilify_all)
    end

    create index(:threads, [:parent_id])
  end
end
