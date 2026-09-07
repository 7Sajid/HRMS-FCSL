"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Field, Input, Select } from "@/components/ui/Field";

/**
 * The filter chips over the permanent record (P4.7).
 *
 * Every control writes to the URL rather than to local state, so a filtered
 * view can be sent to somebody else, bookmarked, and — the part that matters —
 * exported with exactly the filters that are on the screen.
 */
export function AuditFilters({
  groups,
  current,
}: {
  groups: { label: string; actions: { value: string; label: string }[] }[];
  current: Record<string, string | undefined>;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState(current.q ?? "");

  useEffect(() => {
    const timer = setTimeout(() => {
      const next = new URLSearchParams(params.toString());
      if (q) next.set("q", q);
      else next.delete("q");
      next.delete("page");
      if (next.toString() !== params.toString()) router.replace(`/admin/audit?${next.toString()}`);
    }, 250);
    return () => clearTimeout(timer);
  }, [q, params, router]);

  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    // Changing what you are looking at should never leave you on page 7 of a
    // list that now has two pages.
    next.delete("page");
    // A group and an exact action can contradict each other, so choosing a
    // group drops whatever single action was selected inside the old one.
    if (key === "group") next.delete("action");
    router.replace(`/admin/audit?${next.toString()}`);
  };

  const activeGroup = groups.find((g) => g.label === current.group);
  const filtered = Object.entries(current).some(([key, value]) => value && key !== "page");

  return (
    <div className="mb-6 space-y-4">
      <div className="flex flex-wrap gap-2">
        <Chip active={!current.group} onClick={() => set("group", "")}>
          Everything
        </Chip>
        {groups.map((group) => (
          <Chip
            key={group.label}
            active={current.group === group.label}
            onClick={() => set("group", group.label)}
          >
            {group.label}
          </Chip>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Search" htmlFor="audit-q" hint="Who did it, or what it was done to.">
          <Input
            id="audit-q"
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder="Nasreen, DSE-4471…"
          />
        </Field>

        <Field label="Exactly what happened" htmlFor="audit-action">
          <Select
            id="audit-action"
            value={current.action ?? ""}
            onChange={(event) => set("action", event.target.value)}
          >
            <option value="">
              {activeGroup ? `Everything in ${activeGroup.label}` : "Everything"}
            </option>
            {(activeGroup ? [activeGroup] : groups).map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.actions.map((action) => (
                  <option key={action.value} value={action.value}>
                    {action.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        </Field>

        <Field label="From" htmlFor="audit-from">
          <Input
            id="audit-from"
            type="date"
            value={current.from ?? ""}
            onChange={(event) => set("from", event.target.value)}
          />
        </Field>

        <Field label="To" htmlFor="audit-to">
          <Input
            id="audit-to"
            type="date"
            value={current.to ?? ""}
            onChange={(event) => set("to", event.target.value)}
          />
        </Field>
      </div>

      {filtered && (
        <Link href="/admin/audit" className="text-sm text-brand-500 hover:underline">
          Clear the filters
        </Link>
      )}
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        active
          ? "rounded-full bg-brand-500 px-3 py-1.5 text-xs font-medium text-white"
          : "rounded-full border border-ink-300/60 bg-white px-3 py-1.5 text-xs font-medium text-ink-700 hover:bg-surface"
      }
    >
      {children}
    </button>
  );
}
