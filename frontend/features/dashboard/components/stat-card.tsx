import { ArrowUpRight, type LucideIcon } from "lucide-react";

type StatCardProps = {
  label: string;
  value: string;
  note: string;
  icon: LucideIcon;
  tone: "cyan" | "violet" | "amber" | "emerald";
};

// v2: cream card, tinted icon box mapped to the partner colors (cyan/violet →
// cyan/teal, amber stays amber, emerald → accent green).
export function StatCard({
  label,
  value,
  note,
  icon: Icon,
  tone,
}: StatCardProps) {
  return (
    <article className="glass-card group flex items-start gap-4">
      <span className={`icon-box icon-${tone}`} aria-hidden="true">
        <Icon className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="label">{label}</p>
        <p className="value num mt-1">{value}</p>
        <p className="delta mt-1 flex items-center gap-1">
          {note}
          <ArrowUpRight className="size-3.5 opacity-0 transition group-hover:opacity-100" />
        </p>
      </div>
    </article>
  );
}
