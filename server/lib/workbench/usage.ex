defmodule Workbench.Usage do
  @moduledoc """
  How much of a provider's plan limits is used, as the last running agent
  reported it. Limits belong to the account, so one cache per provider serves
  every thread, and each update is broadcast to the lobby and thread channels.
  Account probes also work without an open chat and never send a turn.

  One shape for every provider (`nil` when the provider has no limits to show):

      %{"plan" => "max" | nil,
        "windows" => [%{"id" => "five_hour", "label" => "Session (5h)",
                        "used_pct" => 42.0, "resets_at" => "2026-09-30T18:00:00Z" | nil}]}
  """
  use GenServer
  alias Workbench.Provider

  @topic "wb:usage"
  # how old the cache may be before a client asking to refresh starts an agent
  @stale_ms 60_000
  @probe_ms 20_000

  def start_link(_), do: GenServer.start_link(__MODULE__, %{}, name: __MODULE__)

  def topic, do: @topic
  def subscribe, do: Phoenix.PubSub.subscribe(Workbench.PubSub, @topic)

  @doc "The last usage as `{usage, fetched_at_ms}`, or nil if never fetched."
  def get(provider), do: :persistent_term.get({__MODULE__, provider}, nil)

  def cached(providers) do
    for p <- providers,
        {usage, at} <- [get(p)],
        into: %{},
        do: {p, %{usage: usage, fetched_at: at}}
  end

  def list(provider, refresh? \\ false) do
    case get(provider) do
      {usage, at} when not refresh? ->
        if System.system_time(:millisecond) - at <= @stale_ms,
          do: {:ok, usage},
          else: GenServer.call(__MODULE__, {:probe, provider}, @probe_ms + 5_000)

      _ ->
        GenServer.call(__MODULE__, {:probe, provider}, @probe_ms + 5_000)
    end
  end

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

  @impl true
  def init(probes), do: {:ok, probes}

  @impl true
  def handle_call({:probe, provider}, from, probes) do
    case probes do
      %{^provider => p} ->
        {:noreply, Map.put(probes, provider, %{p | waiters: [from | p.waiters]})}

      _ ->
        task = Task.Supervisor.async_nolink(Workbench.TaskSupervisor, fn -> probe(provider) end)
        {:noreply, Map.put(probes, provider, %{ref: task.ref, waiters: [from]})}
    end
  end

  @impl true
  def handle_info({ref, result}, probes) when is_reference(ref) do
    Process.demonitor(ref, [:flush])
    {:noreply, answer(probes, ref, result)}
  end

  def handle_info({:DOWN, ref, :process, _, _reason}, probes),
    do: {:noreply, answer(probes, ref, {:error, "Could not read account usage"})}

  defp answer(probes, ref, result) do
    case Enum.find(probes, fn {_, p} -> p.ref == ref end) do
      nil ->
        probes

      {provider, p} ->
        with {:ok, usage} <- result, do: put(provider, usage)
        for from <- p.waiters, do: GenServer.reply(from, result)
        Map.delete(probes, provider)
    end
  end

  defp probe(provider) do
    Process.flag(:trap_exit, true)
    mod = Provider.module(provider)

    opts = %{
      thread_id: "usage-#{provider}",
      cwd: Workbench.Home.dir(),
      resume: nil,
      mode: "plan",
      model: nil,
      effort: nil,
      probe: true
    }

    with true <- Code.ensure_loaded?(mod) and function_exported?(mod, :list_usage, 1),
         {:ok, p} <- mod.open(opts) do
      try do
        {:ok, p} = mod.list_usage(p)
        await(mod, p, "", System.monotonic_time(:millisecond) + @probe_ms)
      after
        mod.close(p)
      end
    else
      false -> {:ok, nil}
      {:error, reason} -> {:error, if(is_binary(reason), do: reason, else: inspect(reason))}
    end
  end

  defp await(mod, %{io: io, pid: pid} = p, buf, deadline) do
    receive do
      {:stdout, ^io, data} ->
        [rest | lines] = String.split(buf <> data, "\n") |> Enum.reverse()

        {found, p} =
          lines
          |> Enum.reverse()
          |> Enum.reject(&(String.trim(&1) == ""))
          |> Enum.reduce({nil, p}, fn line, {found, p} ->
            {events, p} = mod.handle_line(p, line)

            {found ||
               Enum.find(
                 events,
                 &(&1["type"] == "usage" or (&1["type"] == "error" and &1["fatal"]))
               ), p}
          end)

        case found do
          nil -> await(mod, p, rest, deadline)
          %{"error" => error} -> {:error, error}
          %{"type" => "error", "message" => error} -> {:error, error}
          %{"usage" => usage} -> {:ok, usage}
        end

      {:stderr, ^io, _data} ->
        await(mod, p, buf, deadline)

      {:EXIT, ^pid, _reason} ->
        {:error, "Agent exited before reporting usage"}

      {:DOWN, _, :process, ^pid, _reason} ->
        {:error, "Agent exited before reporting usage"}
    after
      max(deadline - System.monotonic_time(:millisecond), 0) ->
        {:error, "Account usage timed out"}
    end
  end
end
