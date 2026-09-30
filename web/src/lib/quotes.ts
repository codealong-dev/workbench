// Replying to part of an answer: the quoted text travels in the message
// itself, as a markdown block quote in front of what you typed. Every agent
// understands that, so it works the same for Claude, Codex or anything else.

export function withQuotes(quotes: string[], text: string): string {
  if (quotes.length === 0) return text;
  const blocks = quotes.map((q) =>
    q
      .trim()
      .split("\n")
      .map((l) => (l ? `> ${l}` : ">"))
      .join("\n"),
  );
  return `${blocks.join("\n\n")}\n\n${text}`;
}

/** Split a sent message back into its leading quotes and the rest, for display. */
export function splitQuotes(message: string): { quotes: string[]; body: string } {
  const lines = message.split("\n");
  const quotes: string[] = [];
  let current: string[] | null = null;
  let i = 0;
  for (; i < lines.length; i++) {
    const l = lines[i];
    if (l === ">" || l.startsWith("> ")) {
      (current ??= []).push(l === ">" ? "" : l.slice(2));
    } else if (l.trim() === "" && current) {
      quotes.push(current.join("\n"));
      current = null;
    } else break;
  }
  if (current) quotes.push(current.join("\n"));
  return { quotes, body: lines.slice(i).join("\n") };
}
