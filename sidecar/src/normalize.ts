// Maps Agent SDK messages to Workbench events (see the plan's Contracts table).
// Pure apart from the small state object, so it can be tested with recorded
// SDK messages. This file is the only place that knows SDK message shapes.

export type Event = Record<string, unknown> & { type: string };

export const MAX_OUTPUT = 8 * 1024;

type Block = { id: string; kind: "text" | "thinking" | "other"; text: string };

export type NormalizeState = {
  msgId: string | null;
  blocks: Map<number, Block>;
  streamed: Set<string>; // message ids whose text arrived via stream events
  turnId: string | null;
  interrupting: boolean;
};

export const initialState = (): NormalizeState => ({
  msgId: null,
  blocks: new Map(),
  streamed: new Set(),
  turnId: null,
  interrupting: false,
});

type Any = any;

export function normalize(st: NormalizeState, m: Any): Event[] {
  switch (m?.type) {
    case "system":
      if (m.subtype === "init") return [{ type: "session.started", session_id: m.session_id, model: m.model }];
      return [];

    case "stream_event":
      // Subagent text is dropped in v1; its tools come through assistant/user messages.
      if (m.parent_tool_use_id) return [];
      return streamEvent(st, m.event);

    case "assistant":
      return assistant(st, m);

    case "user":
      return toolResults(m);

    case "result":
      return result(st, m);

    default:
      return [];
  }
}

function streamEvent(st: NormalizeState, ev: Any): Event[] {
  switch (ev?.type) {
    case "message_start":
      st.msgId = ev.message?.id ?? `msg-${Date.now()}`;
      st.blocks.clear();
      return [];

    case "content_block_start": {
      const t = ev.content_block?.type;
      const kind = t === "text" ? "text" : t === "thinking" ? "thinking" : "other";
      if (kind !== "other" && st.msgId) st.streamed.add(st.msgId);
      st.blocks.set(ev.index, { id: `${st.msgId}:${ev.index}`, kind, text: "" });
      return [];
    }

    case "content_block_delta": {
      const b = st.blocks.get(ev.index);
      if (!b) return [];
      const d = ev.delta;
      // Some models omit their thinking and stream one empty delta. Forwarding it
      // would open a live row that content_block_stop never closes (no text).
      if (!d?.text && !d?.thinking) return [];
      if (d?.type === "text_delta" && b.kind === "text") {
        b.text += d.text;
        return [{ type: "text.delta", item_id: b.id, text: d.text }];
      }
      if (d?.type === "thinking_delta" && b.kind === "thinking") {
        b.text += d.thinking;
        return [{ type: "reasoning.delta", item_id: b.id, text: d.thinking }];
      }
      return [];
    }

    case "content_block_stop": {
      const b = st.blocks.get(ev.index);
      st.blocks.delete(ev.index);
      if (!b || b.kind === "other" || b.text === "") return [];
      return [
        {
          type: "item.completed",
          item: { id: b.id, kind: b.kind === "text" ? "assistant_message" : "reasoning", text: b.text },
        },
      ];
    }

    default:
      return [];
  }
}

const TOOL_BLOCKS = new Set(["tool_use", "server_tool_use", "mcp_tool_use"]);

function assistant(st: NormalizeState, m: Any): Event[] {
  const out: Event[] = [];
  const msg = m.message ?? {};
  const parent = m.parent_tool_use_id ?? undefined;
  const content: Any[] = Array.isArray(msg.content) ? msg.content : [];

  content.forEach((block, i) => {
    if (TOOL_BLOCKS.has(block?.type)) {
      out.push({ type: "tool.started", item_id: block.id, name: block.name, input: block.input ?? {}, ...(parent ? { parent_id: parent } : {}) });
      return;
    }
    // Text normally arrives through stream events; only use the full message
    // when it did not stream (synthetic or error messages), and never for subagents.
    if (parent || st.streamed.has(msg.id)) return;
    if (block?.type === "text" && block.text) {
      out.push({ type: "item.completed", item: { id: `${m.uuid ?? msg.id}:${i}`, kind: "assistant_message", text: block.text } });
    } else if (block?.type === "thinking" && block.thinking) {
      out.push({ type: "item.completed", item: { id: `${m.uuid ?? msg.id}:${i}`, kind: "reasoning", text: block.thinking } });
    }
  });

  if (m.error && !parent) out.push({ type: "error", message: `Assistant error: ${String(m.error)}`, fatal: false });
  return out;
}

function toolResults(m: Any): Event[] {
  const content = m.message?.content;
  if (!Array.isArray(content)) return [];
  return content
    .filter((b: Any) => b?.type === "tool_result" || b?.type === "mcp_tool_result")
    .map((b: Any) => {
      const [output, truncated] = truncate(stringify(b.content));
      const images = imagesOf(b.content);
      return {
        type: "tool.completed",
        item_id: b.tool_use_id,
        output,
        truncated,
        is_error: Boolean(b.is_error),
        // e.g. Read on a picture; the server stores them and shows them in the timeline
        ...(images.length ? { images } : {}),
      };
    });
}

function result(st: NormalizeState, m: Any): Event[] {
  const ok = m.subtype === "success" && !m.is_error;
  const status = st.interrupting ? "interrupted" : ok ? "ok" : "error";
  const u = m.usage ?? {};
  const out: Event[] = [];

  if (status === "error") {
    const detail = [m.result, ...(Array.isArray(m.errors) ? m.errors : [])].filter(Boolean).join("\n");
    out.push({ type: "error", message: detail || `Turn failed (${m.subtype})`, fatal: false });
  }

  out.push({
    type: "turn.completed",
    turn_id: st.turnId,
    status,
    usage: {
      input_tokens: u.input_tokens ?? 0,
      output_tokens: u.output_tokens ?? 0,
      cache_read_input_tokens: u.cache_read_input_tokens ?? 0,
      cache_creation_input_tokens: u.cache_creation_input_tokens ?? 0,
    },
    cost_usd: m.total_cost_usd ?? null,
  });

  st.turnId = null;
  st.interrupting = false;
  st.streamed.clear();
  return out;
}

function stringify(c: Any): string {
  if (c == null) return "";
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    return c.map((p) => (p?.type === "text" ? p.text : p?.type === "image" ? "[image]" : JSON.stringify(p))).join("\n");
  }
  return JSON.stringify(c);
}

function imagesOf(c: Any): { data: string; mime: string }[] {
  if (!Array.isArray(c)) return [];
  return c
    .filter((p) => p?.type === "image" && p.source?.type === "base64" && typeof p.source.data === "string")
    .map((p) => ({ data: p.source.data, mime: p.source.media_type }));
}

function truncate(s: string): [string, boolean] {
  if (Buffer.byteLength(s) <= MAX_OUTPUT) return [s, false];
  return [Buffer.from(s).subarray(0, MAX_OUTPUT).toString("utf8").replace(/�$/, ""), true];
}
