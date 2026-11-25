import type { ReactNode } from "react";

type SectionHeadingProps = {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
};

// v2: eyebrow uses the accent green, not blue.
export function SectionHeading({
  eyebrow,
  title,
  description,
  action,
}: SectionHeadingProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
      <div>
        {eyebrow ? (
          <p
            className="label mb-1"
            style={{ color: "var(--accent-strong)" }}
          >
            {eyebrow}
          </p>
        ) : null}
        <h2 className="text-2xl font-semibold tracking-tight text-foreground md:text-3xl">
          {title}
        </h2>
        {description ? (
          <p className="sub mt-2 max-w-2xl">{description}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
