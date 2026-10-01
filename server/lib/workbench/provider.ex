defmodule Workbench.Provider do
  @moduledoc """
  Behaviour every agent adapter implements.

  An adapter owns one OS process (or, for `Fake`, one BEAM process) per thread
  and is driven by `Workbench.Threads.Server`, which is the only caller.

  Output reaches the server as messages sent to the calling process:

    * `{:stdout, io, binary}` - raw chunks; the server splits them into lines
      and calls `handle_line/2` for each complete line
    * `{:stderr, io, binary}` - logged
    * `{:EXIT, pid, reason}` or `{:DOWN, _ref, :process, pid, reason}` -
      the process exited

  `pstate.io` tags output and `pstate.pid` tags the exit, which is how the
  server knows a message belongs to the current provider process and not to
  one it already closed.

  Events are maps with string keys, shaped like the contracts table in the
  plan (`"type" => "text.delta"`, ...). The server adds `thread_id`, `seq` and
  `at` before broadcasting.
  """

  @type pstate :: %{required(:io) => term(), required(:pid) => pid(), optional(atom()) => term()}
  @type event :: %{required(String.t()) => term()}
  @type decision :: String.t()

  @type open_opts :: %{
          optional(:initial_context) => String.t() | nil,
          thread_id: String.t(),
          cwd: String.t(),
          resume: String.t() | nil,
          mode: String.t(),
          model: String.t() | nil,
          effort: String.t() | nil
        }

  @callback open(open_opts()) :: {:ok, pstate()} | {:error, term()}
  @typedoc "An image attached to a message: the stored file (see Workbench.Uploads)."
  @type image :: %{required(String.t()) => String.t()}

  @doc "Start a turn with the user's text and attached images (`%{\"path\", \"mime\"}`, possibly none)."
  @callback send_turn(pstate(), text :: String.t(), images :: [image()]) :: {:ok, pstate()} | {:error, term()}
  @callback interrupt(pstate()) :: {:ok, pstate()}
  @doc """
  Answer a pending request. `decision` is allow | allow_session | deny for
  approvals, or "answer" for an AskUserQuestion request, with `answers`
  mapping each question id to the picked labels (or typed text).
  """
  @callback respond(pstate(), request_id :: String.t(), decision(), answers :: %{String.t() => [String.t()]} | nil) ::
              {:ok, pstate()}
  @callback set_mode(pstate(), mode :: String.t()) :: {:ok, pstate()}
  @doc "Switch model and effort (nil = the provider's default) from the next response on."
  @callback set_model(pstate(), model :: String.t() | nil, effort :: String.t() | nil) :: {:ok, pstate()}
  @doc "Ask for the models on offer; they arrive as a `models` event (see Workbench.Models)."
  @callback list_models(pstate()) :: {:ok, pstate()}
  @doc "Ask for plan usage; it arrives as a `usage` event (see Workbench.Usage). Optional: providers without limits skip it."
  @callback list_usage(pstate()) :: {:ok, pstate()}
  @optional_callbacks list_usage: 1
  @callback handle_line(pstate(), line :: binary()) :: {[event()], pstate()}
  @callback close(pstate()) :: :ok

  @doc "Adapter module for a thread's provider name."
  def module("claude"), do: Workbench.Provider.Claude
  def module("codex"), do: Workbench.Provider.Codex
  def module("fake"), do: Workbench.Provider.Fake
  def module(other), do: raise(ArgumentError, "unsupported provider #{inspect(other)}")

  @doc "Decode one JSON line into events. Shared by adapters whose process already emits our events."
  def decode_line(line) do
    case Jason.decode(line) do
      {:ok, %{"type" => _} = event} -> [event]
      {:ok, _other} -> []
      {:error, _} -> [%{"type" => "error", "message" => "bad line from agent: #{String.slice(line, 0, 200)}", "fatal" => false}]
    end
  end
end
