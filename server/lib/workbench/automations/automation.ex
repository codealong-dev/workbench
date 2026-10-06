defmodule Workbench.Automations.Automation do
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "automations" do
    field :project_id, :binary_id
    field :name, :string
    field :provider, :string
    field :prompt, :string
    # five-field cron, local time (Workbench.Cron)
    field :schedule, :string
    field :enabled, :boolean, default: true
    field :next_run_at, :utc_datetime_usec
    field :last_run_at, :utc_datetime_usec
    # the latest runs, newest first, filled in by Automations.list/0
    field :runs, {:array, :map}, virtual: true, default: []
    timestamps(type: :utc_datetime_usec)
  end

  def changeset(automation, attrs) do
    automation
    |> cast(attrs, [:project_id, :name, :provider, :prompt, :schedule, :enabled])
    |> update_change(:name, &(&1 && String.trim(&1)))
    |> update_change(:schedule, &(&1 && &1 |> String.split() |> Enum.join(" ")))
    |> validate_required([:project_id, :name, :provider, :prompt, :schedule])
    |> validate_inclusion(:provider, Workbench.Threads.Thread.providers())
    |> validate_change(:schedule, fn :schedule, expr ->
      case Workbench.Cron.parse(expr) do
        {:ok, _} -> []
        {:error, msg} -> [schedule: msg]
      end
    end)
  end

  def to_json(%__MODULE__{} = a) do
    a
    |> Map.take([:id, :project_id, :name, :provider, :prompt, :schedule, :enabled, :next_run_at, :last_run_at, :inserted_at, :updated_at])
    |> Map.put(:runs, Enum.map(a.runs, &Workbench.Automations.Run.to_json/1))
  end
end
