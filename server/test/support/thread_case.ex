defmodule Workbench.ThreadCase do
  @moduledoc """
  Shared setup: a sandboxed repo in shared mode (thread servers run in their
  own processes), a temp working directory, and helpers to collect events.
  """
  use ExUnit.CaseTemplate

  using do
    quote do
      import Workbench.ThreadCase
      alias Workbench.{Items, Threads}
    end
  end

  setup tags do
    pid = Ecto.Adapters.SQL.Sandbox.start_owner!(Workbench.Repo, shared: not tags[:async])

    on_exit(fn ->
      for {_, child, _, _} <- DynamicSupervisor.which_children(Workbench.Threads.Supervisor),
          is_pid(child) do
        DynamicSupervisor.terminate_child(Workbench.Threads.Supervisor, child)
      end

      Ecto.Adapters.SQL.Sandbox.stop_owner(pid)
    end)

    dir = Path.join(System.tmp_dir!(), "wb-test-#{System.unique_integer([:positive])}")
    File.mkdir_p!(dir)
    on_exit(fn -> File.rm_rf!(dir) end)

    {:ok, dir: dir}
  end

  def create_thread(dir, attrs \\ %{}) do
    {:ok, thread} =
      Workbench.Threads.create(Map.merge(%{provider: "fake", worktree_path: dir, title: "test"}, attrs))

    thread
  end

  @doc "Receive events (flattening delta batches) until `stop?` returns true."
  def collect_until(stop?, timeout \\ 3_000) do
    do_collect([], stop?, System.monotonic_time(:millisecond) + timeout)
  end

  defp do_collect(acc, stop?, deadline) do
    left = max(deadline - System.monotonic_time(:millisecond), 0)

    receive do
      {:event, env} ->
        acc = [env | acc]
        if stop?.(env), do: Enum.reverse(acc), else: do_collect(acc, stop?, deadline)

      {:events, batch} ->
        case Enum.split_while(batch, &(not stop?.(&1))) do
          {before, []} -> do_collect(Enum.reverse(before) ++ acc, stop?, deadline)
          {before, [hit | _]} -> Enum.reverse(acc) ++ before ++ [hit]
        end
    after
      left -> flunk("timed out; got: #{inspect(Enum.reverse(acc) |> Enum.map(& &1["type"]))}")
    end
  end

  def type?(type), do: fn env -> env["type"] == type end

  def types(events), do: Enum.map(events, & &1["type"])
end
