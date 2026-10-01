import type { ReactNode } from "react";

export function Card({ className = "", children }: { className?: string; children: ReactNode }) {
  return <div className={`rounded-xl border border-ink-300/40 bg-white ${className}`}>{children}</div>;
}

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        {eyebrow && (
          <p className="text-[11px] font-semibold tracking-widest text-ink-400">{eyebrow}</p>
        )}
        <h1 className="text-2xl font-bold text-ink-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

/**
 * An empty state says what would be here and, where it helps, why it is not.
 * "No results" tells somebody nothing they did not already know.
 */
export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-ink-300/60 bg-white px-6 py-12 text-center text-sm text-ink-400">
      {children}
    </div>
  );
}

/**
 * One figure with its label. Shared rather than copied: the HR Head's reports
 * and the Super Admin's month both print rows of these, and two copies of a
 * number's styling is how one of them ends up a different size.
 *
 * `value` is a string as well as a number because a ratio is "4.2%", not 4.2.
 */
export function Stat({
  label,
  value,
  big,
  tone = "neutral",
  note,
}: {
  label: string;
  value: number | string;
  big?: boolean;
  tone?: "neutral" | "warn" | "danger" | "success";
  note?: string;
}) {
  const colour =
    tone === "danger"
      ? "text-red-600"
      : tone === "warn"
        ? "text-warn-500"
        : tone === "success"
          ? "text-success-500"
          : "text-ink-900";
  return (
    <Card className="p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-400">{label}</p>
      <p className={`mt-1 font-bold tabular ${big ? "text-3xl" : "text-2xl"} ${colour}`}>{value}</p>
      {note && <p className="mt-0.5 text-xs text-ink-500">{note}</p>}
    </Card>
  );
}
