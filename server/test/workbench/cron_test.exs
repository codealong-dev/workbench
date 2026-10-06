defmodule Workbench.CronTest do
  use ExUnit.Case, async: true
  alias Workbench.Cron

  defp next(expr, after_local) do
    {:ok, cron} = Cron.parse(expr)
    Cron.next_local(cron, after_local)
  end

  test "parses fields, ranges, steps and lists" do
    assert {:ok, %Cron{} = c} = Cron.parse("*/15 9-17 * * 1-5")
    assert MapSet.to_list(c.minute) == [0, 15, 30, 45]
    assert MapSet.to_list(c.hour) == Enum.to_list(9..17)
    assert MapSet.to_list(c.weekday) == [1, 2, 3, 4, 5]
    assert {:ok, %Cron{weekday: w}} = Cron.parse("0 0 * * 7")
    assert MapSet.to_list(w) == [0]
    assert {:ok, %Cron{minute: m}} = Cron.parse("5,10-12,50/5 * * * *")
    assert MapSet.to_list(m) == [5, 10, 11, 12, 50, 55]
  end

  test "rejects what it can't read, or what never comes round" do
    assert {:error, "needs five fields" <> _} = Cron.parse("0 3 * *")
    assert {:error, "bad minute field \"60\""} = Cron.parse("60 * * * *")
    assert {:error, "bad hour field \"5-2\""} = Cron.parse("0 5-2 * * *")
    assert {:error, "bad day field \"*/0\""} = Cron.parse("0 0 */0 * *")
    assert {:error, "bad weekday field \"mon\""} = Cron.parse("0 0 * * mon")
    assert {:error, "never runs"} = Cron.parse("0 0 30 2 *")
    assert {:error, _} = Cron.parse(nil)
  end

  test "next: the first match strictly after, to the minute" do
    assert next("0 3 * * *", ~N[2026-10-06 12:00:00]) == ~N[2026-10-07 03:00:00]
    assert next("0 3 * * *", ~N[2026-10-07 02:59:59]) == ~N[2026-10-07 03:00:00]
    assert next("0 3 * * *", ~N[2026-10-07 03:00:00]) == ~N[2026-10-08 03:00:00]
    assert next("*/30 * * * *", ~N[2026-10-06 12:10:42]) == ~N[2026-10-06 12:30:00]
    assert next("0 * * * *", ~N[2026-12-31 23:30:00]) == ~N[2027-01-01 00:00:00]
  end

  test "next: weekdays, months, and either day field when both are set" do
    # 2026-10-09 is a Friday
    assert next("0 9 * * 1-5", ~N[2026-10-09 10:00:00]) == ~N[2026-10-12 09:00:00]
    assert next("0 17 * * 5", ~N[2026-10-06 00:00:00]) == ~N[2026-10-09 17:00:00]
    assert next("0 0 1 1 *", ~N[2026-10-06 00:00:00]) == ~N[2027-01-01 00:00:00]
    assert next("0 0 29 2 *", ~N[2026-10-06 00:00:00]) == ~N[2028-02-29 00:00:00]
    # the 15th, or a Monday: Monday the 12th comes first
    assert next("0 0 15 * 1", ~N[2026-10-10 00:00:00]) == ~N[2026-10-12 00:00:00]
  end

  test "next: UTC in, UTC out, through local time" do
    {:ok, cron} = Cron.parse("0 3 * * *")
    at = Cron.next(cron, ~U[2026-10-06 12:00:00Z])
    assert %DateTime{time_zone: "Etc/UTC"} = at
    assert DateTime.compare(at, ~U[2026-10-06 12:00:00Z]) == :gt
    assert DateTime.diff(at, ~U[2026-10-06 12:00:00Z]) <= 86_400 + 3_600
    local = at |> DateTime.to_naive() |> NaiveDateTime.to_erl() |> :calendar.universal_time_to_local_time()
    assert {_, {3, 0, 0}} = local
  end
end
