defmodule Workbench.Automations.Run do
  @moduledoc """
  One firing of an automation. `started` made a thread and handed it the
  prompt (how the agent is doing is the thread's own status); `failed`
  couldn't (the error says why); `missed` was skipped because Workbench
  wasn't running when it was due, and is too late to catch up on.
  """
  use Ecto.Schema

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  @statuses ~w(started failed missed)

  schema "automation_runs" do
    field :automation_id, :binary_id
    field :thread_id, :binary_id
    field :status, :string
    field :error, :string
    # when it was due; nil for "Run now"
    field :scheduled_for, :utc_datetime_usec
    timestamps(type: :utc_datetime_usec, updated_at: false)
  end

  def statuses, do: @statuses

  def to_json(%__MODULE__{} = r), do: Map.take(r, [:id, :automation_id, :thread_id, :status, :error, :scheduled_for, :inserted_at])
end
