defmodule Workbench.OneShot do
  @moduledoc """
  One question to an agent, one answer: starts the provider on its own in a
  directory, sends one message, and returns the text of its last assistant
  message once the turn ends. Used where a small model writes something
  (`Workbench.Guide`, `Workbench.Commit`).

  The agent runs in plan mode, so it can read but not change anything.
  Nobody is there to approve, so approval requests are denied. The agent is
  linked to the calling process: if that is killed, the agent goes with it.

  `cfg` is `%{"provider", "model", "effort"}`; `opts`:

    * `:id` - names the run (`thread_id` the provider sees)
    * `:cwd` - where the agent runs
    * `:initial_context` - the workspace's shared context
    * `:timeout` - ms to wait for the answer
    * `:label` - for log lines
  """
  require Logger

  alias Workbench.Provider

  @doc "`{:ok, text}` or `{:error, message}`."
  def ask(cfg, text, opts) do
    Process.flag(:trap_exit, true)
    mod = Provider.module(cfg["provider"])

    open = %{
      thread_id: opts[:id],
      cwd: opts[:cwd],
      resume: nil,
      initial_context: opts[:initial_context],
      mode: "plan",
      model: cfg["model"],
      effort: cfg["effort"]
    }

    case mod.open(open) do
      {:ok, p} ->
        {:ok, p} = mod.send_turn(p, text, [])
        deadline = System.monotonic_time(:millisecond) + Keyword.fetch!(opts, :timeout)
        {result, p} = await(mod, p, "", nil, deadline, opts[:label] || "agent")
        mod.close(p)
        result

      {:error, reason} ->
        {:error, if(is_binary(reason), do: reason, else: inspect(reason))}
    end
  end

  defp await(mod, %{io: io, pid: pid} = p, buf, answer, deadline, label) do
    receive do
      {:stdout, ^io, data} ->
        [rest | lines] = String.split(buf <> data, "\n") |> Enum.reverse()

        case feed(mod, p, lines |> Enum.reverse() |> Enum.reject(&(String.trim(&1) == "")), answer) do
          {:cont, p, answer} -> await(mod, p, rest, answer, deadline, label)
          {:done, p, result} -> {result, p}
        end

      {:stderr, ^io, data} ->
        Logger.debug([label, " stderr: ", data])
        await(mod, p, buf, answer, deadline, label)

      {:EXIT, ^pid, reason} ->
        {{:error, "the agent exited before answering (#{inspect(reason)})"}, p}

      {:DOWN, _, :process, ^pid, reason} ->
        {{:error, "the agent exited before answering (#{inspect(reason)})"}, p}
    after
      max(deadline - System.monotonic_time(:millisecond), 0) ->
        {{:error, "the agent took too long to answer"}, p}
    end
  end

  defp feed(_mod, p, [], answer), do: {:cont, p, answer}

  defp feed(mod, p, [line | lines], answer) do
    {events, p} = mod.handle_line(p, line)

    case events(mod, p, events, answer) do
      {:cont, p, answer} -> feed(mod, p, lines, answer)
      done -> done
    end
  end

  # Keep the last assistant message; the turn ending is the answer.
  defp events(_mod, p, [], answer), do: {:cont, p, answer}

  defp events(mod, p, [event | rest], answer) do
    case event do
      %{"type" => "item.completed", "item" => %{"kind" => "assistant_message", "text" => text}} ->
        events(mod, p, rest, text)

      %{"type" => "approval.requested", "request_id" => id} ->
        {:ok, p} = mod.respond(p, id, "deny", nil)
        events(mod, p, rest, answer)

      %{"type" => "error", "fatal" => true, "message" => message} ->
        {:done, p, {:error, message}}

      %{"type" => "turn.completed", "status" => "ok"} ->
        {:done, p, if(answer, do: {:ok, answer}, else: {:error, "the agent answered nothing"})}

      %{"type" => "turn.completed", "status" => status} ->
        {:done, p, {:error, "the agent's turn ended: #{status}"}}

      _ ->
        events(mod, p, rest, answer)
    end
  end
end
