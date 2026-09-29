defmodule WorkbenchWeb.ChannelHelpers do
  @moduledoc false

  def reason(r) when is_binary(r), do: r
  def reason(r) when is_atom(r), do: Atom.to_string(r)
  def reason(r), do: inspect(r)

  def errors(%Ecto.Changeset{} = cs) do
    cs
    |> Ecto.Changeset.traverse_errors(fn {msg, _opts} -> msg end)
    |> Enum.map_join("; ", fn {field, msgs} -> "#{field} #{Enum.join(msgs, ", ")}" end)
  end
end
