import type { ReactNode } from "react";

/**
 * A read-only record, laid out as label/value pairs. Used by every "here is
 * what we hold about you" screen, so they cannot drift apart.
 */
export function DataList({ children }: { children: ReactNode }) {
  return <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2">{children}</dl>;
}

export function DataRow({
  label,
  value,
  wide,
}: {
  label: string;
  value: ReactNode;
  wide?: boolean;
}) {
  const empty = value === null || value === undefined || value === "";
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <dt className="text-xs font-medium uppercase tracking-wide text-ink-400">{label}</dt>
      <dd className={`mt-1 text-sm ${empty ? "text-ink-300" : "text-ink-900"}`}>
        {/* An em dash rather than a blank: a missing value and a broken layout
            look the same otherwise. */}
        {empty ? "—" : value}
      </dd>
    </div>
  );
}
