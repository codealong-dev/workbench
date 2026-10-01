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

  test "review: none until saved, saved whole, validated, can be forgotten" do
    assert Settings.all()["review"] == nil

    review = %{"provider" => "claude", "model" => "opus", "effort" => nil, "mode" => "plan", "prompt" => "  Look for bugs.  "}
    Threads.subscribe_lobby()
    assert {:ok, %{"review" => saved}} = Settings.put("review", review)
    assert saved == %{review | "prompt" => "Look for bugs."}
    assert_receive {:settings, %{"review" => ^saved}}

    assert {:error, "review: pick an agent"} = Settings.put("review", %{review | "provider" => "gemini"})
    assert {:error, "review: unknown permission mode"} = Settings.put("review", %{review | "mode" => "yolo"})
    assert {:error, "review: write the prompt the reviewer gets"} = Settings.put("review", %{review | "prompt" => "  "})
    assert {:error, "review: unknown field"} = Settings.put("review", Map.put(review, "x", 1))
    assert Settings.review() == saved

    assert {:ok, %{"review" => nil}} = Settings.put("review", nil)
    assert Settings.review() == nil
  end

  test "guide: none until saved, saved whole, validated, can be forgotten" do
    assert Settings.all()["guide"] == nil
    assert %{"provider" => "claude", "model" => "sonnet"} = Workbench.Guide.config()

    guide = %{"provider" => "codex", "model" => "gpt-mini", "effort" => nil, "prompt" => "  Group it.  "}
    Threads.subscribe_lobby()
    assert {:ok, %{"guide" => saved}} = Settings.put("guide", guide)
    assert saved == %{guide | "prompt" => "Group it."}
    assert_receive {:settings, %{"guide" => ^saved}}
    assert Workbench.Guide.config() == saved

    assert {:error, "guide: pick an agent"} = Settings.put("guide", %{guide | "provider" => "gemini"})
    assert {:error, "guide: write the instructions the guide writer gets"} = Settings.put("guide", %{guide | "prompt" => " "})
    assert {:error, "guide: unknown field"} = Settings.put("guide", Map.put(guide, "mode", "plan"))
    assert Settings.guide() == saved

    assert {:ok, %{"guide" => nil}} = Settings.put("guide", nil)
  end
end
