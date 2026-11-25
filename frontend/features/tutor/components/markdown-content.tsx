"use client";

import { useMemo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";

type MarkdownContentProps = {
  children: string;
  className?: string;
};

export function MarkdownContent({ children, className }: MarkdownContentProps) {
  const components = useMemo(
    () =>
      ({
        // Keep table/text readable inside chat bubbles
        p: ({ children: c }) => <p className="my-1.5 leading-6">{c}</p>,
        ul: ({ children: c }) => <ul className="my-1.5 list-disc pl-5 space-y-0.5">{c}</ul>,
        ol: ({ children: c }) => <ol className="my-1.5 list-decimal pl-5 space-y-0.5">{c}</ol>,
        code: ({ className: codeClass, children: c }) => {
          const isBlock = !codeClass;
          return isBlock ? (
            <pre className="my-2 overflow-x-auto rounded-lg bg-muted p-3 text-xs">
              <code>{c}</code>
            </pre>
          ) : (
            <code className="rounded bg-muted px-1 py-0.5 text-[0.85em]">{c}</code>
          );
        },
      }) satisfies Components,
    []
  );

  if (!children?.trim()) {
    return <p className="whitespace-pre-wrap break-words text-sm leading-6">{children}</p>;
  }

  return (
    <div className={`text-sm ${className ?? ""}`}>
      <ReactMarkdown
        remarkPlugins={[remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={components}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
