import { useEffect, useState } from "react";
import { lobbyChannel, push } from "@/hooks/use-channels";
import { useStore } from "@/store";
import type { ModelOption, Provider } from "@/contracts";

export function useLabModels(provider: Provider) {
  const models = useStore((s) => s.models[provider]) ?? null;
  const [loading, setLoading] = useState(!models);
  const [error, setError] = useState<string | null>(null);

  const fetch = async (refresh: boolean) => {
    if (refresh) {
      setLoading(true);
      setError(null);
    }
    // may start the agent just to ask: give it time
    const r = await push(lobbyChannel(), "models.list", { provider, refresh }, 30_000);
    setLoading(false);
    if (r.ok) useStore.getState().setModels(provider, (r.payload as { models: ModelOption[] }).models);
    else setError(r.reason);
  };

  useEffect(() => {
    if (!models) void fetch(false);
  }, [provider]); // eslint-disable-line react-hooks/exhaustive-deps

  return { models, loading, error, refresh: () => fetch(true) };
}
