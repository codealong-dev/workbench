defmodule Workbench.Provider.Fake do
  @moduledoc """
  A provider that needs no agent: for tests and UI work.

  With `WB_FAKE_SCRIPT=path.jsonl` (or `config :workbench, fake_script: path`)
  it replays recorded events, one turn per `send`. Turns are separated by
  `{"fake":"turn"}` lines, `{"fake":"sleep","ms":50}` pauses, and every other
  line is an event. The script loops; ids get a per-turn suffix so they stay
  unique.

  Without a script it generates a reply that echoes the prompt with some
  markdown, a reasoning block and a Bash tool call. A prompt containing
  "approve" also asks for approval before the tool runs; attached images come
  back from a Read, so both directions can be tried without an agent.

  Output goes through the same `{:stdout, io, line}` path as real agents, so
  the server's line handling is exercised too.
  """
  @behaviour Workbench.Provider

  @line_delay 12

  @impl true
  def open(opts) do
    server = self()
    turns = load_script()
    session_id = opts[:resume] || "fake-" <> Integer.to_string(System.unique_integer([:positive]))
    pid = spawn(fn -> init_replayer(server, session_id, turns) end)
    Process.monitor(pid)
    {:ok, %{io: pid, pid: pid}}
  end

  @impl true
  def send_turn(%{io: pid} = p, text, images) do
    send(pid, {:send, text, images})
    {:ok, p}
  end

  @impl true
  def interrupt(%{io: pid} = p) do
    send(pid, :interrupt)
    {:ok, p}
  end

  @impl true
  def set_model(p, _model, _effort), do: {:ok, p}

  @impl true
  def list_models(%{io: pid} = p) do
    send(pid, :models)
    {:ok, p}
  end

  @impl true
  def list_usage(%{io: pid} = p) do
    send(pid, :usage)
    {:ok, p}
  end

  @doc false
  def usage do
    %{
      "plan" => "max",
      "windows" => [
        %{"id" => "five_hour", "label" => "Session (5h)", "used_pct" => 42.0, "resets_at" => nil},
        %{"id" => "seven_day", "label" => "Weekly", "used_pct" => 18.0, "resets_at" => nil}
      ]
    }
  end

  @doc false
  def models do
    efforts = for e <- ~w(low medium high), do: %{"value" => e, "description" => ""}

    [
      %{"id" => "fake-smart", "name" => "Fake Smart", "description" => "Thinks harder, replies the same", "efforts" => efforts, "default_effort" => "medium"},
      %{"id" => "fake-fast", "name" => "Fake Fast", "description" => "No effort setting", "efforts" => [], "default_effort" => nil}
    ]
  end

  @impl true
  def respond(%{io: pid} = p, request_id, decision, answers) do
    send(pid, {:respond, request_id, decision, answers})
    {:ok, p}
  end

  @impl true
  def set_mode(p, _mode), do: {:ok, p}

  @impl true
  def handle_line(p, line), do: {Workbench.Provider.decode_line(line), p}

  @impl true
  def close(%{io: pid}) do
    Process.exit(pid, :shutdown)
    :ok
  end

  # -- script loading ---------------------------------------------------------

  defp load_script do
    path = System.get_env("WB_FAKE_SCRIPT") || Application.get_env(:workbench, :fake_script)

    if path && File.exists?(path) do
      path
      |> File.read!()
      |> String.split("\n", trim: true)
      |> Enum.map(&Jason.decode!/1)
      |> Enum.chunk_by(&(&1 == %{"fake" => "turn"}))
      |> Enum.reject(&(&1 == [%{"fake" => "turn"}]))
    else
      nil
    end
  end

  # -- replayer process -------------------------------------------------------

  defp init_replayer(server, session_id, turns) do
    emit(server, %{"type" => "session.started", "session_id" => session_id, "model" => "fake"})
    loop(%{server: server, turns: turns, n: 0})
  end

  defp loop(st) do
    receive do
      :models ->
        emit(st.server, %{"type" => "models", "models" => models()})
        loop(st)

      :usage ->
        emit(st.server, %{"type" => "usage", "usage" => usage()})
        loop(st)

      {:send, text, images} ->
        n = st.n + 1
        steps = turn_steps(st.turns, n, text, images)
        play(st.server, steps, n)
        loop(%{st | n: n})

      _ ->
        loop(st)
    end
  end

  defp turn_steps(nil, n, text, images), do: generated_turn(n, text, images)

  defp turn_steps(turns, n, _text, _images) do
    turns |> Enum.at(rem(n - 1, length(turns))) |> Enum.map(&suffix_ids(&1, n))
  end

  defp play(_server, [], _n), do: :done

  defp play(server, [%{"fake" => "sleep", "ms" => ms} | rest], n) do
    case wait(ms) do
      :interrupt -> interrupted(server, n)
      _ -> play(server, rest, n)
    end
  end

  defp play(server, [%{"type" => "approval.requested", "request_id" => rid} = ev | rest], n) do
    emit(server, ev)

    receive do
      {:respond, ^rid, decision, answers} ->
        rest = if decision == "deny", do: deny_rest(rest), else: rest
        # an AskUserQuestion answer shows up as the tool's result
        rest =
          if ev["tool"] == "AskUserQuestion",
            do: Enum.map(rest, &answer_result(&1, decision, answers)),
            else: rest

        play(server, rest, n)

      :interrupt ->
        emit(server, %{"type" => "approval.resolved", "request_id" => rid, "decision" => "cancelled"})
        interrupted(server, n)
    end
  end

  defp play(server, [ev | rest], n) do
    emit(server, ev)

    case wait(@line_delay) do
      :interrupt -> interrupted(server, n)
      _ -> play(server, rest, n)
    end
  end

  defp answer_result(%{"type" => "tool.completed"} = ev, "answer", answers),
    do: %{ev | "output" => "answers=" <> Jason.encode!(answers), "is_error" => false}

  defp answer_result(ev, _, _), do: ev

  defp deny_rest(rest) do
    Enum.map(rest, fn
      %{"type" => "tool.completed"} = ev -> %{ev | "output" => "Denied by user", "is_error" => true}
      ev -> ev
    end)
  end

  defp interrupted(server, n) do
    emit(server, %{
      "type" => "turn.completed",
      "turn_id" => "t#{n}",
      "status" => "interrupted",
      "usage" => %{"input_tokens" => 0, "output_tokens" => 0}
    })
  end

  defp wait(ms) do
    receive do
      :interrupt -> :interrupt
    after
      ms -> :ok
    end
  end

  defp emit(server, event), do: send(server, {:stdout, self(), Jason.encode!(event) <> "\n"})

  defp suffix_ids(ev, n) do
    Map.new(ev, fn
      {k, v} when k in ~w(item_id request_id turn_id parent_id) and is_binary(v) -> {k, "#{v}.#{n}"}
      {"item", %{"id" => id} = item} -> {"item", %{item | "id" => "#{id}.#{n}"}}
      kv -> kv
    end)
  end

  # -- generated turn ---------------------------------------------------------

  defp fake_questions do
    [
      %{
        "id" => "Which repeat do you mean?",
        "header" => "Repeat type",
        "question" => "Which repeat do you mean?",
        "options" => [
          %{"label" => "Stacked Thought rows", "description" => "One collapsed row per reasoning block."},
          %{"label" => "Word cycling", "description" => "The live indicator loops through its words."}
        ],
        "multiSelect" => false,
        "allowOther" => true,
        "secret" => false
      },
      %{
        "id" => "Where should the fix go?",
        "header" => "Scope",
        "question" => "Where should the fix go?",
        "options" => [
          %{"label" => "Timeline", "description" => "Group consecutive reasoning."},
          %{"label" => "Indicator", "description" => "Stop cycling after one pass."},
          %{"label" => "Both", "description" => ""}
        ],
        "multiSelect" => true,
        "allowOther" => true,
        "secret" => false
      }
    ]
  end

  defp generated_turn(n, text, images) do
    turn = "t#{n}"
    r = "r#{n}"
    m1 = "m#{n}a"
    m2 = "m#{n}b"
    tool = "tool#{n}"

    thinking =
      "The user wrote #{String.length(text)} characters" <>
        if(images == [], do: "", else: " and attached #{length(images)} image(s)") <>
        ". I'll echo it back and list the files."

    answer =
      "You said:\n\n> #{text}\n\nHere is what I'd run first:\n\n```bash\nls -la\n```\n"

    followup =
      "Done. A few notes:\n\n- this reply is **generated** by `Provider.Fake`\n- it streams in small chunks, like a real agent\n- turn #{n} of this session\n"

    approval =
      if String.contains?(String.downcase(text), "approve"),
        do: [
          %{
            "type" => "approval.requested",
            "request_id" => "req#{n}",
            "tool" => "Bash",
            "input" => %{"command" => "ls -la"},
            "reason" => "Bash is not allowed in default mode"
          }
        ],
        else: []

    ask = String.contains?(String.downcase(text), "ask me")

    question =
      if ask,
        do: [
          %{"type" => "tool.started", "item_id" => "ask#{n}", "name" => "AskUserQuestion", "input" => %{"questions" => fake_questions()}},
          %{"type" => "approval.requested", "request_id" => "ask#{n}", "tool" => "AskUserQuestion", "input" => %{"questions" => fake_questions()}},
          %{"type" => "tool.completed", "item_id" => "ask#{n}", "output" => "(no answer)", "truncated" => false, "is_error" => false}
        ],
        else: []

    # images you attach come back as if the agent had opened them
    look =
      if images == [],
        do: [],
        else: [
          %{"type" => "tool.started", "item_id" => "look#{n}", "name" => "Read", "input" => %{"file_path" => hd(images)["path"]}},
          %{"type" => "tool.completed", "item_id" => "look#{n}", "output" => "", "truncated" => false, "is_error" => false, "images" => Enum.map(images, &Map.take(&1, ["path"]))}
        ]

    [%{"type" => "turn.started", "turn_id" => turn}] ++
      question ++
      look ++
      deltas("reasoning.delta", r, thinking) ++
      [item(r, "reasoning", thinking, turn)] ++
      deltas("text.delta", m1, answer) ++
      [item(m1, "assistant_message", answer, turn)] ++
      [%{"type" => "tool.started", "item_id" => tool, "name" => "Bash", "input" => %{"command" => "ls -la", "description" => "List files"}}] ++
      approval ++
      [%{"fake" => "sleep", "ms" => 300}] ++
      [
        %{
          "type" => "tool.completed",
          "item_id" => tool,
          "output" => "total 3\ndrwxr-xr-x  4 you  staff  128 .\n-rw-r--r--  1 you  staff   42 README.md\n",
          "truncated" => false,
          "is_error" => false
        }
      ] ++
      deltas("text.delta", m2, followup) ++
      [item(m2, "assistant_message", followup, turn)] ++
      [
        %{
          "type" => "turn.completed",
          "turn_id" => turn,
          "status" => "ok",
          "usage" => %{"input_tokens" => 1200 + n, "output_tokens" => 80},
          "cost_usd" => 0.0
        }
      ]
  end

  defp item(id, kind, text, turn),
    do: %{"type" => "item.completed", "item" => %{"id" => id, "kind" => kind, "text" => text, "turn_id" => turn}}

  defp deltas(type, id, text) do
    text
    |> String.split(~r/(?<=\s)/u)
    |> Enum.map(&%{"type" => type, "item_id" => id, "text" => &1})
  end
end
