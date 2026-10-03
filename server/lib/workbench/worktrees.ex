defmodule Workbench.Worktrees do
  @moduledoc """
  One git worktree and branch per thread, so parallel threads never touch the
  same files:

    * path: `<home>/worktrees/<project>-<id8>/<slug>`
    * branch: `wb/<slug>`, created from the base ref (default: the project's
      default branch)

  Removing a worktree keeps its branch, so work is never lost.
  """
  alias Workbench.{Git, Home}
  alias Workbench.Projects.Project

  def root(%Project{} = p), do: Path.join([Home.dir(), "worktrees", "#{p.name}-#{String.slice(p.id, 0, 8)}"])

  @doc "A branch-safe slug from a title, with a short random suffix so titles can repeat."
  def slug(title) do
    base =
      (title || "")
      |> String.downcase()
      |> String.replace(~r/[^a-z0-9]+/, "-")
      |> String.trim("-")
      |> String.slice(0, 40)
      |> String.trim("-")

    suffix = :crypto.strong_rand_bytes(3) |> Base.encode16(case: :lower)
    if base == "", do: "thread-" <> suffix, else: base <> "-" <> suffix
  end

  @doc """
  Create `wb/<slug>` from `base_ref` and check it out in a new worktree.
  With `start`, the branch starts there instead (a pull request's head) and
  `base_ref` is only what its changes are compared against.
  """
  def create(%Project{} = p, slug, base_ref, start \\ nil) do
    path = Path.join(root(p), slug)
    branch = "wb/" <> slug
    base = base_ref || p.default_branch
    File.mkdir_p!(root(p))

    case Git.run(p.repo_path, ["worktree", "add", "-b", branch, path, start || base]) do
      {:ok, _} -> {:ok, %{path: path, branch: branch, base_ref: base}}
      {:error, msg} -> {:error, msg}
    end
  end

  @doc "Remove the worktree (even with uncommitted changes). The branch stays."
  def remove(%Project{} = p, path) do
    if managed?(p, path) do
      result = Git.run(p.repo_path, ["worktree", "remove", "--force", path])
      # A worktree whose directory is already gone only needs pruning.
      _ = Git.run(p.repo_path, ["worktree", "prune"])

      case result do
        {:ok, _} -> :ok
        {:error, _} = err -> if File.exists?(path), do: err, else: :ok
      end
    else
      {:error, "refusing to remove #{path}: not a workbench worktree"}
    end
  end

  @doc "True for paths this module created (never the repo itself)."
  def managed?(%Project{} = p, path) do
    root = root(p) <> "/"
    String.starts_with?(Path.expand(path), root)
  end
end
