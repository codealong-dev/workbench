defmodule Workbench.Repo.Migrations.CreateReviewGuides do
  use Ecto.Migration

  # The latest review guide of a workspace (a root thread's worktree), and
  # the fingerprint of the changes it was written for (see Workbench.Guide).
  def change do
    create table(:review_guides, primary_key: false) do
      add :root_id, references(:threads, type: :binary_id, on_delete: :delete_all), primary_key: true
      add :fingerprint, :string, null: false
      add :value, :text, null: false
      timestamps(type: :utc_datetime_usec)
    end
  end
end
