defmodule Workbench.Search do
  @moduledoc """
  Find in files: the worktree's text files searched with `git grep` (the
  files `Workbench.Files.list/1` shows: tracked plus untracked, not ignored;
  outside a repo, the directory minus the usual build folders).

  Options (all optional): `case_sensitive`, `whole_word`, `regex`, and
  `include` / `exclude`, comma separated globs like VS Code's ("src/**",
  "*.ts"; one without a slash matches at any depth).

  Each match line comes with the ranges to highlight, as UTF-16 offsets into
  its (possibly shortened) text, ready for a JS string. Results stop at
  `@max_matches`, or when the search runs past `@timeout_ms`.
  """
  alias Workbench.Git

  @max_matches 2_000
  @timeout_ms 10_000
  # long lines (minified files) are cut to a window around the first match
  @max_line 240
  @before 40
  @skip ~w(.git node_modules _build deps dist build target .elixir_ls .next)

  @type match :: %{line: pos_integer, col: pos_integer, text: String.t(), ranges: [[non_neg_integer]], cut_left: boolean, cut_right: boolean}
  @type result :: %{files: [%{path: String.t(), matches: [match]}], total: non_neg_integer, truncated: boolean}

  @spec search(String.t(), String.t(), map | keyword) :: {:ok, result} | {:error, String.t()}
  def search(root, query, opts \\ %{}) do
    opts = Map.new(opts, fn {k, v} -> {to_string(k), v} end)

    cond do
      not File.dir?(root) -> {:error, "#{root} is not a directory"}
      query == "" -> {:ok, %{files: [], total: 0, truncated: false}}
      true -> with {:ok, re} <- compile(query, opts), do: grep(root, query, re, opts)
    end
  end

  # The same pattern in Elixir, to find every match on a line (git reports the first).
  defp compile(query, opts) do
    source = if opts["regex"] == true, do: query, else: Regex.escape(query)
    source = if opts["whole_word"] == true, do: "\\b(?:#{source})\\b", else: source
    flags = if opts["case_sensitive"] == true, do: "u", else: "iu"

    case Regex.compile(source, flags) do
      {:ok, re} -> {:ok, re}
      {:error, {reason, at}} -> {:error, "Invalid regular expression: #{reason} at #{at}"}
    end
  end

  defp grep(root, query, re, opts) do
    git? = match?({:ok, "true"}, Git.run(root, ["rev-parse", "--is-inside-work-tree"]))

    args =
      ["-C", root, "grep", "-n", "--column", "-I", "-z", "--no-color"] ++
        if(git?, do: ["--untracked", "--exclude-standard"], else: ["--no-index"]) ++
        if(opts["case_sensitive"] == true, do: [], else: ["-i"]) ++
        if(opts["whole_word"] == true, do: ["-w"], else: []) ++
        if(opts["regex"] == true, do: ["-P"], else: ["-F"]) ++
        ["-e", query, "--"] ++ pathspecs(opts, git?)

    case run(args, re) do
      # git built without PCRE: POSIX extended is close enough for most patterns
      {:error, msg} = err -> if opts["regex"] == true and msg =~ ~r/PCRE|perl/i, do: run(swap(args, "-P", "-E"), re), else: err
      ok -> ok
    end
  end

  defp swap(args, from, to), do: Enum.map(args, &if(&1 == from, do: to, else: &1))

  defp pathspecs(opts, git?) do
    include = globs(opts["include"]) |> Enum.flat_map(&glob_spec("glob", &1))
    exclude = globs(opts["exclude"]) |> Enum.flat_map(&glob_spec("exclude,glob", &1))
    # outside git nothing is ignored on its own
    skip = if git?, do: [], else: Enum.flat_map(@skip, &glob_spec("exclude,glob", &1))
    include ++ exclude ++ skip
  end

  defp globs(nil), do: []

  defp globs(s) when is_binary(s) do
    s |> String.split(",") |> Enum.map(&(&1 |> String.trim() |> String.trim_leading("./") |> String.trim_trailing("/"))) |> Enum.reject(&(&1 == ""))
  end

  defp globs(_), do: []

  # "*.ts" anywhere, "src" the folder or file, "src/**/x" as written
  defp glob_spec(magic, glob) do
    glob = if String.contains?(glob, "/") or String.starts_with?(glob, "**"), do: glob, else: "**/" <> glob
    [":(#{magic})#{glob}", ":(#{magic})#{glob}/**"]
  end

  # -- running git grep, streaming -------------------------------------------

  defp run(args, re) do
    case System.find_executable("git") do
      nil ->
        {:error, "git not available"}

      git ->
        port =
          Port.open({:spawn_executable, git}, [:binary, :exit_status, :use_stdio, :stderr_to_stdout, {:line, 65_536}, args: args, env: [{~c"GIT_TERMINAL_PROMPT", ~c"0"}]])

        deadline = System.monotonic_time(:millisecond) + @timeout_ms
        collect(port, re, %{files: [], current: nil, total: 0, partial: "", errors: []}, deadline)
    end
  end

  defp collect(port, re, acc, deadline) do
    left = max(deadline - System.monotonic_time(:millisecond), 0)

    receive do
      {^port, {:data, {:noeol, chunk}}} ->
        collect(port, re, %{acc | partial: acc.partial <> chunk}, deadline)

      {^port, {:data, {:eol, chunk}}} ->
        acc = record(acc.partial <> chunk, re, %{acc | partial: ""})
        if acc.total >= @max_matches, do: stop(port, acc), else: collect(port, re, acc, deadline)

      # 0: matches; 1: none
      {^port, {:exit_status, status}} when status in [0, 1] ->
        {:ok, finish(acc, false)}

      {^port, {:exit_status, _}} ->
        msg = acc.errors |> Enum.reverse() |> Enum.join("\n") |> String.trim()
        if acc.total > 0, do: {:ok, finish(acc, true)}, else: {:error, if(msg == "", do: "search failed", else: msg)}
    after
      left -> stop(port, acc)
    end
  end

  defp stop(port, acc) do
    # git may have exited already; closing the port ends it otherwise (SIGPIPE)
    try do
      Port.close(port)
    rescue
      ArgumentError -> :ok
    end

    flush(port)
    {:ok, finish(acc, true)}
  end

  defp flush(port) do
    receive do
      {^port, _} -> flush(port)
    after
      0 -> :ok
    end
  end

  defp finish(acc, truncated) do
    files = Enum.reverse(if acc.current, do: [close(acc.current) | acc.files], else: acc.files)
    %{files: files, total: acc.total, truncated: truncated}
  end

  defp close(%{path: path, matches: matches}), do: %{path: path, matches: Enum.reverse(matches)}

  # `path NUL line NUL column NUL text`; anything else is git complaining
  defp record(raw, re, acc) do
    case String.split(raw, <<0>>, parts: 4) do
      [path, line, _col, text] ->
        case {Integer.parse(line), line_match(text, re)} do
          {{n, ""}, %{} = m} -> add(acc, path, Map.put(m, :line, n))
          _ -> acc
        end

      _ ->
        %{acc | errors: [raw | acc.errors]}
    end
  end

  defp add(%{current: %{path: path} = cur} = acc, path, m),
    do: %{acc | current: %{cur | matches: [m | cur.matches]}, total: acc.total + 1}

  defp add(acc, path, m) do
    files = if acc.current, do: [close(acc.current) | acc.files], else: acc.files
    %{acc | files: files, current: %{path: path, matches: [m]}, total: acc.total + 1}
  end

  # -- one line: its matches, and a window of it to show -----------------------

  defp line_match(text, re) do
    text = if String.valid?(text), do: text, else: String.replace_invalid(text)
    text = String.trim_trailing(text, "\r")

    case Regex.scan(re, text, return: :index) |> Enum.map(&hd/1) |> Enum.reject(fn {_, len} -> len == 0 end) do
      # git and Elixir disagree (a regex only one of them reads the same way)
      [] ->
        nil

      [{first, _} | _] = spans ->
        {from, to} = window(text, first)
        shown = binary_part(text, from, to - from)

        ranges =
          for {s, len} <- spans, s >= from, s + len <= to,
              do: [utf16_len(binary_part(text, from, s - from)), utf16_len(binary_part(text, from, s + len - from))]

        %{
          col: utf16_len(binary_part(text, 0, first)) + 1,
          text: shown,
          ranges: ranges,
          cut_left: from > 0,
          cut_right: to < byte_size(text)
        }
    end
  end

  defp window(text, _first) when byte_size(text) <= @max_line, do: {0, byte_size(text)}

  defp window(text, first) do
    from = char_start(text, max(first - @before, 0))
    to = char_start(text, min(from + @max_line, byte_size(text)))
    {from, to}
  end

  # back up to the start of a UTF-8 character
  defp char_start(text, i) when i <= 0 or i >= byte_size(text), do: max(min(i, byte_size(text)), 0)

  defp char_start(text, i) do
    case :binary.at(text, i) do
      b when Bitwise.band(b, 0xC0) == 0x80 -> char_start(text, i - 1)
      _ -> i
    end
  end

  defp utf16_len(bin), do: div(byte_size(:unicode.characters_to_binary(bin, :utf8, :utf16)), 2)
end
