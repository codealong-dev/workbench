defmodule Workbench.Models do
  @moduledoc """
  The models each provider offers, as the agent last reported them. Kept in
  memory and on disk (`<home>/models.json`), so the list survives restarts.

  One shape for every provider:

      %{"id" => "opus", "name" => "Opus 5.5", "description" => "...",
        "efforts" => [%{"value" => "high", "description" => "..."}],
        "default_effort" => "high" | nil}

  `id` is what goes back to the provider; `efforts` is empty when the model
  has no effort setting.

  A thread's agent fills the cache when it lists its models. Without a thread
  (the settings page), `list/2` starts the agent on its own just to ask, then
  closes it: no turn, so nothing is spent. One such probe per provider at a
  time; callers that ask meanwhile wait for the same answer.
  """
  use GenServer
  require Logger

  alias Workbench.Provider

  @probe_ms 20_000

  def start_link(_), do: GenServer.start_link(__MODULE__, nil, name: __MODULE__)

  def get(provider) do
    case :persistent_term.get({__MODULE__, provider}, :unset) do
      :unset ->
        models = Map.get(read_disk(), provider)
        :persistent_term.put({__MODULE__, provider}, models)
        models

      models ->
        models
    end
  end

  def put(provider, models) when is_list(models) do
    :persistent_term.put({__MODULE__, provider}, models)
    write_disk(Map.put(read_disk(), provider, models))
  end

  @doc false
  # tests: as if never listed
  def forget(provider) do
    :persistent_term.erase({__MODULE__, provider})
    write_disk(Map.delete(read_disk(), provider))
  end

  @doc "Every provider's cached list (providers never listed are left out)."
  def cached(providers), do: for(p <- providers, m = get(p), into: %{}, do: {p, m})

  @doc "The cached list, or (when there is none, or `refresh`) ask the agent."
  def list(provider, refresh \\ false) do
    case get(provider) do
      [_ | _] = models when not refresh -> {:ok, models}
      _ -> GenServer.call(__MODULE__, {:probe, provider}, @probe_ms + 5_000)
    end
  end

  # -- server -----------------------------------------------------------------

  @impl true
  def init(_), do: {:ok, %{}}

  @impl true
  def handle_call({:probe, provider}, from, probes) do
    case probes do
      %{^provider => p} ->
        {:noreply, %{probes | provider => %{p | waiters: [from | p.waiters]}}}

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

  def handle_info({:DOWN, ref, :process, _, reason}, probes),
    do: {:noreply, answer(probes, ref, {:error, "the model probe crashed: #{inspect(reason)}"})}

  defp answer(probes, ref, result) do
    case Enum.find(probes, fn {_, p} -> p.ref == ref end) do
      nil ->
        probes

      {provider, p} ->
        with {:ok, [_ | _] = models} <- result, do: put(provider, models)
        for from <- p.waiters, do: GenServer.reply(from, result)
        Map.delete(probes, provider)
    end
  end

  # -- the probe (its own process: provider output comes to the caller) -------

  defp probe(provider) do
    Process.flag(:trap_exit, true)
    mod = Provider.module(provider)

    opts = %{
      thread_id: "models-#{provider}",
      cwd: Workbench.Home.dir(),
      resume: nil,
      mode: "plan",
      model: nil,
      effort: nil
    }

    case mod.open(opts) do
      {:ok, p} ->
        {:ok, p} = mod.list_models(p)
        {result, p} = await(mod, p, "", System.monotonic_time(:millisecond) + @probe_ms)
        mod.close(p)
        result

      {:error, reason} ->
        {:error, if(is_binary(reason), do: reason, else: inspect(reason))}
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
            {found || Enum.find(events, &(&1["type"] == "models")), p}
          end)

        case found do
          nil -> await(mod, p, rest, deadline)
          %{"models" => [], "error" => e} -> {{:error, e}, p}
          %{"models" => models} -> {{:ok, models}, p}
        end

      {:stderr, ^io, data} ->
        Logger.debug(["model probe stderr: ", data])
        await(mod, p, buf, deadline)

      {:EXIT, ^pid, reason} ->
        {{:error, "the agent exited before listing its models (#{inspect(reason)})"}, p}

      {:DOWN, _, :process, ^pid, reason} ->
        {{:error, "the agent exited before listing its models (#{inspect(reason)})"}, p}
    after
      max(deadline - System.monotonic_time(:millisecond), 0) ->
        {{:error, "the agent did not list its models"}, p}
    end
  end

  # -- disk -------------------------------------------------------------------

  defp path, do: Path.join(Workbench.Home.dir(), "models.json")

  defp read_disk do
    with {:ok, json} <- File.read(path()),
         {:ok, %{} = m} <- Jason.decode(json),
         do: m,
         else: (_ -> %{})
  end

  defp write_disk(all) do
    tmp = path() <> ".tmp"
    with :ok <- File.write(tmp, Jason.encode!(all)), do: File.rename(tmp, path())
  end
end
