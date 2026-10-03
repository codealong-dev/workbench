import { useEffect, useRef, useState, type RefObject } from "react";
import type { Channel } from "phoenix";
import { push } from "@/hooks/use-channels";
import type { SearchOptions, SearchResult } from "@/contracts";

export const NO_OPTIONS: SearchOptions = { case_sensitive: false, whole_word: false, regex: false, include: "", exclude: "" };

/**
 * Find in files, as you type: debounced, and only the latest search's reply
 * is kept. Searches again when `refreshKey` changes (files changed on disk).
 */
export function useContentSearch(channel: RefObject<Channel | null>, query: string, options: SearchOptions, refreshKey?: unknown) {
  const [result, setResult] = useState<SearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const latest = useRef(0);
  const { case_sensitive, whole_word, regex, include, exclude } = options;

  useEffect(() => {
    const n = ++latest.current;
    if (!query.trim()) {
      setResult(null);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const t = setTimeout(async () => {
      const r = await push(channel.current, "search", { query, case_sensitive, whole_word, regex, include, exclude }, 30_000);
      if (n !== latest.current) return;
      setLoading(false);
      if (r.ok) {
        setResult(r.payload as SearchResult);
        setError(null);
      } else {
        setResult(null);
        setError(r.reason);
      }
    }, 180);
    return () => clearTimeout(t);
  }, [channel, query, case_sensitive, whole_word, regex, include, exclude, refreshKey]);

  return { result, error, loading };
}
