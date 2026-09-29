import { memo, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Shiki is loaded on first use; highlighted HTML is cached per (lang, code).
let highlighter: Promise<typeof import("shiki")> | null = null;
const cache = new Map<string, string>();

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const key = `${lang}\u0000${code}`;
  const [html, setHtml] = useState(() => cache.get(key) ?? null);

  useEffect(() => {
    if (cache.has(key)) return setHtml(cache.get(key)!);
    let alive = true;
    highlighter ??= import("shiki");
    highlighter
      .then((shiki) =>
        shiki.codeToHtml(code, {
          lang: lang in shiki.bundledLanguages ? lang : "text",
          themes: { light: "github-light", dark: "github-dark" },
          defaultColor: false,
        }),
      )
      .then((out) => {
        cache.set(key, out);
        if (alive) setHtml(out);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [key, lang, code]);

  if (html) return <div className="wb-code" dangerouslySetInnerHTML={{ __html: html }} />;
  return (
    <pre className="wb-code">
      <code>{code}</code>
    </pre>
  );
}

/** Markdown for completed messages. `streaming` skips highlighting until the block is final. */
export const Markdown = memo(function Markdown({ text, streaming = false }: { text: string; streaming?: boolean }) {
  return (
    <div className="wb-prose">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre: ({ children }) => <>{children}</>,
          code: ({ className, children }) => {
            const lang = /language-(\S+)/.exec(className ?? "")?.[1];
            const code = String(children ?? "");
            if (!lang && !code.includes("\n")) return <code className="wb-inline-code">{children}</code>;
            const body = code.replace(/\n$/, "");
            return streaming ? (
              <pre className="wb-code">
                <code>{body}</code>
              </pre>
            ) : (
              <CodeBlock lang={lang ?? "text"} code={body} />
            );
          },
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});
