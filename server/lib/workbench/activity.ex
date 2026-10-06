defmodule Workbench.Activity do
  @moduledoc """
  One short line saying what a thread's agent is doing or asking for, for the
  sidebar: "Running mix test", "Reading router.ex", "Needs approval: Bash rm -rf
  tmp", or the last thing it said. Every function returns a string or nil.
  """

  @max 140

  @doc "What a tool call is doing, from the tool's name and input."
  def tool(name, input) do
    input = if is_map(input), do: input, else: %{}

    case name do
      "Bash" -> "Running " <> arg(input["command"])
      n when n in ~w(Read ViewImage) -> "Reading " <> file(input)
      n when n in ~w(Edit MultiEdit Write NotebookEdit) -> "Editing " <> file(input)
      "Patch" -> "Editing " <> patch_files(input["changes"])
      n when n in ~w(Grep Glob) -> "Searching for " <> arg(input["pattern"])
      n when n in ~w(WebSearch WebFetch) -> "Searching the web"
      n when n in ~w(Task Agent) -> "Running a subagent"
      "ExitPlanMode" -> "Planning"
      "AskUserQuestion" -> "Asking a question"
      "mcp__" <> rest -> "Calling " <> String.replace(rest, "__", " ")
      n when is_binary(n) -> n
      _ -> "Working"
    end
    |> clip()
  end

  @doc "What an approval request is for."
  def approval(tool, input), do: clip("Needs approval: " <> (tool(tool, input) |> String.replace_prefix("Running ", tool <> " ")))

  @doc "The last line of what the agent wrote."
  def message(text) when is_binary(text) do
    text
    |> String.replace(~r/```.*?(```|\z)/s, "")
    |> String.split("\n")
    |> Enum.map(&(&1 |> String.trim() |> String.trim_leading("#") |> String.trim_leading("-") |> String.trim_leading("*") |> String.trim()))
    |> Enum.reverse()
    |> Enum.find(&(&1 != ""))
    |> case do
      nil -> nil
      line -> clip(line)
    end
  end

  def message(_), do: nil

  defp arg(v) when is_binary(v), do: v |> String.split("\n", parts: 2) |> hd() |> String.trim()
  defp arg(_), do: ""

  defp file(input) do
    case input["file_path"] || input["path"] || input["notebook_path"] do
      p when is_binary(p) -> Path.basename(p)
      _ -> "a file"
    end
  end

  defp patch_files([_ | _] = changes) do
    case changes |> Enum.map(&Path.basename(to_string(&1["path"]))) |> Enum.uniq() do
      [one] -> one
      [first | rest] -> "#{first} and #{length(rest)} more"
    end
  end

  defp patch_files(_), do: "files"

  defp clip(text) do
    if String.length(text) > @max, do: String.slice(text, 0, @max - 1) <> "…", else: text
  end
end
