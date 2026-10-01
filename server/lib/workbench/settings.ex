defmodule Workbench.Settings do
  @moduledoc """
  App-wide preferences, one JSON value per key, shared by every browser.
  Changes are broadcast on the lobby as `{:settings, all()}`.

    * `"labs"`: which agents are on, and each one's model loadout:

          %{"claude" => %{"enabled" => true, "models" => ["opus", "sonnet"]},
            "codex" => %{"enabled" => false, "models" => []}, ...}

      At most 3 models per lab, in the order the chat's model picker shows
      them; an empty list means every model the agent offers. At least one
      lab stays on.
  """
  use Ecto.Schema
  alias Workbench.Repo

  @providers ~w(claude codex fake)
  @max_models 3

  @primary_key {:key, :string, autogenerate: false}
  schema "settings" do
    field :value, :string
    timestamps(type: :utc_datetime_usec)
  end

  def providers, do: @providers
  def max_models, do: @max_models

  def all, do: %{"labs" => labs()}

  @doc "Every lab with its settings, defaults filled in."
  def labs do
    stored = get("labs") || %{}
    Map.new(@providers, fn p -> {p, Map.merge(%{"enabled" => true, "models" => []}, Map.get(stored, p, %{}))} end)
  end

  @doc """
  Update a key. `"labs"` takes the labs to change (the others are kept), each
  with `enabled` and/or `models`. Returns `{:ok, all()}` or `{:error, msg}`.
  """
  def put("labs", changes) when is_map(changes) do
    with :ok <- check_labs(changes) do
      labs = Map.merge(labs(), changes, fn _p, old, new -> Map.merge(old, new) end)

      if Enum.any?(labs, fn {_, l} -> l["enabled"] end) do
        store("labs", labs)
      else
        {:error, "keep at least one agent on"}
      end
    end
  end

  def put(key, _), do: {:error, "unknown setting #{inspect(key)}"}

  defp check_labs(changes) do
    Enum.find_value(changes, :ok, fn
      {p, _} when p not in @providers -> {:error, "unknown agent #{inspect(p)}"}
      {_, lab} when not is_map(lab) -> {:error, "a lab's settings must be an object"}
      {p, lab} -> check_lab(p, lab)
    end)
  end

  defp check_lab(p, lab) do
    models = Map.get(lab, "models", [])

    cond do
      Map.keys(lab) -- ~w(enabled models) != [] -> {:error, "#{p}: only enabled and models can be set"}
      not is_boolean(Map.get(lab, "enabled", true)) -> {:error, "#{p}: enabled must be true or false"}
      not is_list(models) or not Enum.all?(models, &(is_binary(&1) and &1 != "" and byte_size(&1) <= 200)) -> {:error, "#{p}: models must be model ids"}
      length(Enum.uniq(models)) != length(models) -> {:error, "#{p}: a model is listed twice"}
      length(models) > @max_models -> {:error, "#{p}: at most #{@max_models} models"}
      true -> nil
    end
  end

  defp get(key) do
    case Repo.get(__MODULE__, key) do
      nil -> nil
      row -> Jason.decode!(row.value)
    end
  end

  defp store(key, value) do
    now = DateTime.utc_now()

    Repo.insert_all(__MODULE__, [%{key: key, value: Jason.encode!(value), inserted_at: now, updated_at: now}],
      on_conflict: {:replace, [:value, :updated_at]},
      conflict_target: :key
    )

    all = all()
    Workbench.Threads.broadcast_lobby({:settings, all})
    {:ok, all}
  end
end
