defmodule Workbench.Files do
  @moduledoc """
  The worktree's files, for the file tree and the file viewer.

  `list/1` is what git would show: tracked files plus untracked ones that
  are not ignored (`git ls-files --cached --others --exclude-standard`).
  Outside a git repo it walks the directory, skipping the usual build and
  dependency folders. `read/2` returns one file's text, refusing paths that
  leave the worktree.
  """
  alias Workbench.Git

  @max_files 20_000
  @max_bytes 1_000_000
  @skip ~w(.git node_modules _build deps dist build target .elixir_ls .next)

  @spec list(String.t()) :: {:ok, %{files: [String.t()], truncated: boolean}} | {:error, String.t()}
  def list(root) do
    cond do
      not File.dir?(root) ->
        {:error, "#{root} is not a directory"}

      true ->
        paths =
          with {:ok, "true"} <- Git.run(root, ["rev-parse", "--is-inside-work-tree"]),
               {out, 0} <- Git.cmd(root, ["ls-files", "--cached", "--others", "--exclude-standard", "--deduplicate", "-z"]) do
            out |> String.split(<<0>>, trim: true) |> Enum.filter(&File.regular?(Path.join(root, &1)))
          else
            _ -> walk(root, "", [])
          end

        {:ok, %{files: paths |> Enum.take(@max_files) |> Enum.sort(), truncated: length(paths) > @max_files}}
    end
  end

  defp walk(_root, _rel, acc) when length(acc) > @max_files, do: acc

  defp walk(root, rel, acc) do
    case File.ls(Path.join(root, rel)) do
      {:ok, names} ->
        Enum.reduce(names, acc, fn name, acc ->
          path = if rel == "", do: name, else: rel <> "/" <> name
          full = Path.join(root, path)

          cond do
            name in @skip -> acc
            File.dir?(full) and not symlink?(full) -> walk(root, path, acc)
            File.regular?(full) -> [path | acc]
            true -> acc
          end
        end)

      _ ->
        acc
    end
  end

  @spec read(String.t(), String.t()) ::
          {:ok, %{path: String.t(), content: String.t() | nil, size: non_neg_integer, binary: boolean, truncated: boolean}}
          | {:error, String.t()}
  def read(root, rel) when is_binary(rel) do
    with {:ok, safe} <- safe_path(root, rel),
         full = Path.join(root, safe),
         :ok <- inside(root, full),
         {:ok, %File.Stat{type: :regular, size: size}} <- File.stat(full),
         {:ok, bytes} <- read_head(full, min(size, @max_bytes)) do
      binary = binary?(bytes)

      {:ok,
       %{
         path: safe,
         content: if(binary, do: nil, else: bytes),
         size: size,
         binary: binary,
         truncated: size > @max_bytes
       }}
    else
      {:ok, %File.Stat{}} -> {:error, "#{rel} is not a file"}
      {:error, :enoent} -> {:error, "#{rel} does not exist"}
      {:error, reason} when is_atom(reason) -> {:error, "#{rel}: #{:file.format_error(reason)}"}
      {:error, _} = err -> err
    end
  end

  defp safe_path(root, rel) do
    case Path.safe_relative(rel, root) do
      {:ok, safe} when safe not in ["", "."] -> {:ok, safe}
      _ -> {:error, "path is outside the worktree"}
    end
  end

  # a symlink inside the worktree may still point out of it
  defp inside(root, full) do
    root = realpath(root)
    if String.starts_with?(realpath(full), root <> "/"), do: :ok, else: {:error, "path is outside the worktree"}
  end

  defp realpath(path) do
    case System.cmd("realpath", [path], stderr_to_stdout: true) do
      {out, 0} -> String.trim(out)
      _ -> Path.expand(path)
    end
  end

  defp symlink?(path), do: match?({:ok, %File.Stat{type: :symlink}}, File.lstat(path))

  defp read_head(_path, 0), do: {:ok, ""}

  defp read_head(path, n) do
    File.open(path, [:read, :binary], fn io -> IO.binread(io, n) end)
    |> case do
      {:ok, data} when is_binary(data) -> {:ok, data}
      {:ok, _} -> {:ok, ""}
      err -> err
    end
  end

  defp binary?(bytes) do
    head = binary_part(bytes, 0, min(byte_size(bytes), 8000))
    String.contains?(head, <<0>>) or not String.valid?(trim_partial_utf8(bytes))
  end

  # a 1MB cut can split a multi-byte character; don't call that binary
  defp trim_partial_utf8(bytes) do
    Enum.reduce_while(0..3, bytes, fn k, _ ->
      part = binary_part(bytes, 0, max(byte_size(bytes) - k, 0))
      if String.valid?(part), do: {:halt, part}, else: {:cont, bytes}
    end)
  end
end
