// AskUserQuestion: the one tool that needs an answer, not a yes/no. The UI
// gets a provider-neutral shape (Codex's request_user_input maps to the same
// one on the Elixir side); answers come back keyed by question id, which for
// Claude is the question text, as the SDK expects.

export interface Question {
  id: string;
  header: string;
  question: string;
  options: { label: string; description: string }[];
  multiSelect: boolean;
  allowOther: boolean;
  secret: boolean;
}

type ClaudeQuestion = { question: string; header?: string; options?: { label: string; description?: string }[]; multiSelect?: boolean };

export function toQuestions(input: unknown): Question[] {
  const qs = ((input as { questions?: ClaudeQuestion[] })?.questions ?? []) as ClaudeQuestion[];
  return qs.map((q) => ({
    id: q.question,
    header: q.header ?? "",
    question: q.question,
    options: (q.options ?? []).map((o) => ({ label: o.label, description: o.description ?? "" })),
    multiSelect: !!q.multiSelect,
    // Claude Code always offers a free-text "Other"
    allowOther: true,
    secret: false,
  }));
}

/** The tool input with the user's answers filled in, as the SDK reads them. */
export function withAnswers(input: Record<string, unknown>, answers: Record<string, string[]>): Record<string, unknown> {
  const flat: Record<string, string> = {};
  for (const [q, picked] of Object.entries(answers ?? {})) {
    const values = (picked ?? []).map((s) => s.trim()).filter(Boolean);
    if (values.length) flat[q] = values.join(", ");
  }
  return { ...input, answers: flat };
}
