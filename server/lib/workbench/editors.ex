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

  @apps %{
    "zed" => ["/Applications/Zed.app", "~/Applications/Zed.app"],
    "code" => ["/Applications/Visual Studio Code.app", "~/Applications/Visual Studio Code.app"],
    "cursor" => ["/Applications/Cursor.app", "~/Applications/Cursor.app"],
    "finder" => ["/System/Library/CoreServices/Finder.app"]
  }

  @doc """
  The editor's own app icon as a 64px PNG, taken from the installed app on
  this Mac (converted once with `sips`, cached under WB_HOME/icons).
  `{:error, :not_found}` elsewhere or when the app isn't installed.
  """
  def icon(editor) do
    cached = Path.join([Workbench.Home.dir(), "icons", "#{editor}.png"])

    cond do
      not Map.has_key?(@apps, editor) -> {:error, :not_found}
      File.exists?(cached) -> {:ok, cached}
      true -> extract_icon(editor, cached)
    end
  end

  defp extract_icon(editor, out) do
    with {:unix, :darwin} <- :os.type(),
         app when is_binary(app) <- Enum.find(Enum.map(@apps[editor], &Path.expand/1), &File.dir?/1),
         icns when is_binary(icns) <- icns_path(app),
         :ok <- File.mkdir_p(Path.dirname(out)),
         {_, 0} <- System.cmd("sips", ["-s", "format", "png", "-Z", "64", icns, "--out", out], stderr_to_stdout: true) do
      {:ok, out}
    else
      _ -> {:error, :not_found}
    end
  end

  defp icns_path(app) do
    plist = Path.join(app, "Contents/Info.plist")

    name =
      case System.cmd("plutil", ["-extract", "CFBundleIconFile", "raw", plist], stderr_to_stdout: true) do
        {n, 0} -> String.trim(n)
        _ -> nil
      end

    resources = Path.join(app, "Contents/Resources")

    [name && Path.join(resources, name), name && Path.join(resources, name <> ".icns")]
    |> Enum.concat(Path.wildcard(Path.join(resources, "*.icns")) |> Enum.take(1))
    |> Enum.find(&(&1 && File.regular?(&1)))
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
