import type { DiffResult, ReviewSettings } from "@/contracts";

export const DEFAULT_REVIEW_PROMPT = `You are reviewing another agent's work. Read the changes critically, as a careful senior engineer would before approving a pull request.

Look for, in this order:
1. Bugs and broken behavior: wrong logic, unhandled errors and edge cases, races, anything the change breaks elsewhere.
2. Missing or weak tests for what changed.
3. Security and data-safety problems.
4. Code that is hard to follow, duplicated, or doesn't match the surrounding code.

Read the touched files in full where the diff alone isn't enough. Don't edit anything. Report findings most severe first, each with the file and line, what is wrong, and a concrete fix. If the work is sound, say so briefly.`;

/** What the reviewer is told about where the changes are, after the configured prompt. */
export function reviewMessage(review: ReviewSettings, diff: DiffResult | null): string {
  const base = diff?.base ?? "HEAD";
  const where =
    base === "HEAD"
      ? "The changes to review are the uncommitted ones in this worktree: `git status` and `git diff HEAD`."
      : `The changes to review are everything in this worktree against \`${base}\`: \`git diff $(git merge-base ${base} HEAD)\`, plus new files from \`git status\`.`;
  const files = diff?.files.length ? `\n\nChanged files:\n${diff.files.map((f) => `- ${f.path}`).join("\n")}` : "";
  return `${review.prompt}\n\n${where}${files}`;
}
