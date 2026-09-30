defmodule Workbench.Models do
  @moduledoc """
  The models each provider offers, as the last running agent reported them.

  One shape for every provider:

      %{"id" => "opus", "name" => "Opus 5.5", "description" => "...",
        "efforts" => [%{"value" => "high", "description" => "..."}],
        "default_effort" => "high" | nil}

  `id` is what goes back to the provider; `efforts` is empty when the model
  has no effort setting.
  """

  def get(provider), do: :persistent_term.get({__MODULE__, provider}, nil)
  def put(provider, models) when is_list(models), do: :persistent_term.put({__MODULE__, provider}, models)
end
