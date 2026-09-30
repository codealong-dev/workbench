defmodule Workbench.Usage do
  @moduledoc """
  How much of a provider's plan limits is used, as the last running agent
  reported it. Limits belong to the account, so one cache per provider serves
  every thread, and each update is broadcast to every open thread channel.

  One shape for every provider (`nil` when the provider has no limits to show):

      %{"plan" => "max" | nil,
        "windows" => [%{"id" => "five_hour", "label" => "Session (5h)",
                        "used_pct" => 42.0, "resets_at" => "2026-09-30T18:00:00Z" | nil}]}
  """

  @topic "wb:usage"
  # how old the cache may be before a client asking to refresh starts an agent
  @stale_ms 60_000

  def topic, do: @topic
  def subscribe, do: Phoenix.PubSub.subscribe(Workbench.PubSub, @topic)

  @doc "The last usage as `{usage, fetched_at_ms}`, or nil if never fetched."
  def get(provider), do: :persistent_term.get({__MODULE__, provider}, nil)

  def stale?(provider) do
    case get(provider) do
      nil -> true
      {_usage, at} -> System.system_time(:millisecond) - at > @stale_ms
    end
  end

  def put(provider, usage) do
    :persistent_term.put({__MODULE__, provider}, {usage, System.system_time(:millisecond)})
    Phoenix.PubSub.broadcast(Workbench.PubSub, @topic, {:usage, provider, usage})
  end
end
