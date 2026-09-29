defmodule Workbench.LoginEnvTest do
  use ExUnit.Case, async: true
  alias Workbench.LoginEnv

  test "merge puts login-shell entries first and drops duplicates" do
    assert LoginEnv.merge("/opt/homebrew/bin:/usr/bin", "/usr/bin:/bin") == "/opt/homebrew/bin:/usr/bin:/bin"
    assert LoginEnv.merge("", "/usr/bin") == "/usr/bin"
  end
end
