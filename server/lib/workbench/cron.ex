defmodule Workbench.Cron do
  @moduledoc """
  Five-field cron expressions (`minute hour day-of-month month day-of-week`),
  read in this machine's local time. Each field takes `*`, a number, a range
  `a-b`, a step `*/n` or `a-b/n`, or a comma list of those. Day of week is
  0-6 from Sunday (7 is Sunday too). When both day fields are restricted, a
  day matching either one counts, as in cron.

      {:ok, cron} = Cron.parse("0 3 * * 1-5")   # weekdays at 03:00
      Cron.next(cron, ~U[2026-10-06 12:00:00Z]) # the next one after that, in UTC
  """

  defstruct [:minute, :hour, :day, :month, :weekday, :any_day, :any_weekday]

  @type t :: %__MODULE__{}

  @fields [minute: 0..59, hour: 0..23, day: 1..31, month: 1..12, weekday: 0..7]
  # Feb 29 on a Monday comes round every 28 years at worst
  @horizon_days 366 * 28

  @spec parse(String.t()) :: {:ok, t()} | {:error, String.t()}
  def parse(expr) when is_binary(expr) do
    with parts when length(parts) == 5 <- String.split(expr),
         {:ok, sets} <- parse_fields(Enum.zip(@fields, parts)) do
      [minute, hour, day, month, weekday] = sets
      [_, _, day_src, _, weekday_src] = parts
      weekday = MapSet.new(weekday, &rem(&1, 7))

      cron = %__MODULE__{
        minute: minute,
        hour: hour,
        day: day,
        month: month,
        weekday: weekday,
        any_day: day_src == "*",
        any_weekday: weekday_src == "*"
      }

      if next_local(cron, ~N[2000-01-01 00:00:00]), do: {:ok, cron}, else: {:error, "never runs"}
    else
      {:error, _} = err -> err
      _ -> {:error, "needs five fields: minute hour day month weekday"}
    end
  end

  def parse(_), do: {:error, "needs five fields: minute hour day month weekday"}

  def valid?(expr), do: match?({:ok, _}, parse(expr))

  defp parse_fields(fields) do
    Enum.reduce_while(fields, {:ok, []}, fn {{name, range}, src}, {:ok, acc} ->
      case parse_field(src, range) do
        {:ok, set} -> {:cont, {:ok, acc ++ [set]}}
        :error -> {:halt, {:error, "bad #{name} field #{inspect(src)}"}}
      end
    end)
  end

  defp parse_field(src, range) do
    src
    |> String.split(",")
    |> Enum.reduce_while({:ok, MapSet.new()}, fn part, {:ok, acc} ->
      case parse_part(part, range) do
        {:ok, values} -> {:cont, {:ok, MapSet.union(acc, MapSet.new(values))}}
        :error -> {:halt, :error}
      end
    end)
  end

  defp parse_part(part, lo..hi//_ = range) do
    {span, step} =
      case String.split(part, "/") do
        [span] -> {span, 1}
        [span, step] -> {span, int(step)}
        _ -> {nil, nil}
      end

    bounds =
      case span && String.split(span, "-") do
        ["*"] -> {lo, hi}
        [a] -> if step == 1, do: {int(a), int(a)}, else: {int(a), hi}
        [a, b] -> {int(a), int(b)}
        _ -> nil
      end

    case bounds do
      {a, b} when is_integer(a) and is_integer(b) and is_integer(step) and step > 0 and a <= b ->
        if a in range and b in range, do: {:ok, Enum.take_every(a..b, step)}, else: :error

      _ ->
        :error
    end
  end

  defp int(s) do
    case Integer.parse(s) do
      {n, ""} -> n
      _ -> nil
    end
  end

  @doc """
  The first time after `after` (UTC) that matches, in UTC. A local time that
  doesn't exist (skipped by a DST change) is passed over; one that happens
  twice runs the first time.
  """
  @spec next(t(), DateTime.t()) :: DateTime.t() | nil
  def next(%__MODULE__{} = cron, %DateTime{} = after_utc) do
    local = after_utc |> DateTime.to_naive() |> NaiveDateTime.to_erl() |> :calendar.universal_time_to_local_time() |> NaiveDateTime.from_erl!()
    find_utc(cron, local, 0)
  end

  defp find_utc(_cron, _local, 50), do: nil

  defp find_utc(cron, local, tries) do
    with %NaiveDateTime{} = at <- next_local(cron, local) do
      case :calendar.local_time_to_universal_time_dst(NaiveDateTime.to_erl(at)) do
        [] -> find_utc(cron, at, tries + 1)
        [utc | _] -> utc |> NaiveDateTime.from_erl!() |> DateTime.from_naive!("Etc/UTC") |> DateTime.add(0, :microsecond)
      end
    end
  end

  @doc "The first local time strictly after `after` that matches, to the minute."
  @spec next_local(t(), NaiveDateTime.t()) :: NaiveDateTime.t() | nil
  def next_local(%__MODULE__{} = cron, %NaiveDateTime{} = after_local) do
    start = %{NaiveDateTime.truncate(after_local, :second) | second: 0} |> NaiveDateTime.add(60)
    limit = NaiveDateTime.add(start, @horizon_days * 86_400)
    step(cron, start, limit)
  end

  defp step(cron, t, limit) do
    cond do
      NaiveDateTime.compare(t, limit) == :gt -> nil
      t.month not in cron.month -> step(cron, next_month(t), limit)
      not day?(cron, t) -> step(cron, next_day(t), limit)
      t.hour not in cron.hour -> step(cron, next_hour(t), limit)
      t.minute not in cron.minute -> step(cron, NaiveDateTime.add(t, 60), limit)
      true -> t
    end
  end

  defp day?(cron, t) do
    in_day = t.day in cron.day
    in_weekday = rem(Date.day_of_week(t), 7) in cron.weekday

    case {cron.any_day, cron.any_weekday} do
      {true, true} -> true
      {true, false} -> in_weekday
      {false, true} -> in_day
      {false, false} -> in_day or in_weekday
    end
  end

  defp next_month(%NaiveDateTime{year: y, month: 12}), do: NaiveDateTime.new!(y + 1, 1, 1, 0, 0, 0)
  defp next_month(%NaiveDateTime{year: y, month: m}), do: NaiveDateTime.new!(y, m + 1, 1, 0, 0, 0)

  defp next_day(t), do: t |> NaiveDateTime.to_date() |> Date.add(1) |> NaiveDateTime.new!(~T[00:00:00])
  defp next_hour(t), do: %{t | minute: 0} |> NaiveDateTime.add(3600)
end
