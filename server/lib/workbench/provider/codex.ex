defmodule Workbench.Provider.Codex do
  @moduledoc """
  Codex through `codex app-server`, spoken directly (no sidecar): JSON-RPC
  without the `jsonrpc` field, one message per line on stdio.

      initialize -> initialized -> thread/resume (else thread/start)
      send       -> turn/start {threadId, input, approvalPolicy, sandboxPolicy}
      interrupt  -> turn/interrupt {threadId, turnId}

  Approvals arrive as server *requests* and are answered with
  `{decision: accept | acceptForSession | decline}` (permissions requests
  with `{permissions, scope}`). Server requests Workbench can't handle get a
  JSON-RPC error back so Codex never hangs waiting.

  Codex has no per-thread mode setter, so the mode's approval policy and
  sandbox ride on every `turn/start`. Uses your Codex login (`codex login`).

  Shapes: `codex app-server generate-ts` for codex-cli 0.159 plus recorded
  sessions (fixtures/codex/). Unknown notifications are ignored.
  """
  @behaviour Workbench.Provider
  require Logger

  alias Workbench.Provider.Proc

  @max_output 8 * 1024

  @workspace_write %{
    "type" => "workspaceWrite",
    "writableRoots" => [],
    "networkAccess" => false,
    "excludeTmpdirEnvVar" => false,
    "excludeSlashTmp" => false
  }

  # our mode -> {approvalPolicy, thread sandbox mode, turn sandboxPolicy}
  @modes %{
    "plan" => {"untrusted", "read-only", %{"type" => "readOnly", "networkAccess" => false}},
    "default" => {"untrusted", "workspace-write", @workspace_write},
    "acceptEdits" => {"on-request", "workspace-write", @workspace_write},
    "bypassPermissions" => {"never", "danger-full-access", %{"type" => "dangerFullAccess"}}
  }

  def mode_policy(mode), do: Map.get(@modes, mode, @modes["default"])

  # -- Provider callbacks -----------------------------------------------------

  @impl true
  def open(opts) do
    bin = System.get_env("WB_CODEX_BIN") || System.find_executable("codex")

    cond do
      is_nil(bin) ->
        {:error, "codex not found on PATH (install it with `npm i -g @openai/codex`, then `codex login`)"}

      not File.exists?(bin) ->
        {:error, "codex not found at #{bin}"}

      true ->
        with {:ok, proc} <- Proc.start([bin, "app-server"], opts.cwd, []) do
          p = new_state(proc, opts, &Proc.write_json(proc.io, &1))

          {:ok,
           call(p, :initialize, "initialize", %{
             "clientInfo" => %{
               "name" => "workbench",
               "title" => "Workbench",
               "version" => "0.1.0"
             },
             "capabilities" => nil
           })}
        end
    end
  end

  @doc false
  # State for a Codex process; `write` sends one JSON message (tests pass their own).
  def new_state(proc, opts, write) do
    Map.merge(proc, %{
      write: write,
      next_id: 1,
      calls: %{},
      cwd: opts.cwd,
      mode: opts.mode,
      model: opts[:model],
      resume: opts[:resume],
      thread_id: nil,
      turn_id: nil,
      queued: [],
      interrupt_pending: false,
      approvals: %{},
      changes: %{},
      reasoning: %{},
      usage_total: nil,
      usage_base: nil
    })
  end

  @impl true
  def send_turn(%{thread_id: nil} = p, text), do: {:ok, %{p | queued: p.queued ++ [text]}}
  def send_turn(p, text), do: {:ok, start_turn(p, text)}

  @impl true
  def interrupt(%{thread_id: tid, turn_id: turn} = p) when is_binary(tid) and is_binary(turn) do
    {:ok, call(p, :interrupt, "turn/interrupt", %{"threadId" => tid, "turnId" => turn})}
  end

  # turn/start not answered yet: interrupt as soon as we know the turn id
  def interrupt(p), do: {:ok, %{p | interrupt_pending: true, queued: []}}

  @impl true
  def respond(p, request_id, decision, answers) do
    case Map.pop(p.approvals, request_id) do
      {nil, _} ->
        {:ok, p}

      {{rpc_id, method, params}, approvals} ->
        p.write.(%{"id" => rpc_id, "result" => approval_result(method, params, decision, answers)})
        {:ok, %{p | approvals: approvals}}
    end
  end

  @impl true
  def set_mode(p, mode), do: {:ok, %{p | mode: mode}}

  @impl true
  def handle_line(p, line) do
    case Jason.decode(line) do
      {:ok, %{"id" => id, "method" => method} = msg} ->
        server_request(p, id, method, msg["params"] || %{})

      {:ok, %{"id" => id, "result" => result}} ->
        response(p, id, {:ok, result})

      {:ok, %{"id" => id, "error" => error}} ->
        response(p, id, {:error, error})

      {:ok, %{"method" => method} = msg} ->
        notification(p, method, msg["params"] || %{})

      {:ok, _} ->
        {[], p}

      {:error, _} ->
        {[], p}
    end
  end

  @impl true
  def close(%{io: io}) do
    Proc.stop(io)
  catch
    _, _ -> :ok
  end

  # -- requests we send ---------------------------------------------------------

  defp call(p, kind, method, params) do
    p.write.(%{"id" => p.next_id, "method" => method, "params" => params})
    %{p | next_id: p.next_id + 1, calls: Map.put(p.calls, p.next_id, kind)}
  end

  defp thread_params(p) do
    {approval, sandbox, _} = mode_policy(p.mode)
    base = %{"cwd" => p.cwd, "approvalPolicy" => approval, "sandbox" => sandbox}
    if p.model, do: Map.put(base, "model", p.model), else: base
  end

  defp start_thread(p), do: call(p, :thread_start, "thread/start", thread_params(p))

  defp start_turn(p, text) do
    {approval, _, sandbox_policy} = mode_policy(p.mode)

    call(p, :turn_start, "turn/start", %{
      "threadId" => p.thread_id,
      "input" => [%{"type" => "text", "text" => text, "text_elements" => []}],
      "approvalPolicy" => approval,
      "sandboxPolicy" => sandbox_policy
    })
  end

  # -- responses ----------------------------------------------------------------

  defp response(p, id, result) do
    {kind, calls} = Map.pop(p.calls, id)
    handle_response(%{p | calls: calls}, kind, result)
  end

  defp handle_response(p, :initialize, {:ok, _}) do
    p.write.(%{"method" => "initialized"})

    p =
      if p.resume,
        do:
          call(
            p,
            :thread_resume,
            "thread/resume",
            Map.put(thread_params(p), "threadId", p.resume)
          ),
        else: start_thread(p)

    {[], p}
  end

  defp handle_response(p, :initialize, {:error, e}),
    do: {[fatal("Codex failed to initialize: #{msg(e)}")], p}

  defp handle_response(p, kind, {:ok, %{"thread" => %{"id" => tid}} = result})
       when kind in [:thread_start, :thread_resume] do
    p = %{p | thread_id: tid}
    started = %{"type" => "session.started", "session_id" => tid, "model" => result["model"]}
    {queued, p} = {p.queued, %{p | queued: []}}
    p = Enum.reduce(queued, p, &start_turn(&2, &1))
    {[started], p}
  end

  defp handle_response(p, :thread_resume, {:error, e}) do
    note = %{
      "type" => "error",
      "message" => "Could not resume the Codex session (#{msg(e)}); starting a new one.",
      "fatal" => false
    }

    {[note], start_thread(%{p | resume: nil})}
  end

  defp handle_response(p, :thread_start, {:error, e}),
    do: {[fatal("Codex could not start a thread: #{msg(e)}")], p}

  defp handle_response(p, :turn_start, {:ok, %{"turn" => %{"id" => turn}}}) do
    p = %{p | turn_id: turn}

    if p.interrupt_pending,
      do:
        {[],
         call(%{p | interrupt_pending: false}, :interrupt, "turn/interrupt", %{
           "threadId" => p.thread_id,
           "turnId" => turn
         })},
      else: {[], p}
  end

  defp handle_response(p, :turn_start, {:error, e}) do
    {[
       %{"type" => "error", "message" => "Codex rejected the turn: #{msg(e)}", "fatal" => false},
       %{"type" => "turn.completed", "turn_id" => nil, "status" => "error", "usage" => nil}
     ], p}
  end

  defp handle_response(p, _kind, _result), do: {[], p}

  # -- notifications --------------------------------------------------------------

  defp notification(p, "turn/started", %{"turn" => %{"id" => turn}}) do
    {[%{"type" => "turn.started", "turn_id" => turn}],
     %{p | turn_id: turn, usage_base: p.usage_total}}
  end

  defp notification(p, "item/started", %{"item" => item}), do: item_started(p, item)
  defp notification(p, "item/completed", %{"item" => item}), do: item_completed(p, item)

  defp notification(p, "item/agentMessage/delta", params) do
    text = params["delta"] || params["textDelta"] || ""
    {[%{"type" => "text.delta", "item_id" => params["itemId"], "text" => text}], p}
  end

  # Prefer reasoning summaries; raw reasoning text only when no summary streams.
  defp notification(p, "item/reasoning/summaryTextDelta", params),
    do: reasoning_delta(p, params, :summary)

  defp notification(p, "item/reasoning/textDelta", params),
    do: reasoning_delta(p, params, :content)

  defp notification(p, "thread/tokenUsage/updated", %{"tokenUsage" => %{"total" => total}}) do
    {[], %{p | usage_total: total}}
  end

  defp notification(p, "turn/completed", %{"turn" => turn}) do
    status =
      case turn["status"] do
        "completed" -> "ok"
        "interrupted" -> "interrupted"
        _ -> "error"
      end

    failure =
      case turn["error"] do
        %{"message" => m} when status == "error" ->
          [%{"type" => "error", "message" => m, "fatal" => false}]

        _ ->
          []
      end

    done = %{
      "type" => "turn.completed",
      "turn_id" => turn["id"],
      "status" => status,
      "usage" => usage(p),
      "cost_usd" => nil
    }

    {failure ++ [done], %{p | turn_id: nil, approvals: %{}, interrupt_pending: false}}
  end

  # willRetry errors are transient ("Reconnecting... 2/5"); the final failure
  # arrives with turn/completed status "failed".
  defp notification(p, "error", %{"willRetry" => true}), do: {[], p}

  defp notification(p, "error", %{"error" => %{"message" => m} = e}) do
    detail =
      if is_binary(e["additionalDetails"]), do: m <> ": " <> e["additionalDetails"], else: m

    {[%{"type" => "error", "message" => detail, "fatal" => false}], p}
  end

  defp notification(p, method, params)
       when method in ["warning", "configWarning", "deprecationNotice"] do
    Logger.info("codex #{method}: #{params["message"] || params["summary"]}")
    {[], p}
  end

  defp notification(p, _method, _params), do: {[], p}

  defp reasoning_delta(p, params, source) do
    id = params["itemId"]

    case Map.get(p.reasoning, id) do
      other when other != nil and other != source ->
        {[], p}

      _ ->
        {[%{"type" => "reasoning.delta", "item_id" => id, "text" => params["delta"] || ""}],
         %{p | reasoning: Map.put(p.reasoning, id, source)}}
    end
  end

  # -- items ------------------------------------------------------------------

  defp item_started(p, %{"type" => "commandExecution", "id" => id} = item) do
    {[tool_started(id, "Bash", %{"command" => item["command"], "cwd" => item["cwd"]})], p}
  end

  defp item_started(p, %{"type" => "fileChange", "id" => id} = item) do
    changes = Enum.map(item["changes"] || [], &Map.take(&1, ["path", "kind", "diff"]))

    {[tool_started(id, "Patch", %{"changes" => changes})],
     %{p | changes: Map.put(p.changes, id, changes)}}
  end

  defp item_started(p, %{"type" => "mcpToolCall", "id" => id} = item) do
    {[tool_started(id, "mcp__#{item["server"]}__#{item["tool"]}", item["arguments"] || %{})], p}
  end

  defp item_started(p, %{"type" => "dynamicToolCall", "id" => id} = item) do
    {[tool_started(id, item["tool"] || "tool", item["arguments"] || %{})], p}
  end

  defp item_started(p, %{"type" => "webSearch", "id" => id} = item) do
    {[tool_started(id, "WebSearch", %{"query" => item["query"]})], p}
  end

  defp item_started(p, _item), do: {[], p}

  defp item_completed(p, %{"type" => "agentMessage", "id" => id, "text" => text})
       when text != "" do
    {[
       %{
         "type" => "item.completed",
         "item" => %{"id" => id, "kind" => "assistant_message", "text" => text}
       }
     ], p}
  end

  defp item_completed(p, %{"type" => "reasoning", "id" => id} = item) do
    text =
      case {item["summary"] || [], item["content"] || []} do
        {[_ | _] = summary, _} -> Enum.join(summary, "\n\n")
        {[], content} -> Enum.join(content, "\n\n")
      end

    p = %{p | reasoning: Map.delete(p.reasoning, id)}

    if text == "",
      do: {[], p},
      else:
        {[
           %{
             "type" => "item.completed",
             "item" => %{"id" => id, "kind" => "reasoning", "text" => text}
           }
         ], p}
  end

  defp item_completed(p, %{"type" => "commandExecution", "id" => id} = item) do
    failed =
      item["status"] in ["failed", "declined"] or
        (is_integer(item["exitCode"]) and item["exitCode"] != 0)

    output =
      case {item["status"], item["aggregatedOutput"]} do
        {"declined", _} ->
          "Declined"

        {_, out} when is_binary(out) and out != "" ->
          out

        {_, _} ->
          if item["exitCode"] not in [nil, 0], do: "exit code #{item["exitCode"]}", else: ""
      end

    {[tool_completed(id, output, failed)], p}
  end

  defp item_completed(p, %{"type" => "fileChange", "id" => id} = item) do
    changes = item["changes"] || Map.get(p.changes, id, [])

    output =
      case item["status"] do
        "declined" -> "Declined"
        "failed" -> "Patch failed to apply"
        _ -> Enum.map_join(changes, "\n", &"#{change_letter(&1["kind"])} #{&1["path"]}")
      end

    {[tool_completed(id, output, item["status"] in ["failed", "declined"])],
     %{p | changes: Map.delete(p.changes, id)}}
  end

  defp item_completed(p, %{"type" => "mcpToolCall", "id" => id} = item) do
    case item do
      %{"error" => %{"message" => m}} ->
        {[tool_completed(id, m, true)], p}

      %{"result" => %{"content" => content}} ->
        {[tool_completed(id, content_text(content), false)], p}

      _ ->
        {[tool_completed(id, "", item["status"] == "failed")], p}
    end
  end

  defp item_completed(p, %{"type" => "dynamicToolCall", "id" => id} = item) do
    {[tool_completed(id, content_text(item["contentItems"] || []), item["success"] == false)], p}
  end

  defp item_completed(p, %{"type" => "webSearch", "id" => id} = item) do
    n = length(item["results"] || [])
    {[tool_completed(id, "#{n} results", false)], p}
  end

  defp item_completed(p, _item), do: {[], p}

  defp tool_started(id, name, input),
    do: %{"type" => "tool.started", "item_id" => id, "name" => name, "input" => input}

  defp tool_completed(id, output, is_error) do
    {out, truncated} = truncate(output || "")

    %{
      "type" => "tool.completed",
      "item_id" => id,
      "output" => out,
      "truncated" => truncated,
      "is_error" => is_error
    }
  end

  defp change_letter(%{"type" => "add"}), do: "A"
  defp change_letter(%{"type" => "delete"}), do: "D"
  defp change_letter(_), do: "M"

  defp content_text(content) when is_list(content) do
    Enum.map_join(content, "\n", fn
      %{"type" => "text", "text" => t} -> t
      %{"type" => "inputText", "text" => t} -> t
      %{"type" => "image"} -> "[image]"
      other -> Jason.encode!(other)
    end)
  end

  defp content_text(other), do: Jason.encode!(other)

  # -- server requests (approvals) ----------------------------------------------

  defp server_request(p, rpc_id, "item/commandExecution/requestApproval" = method, params) do
    input = %{"command" => params["command"], "cwd" => params["cwd"]}
    approval(p, rpc_id, method, params, "Bash", input)
  end

  defp server_request(p, rpc_id, "item/fileChange/requestApproval" = method, params) do
    input = %{
      "changes" => Map.get(p.changes, params["itemId"], []),
      "grantRoot" => params["grantRoot"]
    }

    approval(p, rpc_id, method, params, "Patch", input)
  end

  defp server_request(p, rpc_id, "item/permissions/requestApproval" = method, params) do
    approval(p, rpc_id, method, params, "Permissions", params["permissions"] || %{})
  end

  # Codex's request_user_input: same card as Claude's AskUserQuestion
  defp server_request(p, rpc_id, "item/tool/requestUserInput" = method, params) do
    questions =
      for q <- params["questions"] || [] do
        %{
          "id" => q["id"],
          "header" => q["header"] || "",
          "question" => q["question"] || "",
          "options" => Enum.map(q["options"] || [], &%{"label" => &1["label"], "description" => &1["description"] || ""}),
          "multiSelect" => false,
          "allowOther" => q["isOther"] == true or (q["options"] || []) == [],
          "secret" => q["isSecret"] == true
        }
      end

    approval(p, rpc_id, method, params, "AskUserQuestion", %{"questions" => questions})
  end

  defp server_request(p, rpc_id, method, _params) do
    p.write.(%{
      "id" => rpc_id,
      "error" => %{"code" => -32601, "message" => "#{method} is not supported by Workbench"}
    })

    {[
       %{
         "type" => "error",
         "message" => "Codex asked for #{method}, which Workbench doesn't support yet; declined.",
         "fatal" => false
       }
     ], p}
  end

  defp approval(p, rpc_id, method, params, tool, input) do
    request_id = "cx-#{rpc_id}"

    event = %{
      "type" => "approval.requested",
      "request_id" => request_id,
      "tool" => tool,
      "input" => input,
      "reason" => params["reason"]
    }

    {[event], %{p | approvals: Map.put(p.approvals, request_id, {rpc_id, method, params})}}
  end

  defp approval_result("item/tool/requestUserInput", _params, decision, answers) do
    picked = if decision == "answer", do: answers || %{}, else: %{}
    %{"answers" => Map.new(picked, fn {id, values} -> {id, %{"answers" => values}} end)}
  end

  defp approval_result("item/permissions/requestApproval", params, decision, _answers) do
    requested = params["permissions"] || %{}

    granted =
      if decision == "deny", do: %{}, else: Map.reject(requested, fn {_, v} -> is_nil(v) end)

    %{
      "permissions" => granted,
      "scope" => if(decision == "allow_session", do: "session", else: "turn")
    }
  end

  defp approval_result(_method, _params, decision, _answers) do
    %{
      "decision" =>
        %{"allow" => "accept", "allow_session" => "acceptForSession"}[decision] || "decline"
    }
  end

  # -- helpers ------------------------------------------------------------------

  defp usage(%{usage_total: nil}), do: nil

  defp usage(%{usage_total: total, usage_base: base}) do
    base = base || %{}
    d = fn key -> (total[key] || 0) - (base[key] || 0) end

    %{
      "input_tokens" => d.("inputTokens") - d.("cachedInputTokens"),
      "output_tokens" => d.("outputTokens"),
      "cache_read_input_tokens" => d.("cachedInputTokens"),
      "cache_creation_input_tokens" => 0
    }
  end

  defp fatal(message), do: %{"type" => "error", "message" => message, "fatal" => true}

  defp msg(%{"message" => m}), do: m
  defp msg(other), do: inspect(other)

  defp truncate(s) when byte_size(s) <= @max_output, do: {s, false}

  defp truncate(s), do: {valid_prefix(binary_part(s, 0, @max_output)), true}

  # drop a UTF-8 character cut in half at the end
  defp valid_prefix(bin) do
    if String.valid?(bin) or byte_size(bin) == 0,
      do: bin,
      else: valid_prefix(binary_part(bin, 0, byte_size(bin) - 1))
  end
end
