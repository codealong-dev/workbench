defmodule Workbench.Provider.Claude do
  @moduledoc """
  Claude Code through the Node sidecar (`sidecar/`), which wraps the official
  Agent SDK and already emits our normalized events on stdout, one per line.

  stdin ops: `start`, `send`, `interrupt`, `approve`, `set_mode`, `set_model`, `models`, `usage`, `stop`.
  """
  @behaviour Workbench.Provider

  alias Workbench.Provider.Proc

  @impl true
  def open(opts) do
    sidecar = Application.fetch_env!(:workbench, :sidecar_path)
    node = System.get_env("WB_NODE") || System.find_executable("node")

    cond do
      is_nil(node) ->
        {:error, "node not found on PATH"}

      not File.exists?(sidecar) ->
        {:error, "sidecar not built: #{sidecar} (run `make sidecar`)"}

      true ->
        # By default the SDK runs its own pinned Claude Code binary (same
        # login as your terminal). Set WB_CLAUDE_BIN to use another one.
        env =
          case System.get_env("WB_CLAUDE_BIN") do
            nil -> []
            bin -> [{"WB_CLAUDE_BIN", bin}]
          end

        with {:ok, %{io: io} = proc} <- Proc.start([node, sidecar], opts.cwd, env) do
          Proc.write_json(io, %{
            op: "start",
            cwd: opts.cwd,
            resume: opts[:resume],
            initial_context: opts[:initial_context],
            model: opts[:model],
            effort: opts[:effort],
            mode: opts.mode
          })

          {:ok, proc}
        end
    end
  end

  @impl true
  def send_turn(%{io: io} = p, text, images) do
    Proc.write_json(io, %{op: "send", text: text, images: images})
    {:ok, p}
  end

  @impl true
  def interrupt(%{io: io} = p) do
    Proc.write_json(io, %{op: "interrupt"})
    {:ok, p}
  end

  @impl true
  def respond(%{io: io} = p, request_id, decision, answers) do
    Proc.write_json(io, %{op: "approve", request_id: request_id, decision: decision, answers: answers})
    {:ok, p}
  end

  @impl true
  def set_model(%{io: io} = p, model, effort) do
    Proc.write_json(io, %{op: "set_model", model: model, effort: effort})
    {:ok, p}
  end

  @impl true
  def list_models(%{io: io} = p) do
    Proc.write_json(io, %{op: "models"})
    {:ok, p}
  end

  @impl true
  def list_usage(%{io: io} = p) do
    Proc.write_json(io, %{op: "usage"})
    {:ok, p}
  end

  @impl true
  def set_mode(%{io: io} = p, mode) do
    Proc.write_json(io, %{op: "set_mode", mode: mode})
    {:ok, p}
  end

  @impl true
  def handle_line(p, line), do: {Workbench.Provider.decode_line(line), p}

  @impl true
  def close(%{io: io}) do
    Proc.write_json(io, %{op: "stop"})
    Proc.stop(io)
  catch
    _, _ -> :ok
  end
end
