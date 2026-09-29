defmodule Workbench.Editors do
  @moduledoc """
  Open a thread's worktree (optionally a file in it) in an editor or the file
  manager. Uses the editor's CLI when it's on PATH, else `open -a` on macOS.
  """

  @editors %{
    "zed" => {"zed", "Zed"},
    "code" => {"code", "Visual Studio Code"},
    "cursor" => {"cursor", "Cursor"}
  }

  def editors, do: Map.keys(@editors) ++ ["finder"]

  @doc "Open `dir` (and `file` relative to it, if given). Returns :ok or {:error, msg}."
  def open(editor, dir, file \\ nil)

  def open("finder", dir, _file) do
    case :os.type() do
      {:unix, :darwin} -> spawn_cmd("open", [dir])
      _ -> spawn_cmd("xdg-open", [dir])
    end
  end

  def open(editor, dir, file) do
    case Map.fetch(@editors, editor) do
      :error ->
        {:error, "unknown editor #{inspect(editor)}"}

      {:ok, {cli, app}} ->
        targets = [dir | if(file, do: [Path.join(dir, safe_rel(file))], else: [])]

        cond do
          exe = System.find_executable(cli) -> spawn_cmd(exe, targets)
          mac_app?(app) -> spawn_cmd("open", ["-a", app | targets])
          true -> {:error, "#{app} not found: install its `#{cli}` command or the app"}
        end
    end
  end

  # Keep file paths inside the worktree.
  defp safe_rel(file), do: file |> Path.relative() |> String.replace(~r{(^|/)\.\.(/|$)}, "/")

  defp mac_app?(app) do
    match?({:unix, :darwin}, :os.type()) and match?({_, 0}, System.cmd("open", ["-Ra", app], stderr_to_stdout: true))
  end

  defp spawn_cmd(exe, args) do
    Task.start(fn -> System.cmd(exe, args, stderr_to_stdout: true) end)
    :ok
  end
end
