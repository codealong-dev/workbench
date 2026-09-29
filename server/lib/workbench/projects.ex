defmodule Workbench.Projects do
  @moduledoc """
  A project is a local git repo. Threads branch off it into their own worktree.

  Optional `<repo>/.workbench.json`:

      {
        "setup": ["npm ci", "cp $WB_REPO/.env .env"],
        "teardown": ["docker compose down"]
      }

  Commands run with `sh -c` in the worktree, with `WB_REPO` and `WB_WORKTREE`
  set. Setup output streams into the thread as tool calls named "Setup".
  """
  import Ecto.Query
  alias Workbench.{Git, Repo}

  defmodule Project do
    @moduledoc false
    use Ecto.Schema

    @primary_key {:id, :binary_id, autogenerate: true}
    schema "projects" do
      field :name, :string
      field :repo_path, :string
      field :default_branch, :string
      timestamps(type: :utc_datetime_usec)
    end

    def to_json(%__MODULE__{} = p), do: Map.take(p, [:id, :name, :repo_path, :default_branch])
  end

  def list, do: Repo.all(from p in Project, order_by: [asc: fragment("lower(?)", p.name)])

  def get(id), do: Repo.get(Project, id)

  @doc "Add the git repo containing `path`. Adding the same repo twice returns the existing project."
  def add(path) when is_binary(path) do
    with {:ok, repo} <- Git.toplevel(Path.expand(path)) do
      case Repo.get_by(Project, repo_path: repo) do
        %Project{} = p ->
          {:ok, p}

        nil ->
          %Project{name: Path.basename(repo), repo_path: repo, default_branch: Git.default_branch(repo)}
          |> Repo.insert()
      end
    end
  end

  def branches(%Project{repo_path: repo}), do: Git.branches(repo)

  @doc "Parsed `.workbench.json`: `%{setup: [String.t()], teardown: [String.t()]}`."
  def config(%Project{repo_path: repo}) do
    empty = %{setup: [], teardown: []}

    with {:ok, body} <- File.read(Path.join(repo, ".workbench.json")),
         {:ok, map} when is_map(map) <- Jason.decode(body) do
      %{setup: commands(map["setup"]), teardown: commands(map["teardown"])}
    else
      _ -> empty
    end
  end

  defp commands(list) when is_list(list), do: Enum.filter(list, &(is_binary(&1) and &1 != ""))
  defp commands(cmd) when is_binary(cmd) and cmd != "", do: [cmd]
  defp commands(_), do: []
end
