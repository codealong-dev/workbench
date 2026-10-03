import { useEffect } from "react";
import { create } from "zustand";
import { lobbyChannel, push } from "@/hooks/use-channels";
import { useStore } from "@/store";
import type { PullRequest, PullRequestList, Thread } from "@/contracts";

export type PrState = "all" | "open" | "merged";
/** GitHub review filters (Workbench.PullRequests @reviews); "" is any. */
export type PrReview = "" | "requested" | "reviewed" | "approved" | "changes_requested" | "none";

export interface PrFilters {
  state: PrState;
  /** "" is every project on GitHub */
  projectId: string;
  /** "" anyone, "me", or a login */
  author: string;
  review: PrReview;
}

export const DEFAULT_FILTERS: PrFilters = { state: "open", projectId: "", author: "", review: "" };
const FILTERS_KEY = "wb.prs.filters";

function readFilters(): PrFilters {
  try {
    return { ...DEFAULT_FILTERS, ...JSON.parse(localStorage.getItem(FILTERS_KEY) ?? "{}") };
  } catch {
    return DEFAULT_FILTERS;
  }
}

interface PrStore {
  filters: PrFilters;
  prs: PullRequest[] | null;
  errors: PullRequestList["errors"];
  /** every project seen on GitHub, kept across loads so a repository filter doesn't hide the others */
  repos: Record<string, string>;
  loading: boolean;
  error: string | null;
  /** the last load asked for; an older reply that arrives late is dropped */
  seq: number;
  setFilters: (f: Partial<PrFilters>) => void;
  load: () => Promise<void>;
}

/** The pull request list, shared by the sidebar and the PR page. */
export const usePrStore = create<PrStore>((set, get) => ({
  filters: readFilters(),
  prs: null,
  errors: [],
  repos: {},
  loading: false,
  error: null,
  seq: 0,

  setFilters: (f) => {
    const filters = { ...get().filters, ...f };
    localStorage.setItem(FILTERS_KEY, JSON.stringify(filters));
    set({ filters });
    void get().load();
  },

  load: async () => {
    const seq = get().seq + 1;
    const { state, projectId, author, review } = get().filters;
    set({ seq, loading: true });
    // several repos through gh, one after another on a slow network: give it time
    const r = await push(lobbyChannel(), "prs.list", { state, project_id: projectId || null, author: author || null, review: review || null }, 60_000);
    if (get().seq !== seq) return;
    if (!r.ok) return set({ loading: false, error: r.reason });
    const list = r.payload as PullRequestList;
    set((s) => ({
      loading: false,
      error: null,
      prs: list.prs,
      errors: list.errors,
      repos: { ...s.repos, ...Object.fromEntries(list.repos.map((x) => [x.project_id, x.repo])) },
    }));
  },
}));

/** Loads the list once the lobby is joined, unless it has one. */
export function usePullRequests(connected: boolean) {
  const store = usePrStore();
  useEffect(() => {
    if (connected && usePrStore.getState().prs === null) void usePrStore.getState().load();
  }, [connected]);
  return store;
}

/** The open workspace reviewing a PR, if any. */
export const prThread = (threads: Thread[], projectId: string, number: number) =>
  threads.find((t) => !t.parent_id && t.project_id === projectId && t.pr_number === number);

/** Opens a PR as a workspace (made the first time); resolves with it, or an error message. */
export async function reviewPullRequest(projectId: string, number: number, provider: string): Promise<{ thread: Thread } | { error: string }> {
  // the first time fetches the PR and runs the project's setup
  const r = await push(lobbyChannel(), "pr.review", { project_id: projectId, number, provider }, 180_000);
  if (!r.ok) return { error: r.reason };
  const { thread } = r.payload as { thread: Thread };
  // the reply beats the lobby's `thread.upserted`; selecting a thread the store doesn't know yet unmounts the view
  useStore.getState().upsertThread(thread);
  return { thread };
}
