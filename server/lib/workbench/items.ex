defmodule Workbench.Items do
  @moduledoc """
  Completed timeline items: what the UI shows when a thread is opened.

  Payloads are the same maps the client timeline renders:

    * `%{"id", "kind" => "user_message" | "assistant_message" | "reasoning", "text", "turn_id"}`
    * `%{"id", "kind" => "tool", "name", "input", "output", "is_error", "truncated", "parent_id", "status"}`
    * `%{"id", "kind" => "turn", "turn_id", "status", "usage", "cost_usd"}`

  Deltas are never stored. The provider keeps the model's context; this table
  only keeps what the UI renders.
  """
  import Ecto.Query
  alias Workbench.Repo

  defmodule Item do
    @moduledoc false
    use Ecto.Schema

    schema "items" do
      field :item_id, :string
      field :thread_id, :binary_id
      field :turn_id, :string
      field :seq, :integer
      field :kind, :string
      field :payload, :map
      field :inserted_at, :utc_datetime_usec
    end
  end

  @doc "Insert or replace an item (tool items are upserted on completion)."
  def put(thread_id, seq, %{"id" => item_id, "kind" => kind} = payload) do
    row = %{
      item_id: item_id,
      thread_id: thread_id,
      turn_id: payload["turn_id"],
      seq: seq,
      kind: kind,
      payload: payload,
      inserted_at: DateTime.utc_now()
    }

    Repo.insert_all(Item, [row],
      on_conflict: {:replace, [:payload, :kind]},
      conflict_target: [:thread_id, :item_id]
    )

    :ok
  end

  @doc "The last `limit` items, oldest first. `before_seq` pages backwards."
  def last(thread_id, limit \\ 200, before_seq \\ nil) do
    Item
    |> where([i], i.thread_id == ^thread_id)
    |> then(fn q -> if before_seq, do: where(q, [i], i.seq < ^before_seq), else: q end)
    |> order_by([i], desc: i.seq)
    |> limit(^limit)
    |> select([i], %{seq: i.seq, payload: i.payload})
    |> Repo.all()
    |> Enum.reverse()
    |> Enum.map(fn %{seq: seq, payload: p} -> Map.put(p, "seq", seq) end)
  end

  def max_seq(thread_id) do
    Item
    |> where([i], i.thread_id == ^thread_id)
    |> select([i], max(i.seq))
    |> Repo.one() || 0
  end
end
