defmodule Workbench.SettingsTest do
  use Workbench.ThreadCase
  alias Workbench.Settings

  test "labs: defaults, partial updates, validation" do
    assert %{"claude" => %{"enabled" => true, "models" => []}, "codex" => %{"enabled" => true}, "fake" => _} = Settings.labs()

    Threads.subscribe_lobby()
    assert {:ok, %{"labs" => labs}} = Settings.put("labs", %{"claude" => %{"models" => ["opus", "sonnet"]}})
    assert labs["claude"] == %{"enabled" => true, "models" => ["opus", "sonnet"]}
    assert_receive {:settings, %{"labs" => %{"claude" => %{"models" => ["opus", "sonnet"]}}}}

    # only what was sent changes
    assert {:ok, %{"labs" => labs}} = Settings.put("labs", %{"claude" => %{"enabled" => false}})
    assert labs["claude"] == %{"enabled" => false, "models" => ["opus", "sonnet"]}
    assert labs["codex"]["enabled"]

    assert {:error, "claude: at most 3 models"} = Settings.put("labs", %{"claude" => %{"models" => ~w(a b c d)}})
    assert {:error, "claude: a model is listed twice"} = Settings.put("labs", %{"claude" => %{"models" => ~w(a a)}})
    assert {:error, "unknown agent \"gemini\""} = Settings.put("labs", %{"gemini" => %{"enabled" => true}})
    assert {:error, "codex: only enabled and models can be set"} = Settings.put("labs", %{"codex" => %{"color" => "red"}})
    assert {:error, "keep at least one agent on"} = Settings.put("labs", %{"codex" => %{"enabled" => false}, "fake" => %{"enabled" => false}})
    assert {:error, _} = Settings.put("nope", 1)
    assert Settings.labs()["codex"]["enabled"]
  end
end
