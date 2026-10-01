import type { GuideSettings } from "@/contracts";

/** Mirrors `Workbench.Guide.default_prompt/0`: how the guide groups the changes. */
export const DEFAULT_GUIDE_PROMPT = `You are preparing a review guide for a code change, the way a careful engineer would walk a teammate through a pull request.

Group the changed files into a few ordered chunks that each tell one part of the story:
- Put the core of the implementation first, then supporting changes (wiring, config, migrations), and tests and low-signal changes (formatting, generated files, lockfiles) last.
- Keep files that change together for one reason in the same chunk.
- Name each chunk for what it does, in a few words ("Update endpoint", not "Changes to controller").
- Write each summary as one or two sentences on why the chunk exists and what it changes, not as a list of edits.`;

/** What the guide uses until settings are saved (mirrors `Workbench.Guide.config/0`). */
export const DEFAULT_GUIDE_SETTINGS: GuideSettings = { provider: "claude", model: "sonnet", effort: null, prompt: DEFAULT_GUIDE_PROMPT };
