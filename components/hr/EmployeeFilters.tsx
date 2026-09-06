"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Field, Input, Select } from "@/components/ui/Field";

type Option = { id: string; name: string };

/**
 * §5.3: "Type a name or an ID and the list narrows as you type."
 *
 * The typing is debounced and the filters navigate, so the result is a URL —
 * which means a filtered list can be sent to somebody, bookmarked, and
 * exported with exactly the filters on screen.
 */
export function EmployeeFilters({
  options,
  current,
}: {
  options: {
    branches: Option[];
    departments: Option[];
    designations: Option[];
    grades: Option[];
    managers: Option[];
  };
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
      if (next.toString() !== params.toString()) router.replace(`/hr/employees?${next.toString()}`);
    }, 250);
    return () => clearTimeout(timer);
  }, [q, params, router]);

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete("page");
    router.replace(`/hr/employees?${next.toString()}`);
  };

  return (
    <aside className="space-y-4">
      <Field label="Search" htmlFor="q" hint="Name, employee ID, email or mobile.">
        <Input id="q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Karim, A 413…" />
      </Field>

      <Picker label="Branch" name="branch" options={options.branches} current={current} onChange={setFilter} />
      <Picker label="Department" name="department" options={options.departments} current={current} onChange={setFilter} />
      <Picker label="Designation" name="designation" options={options.designations} current={current} onChange={setFilter} />
      <Picker label="Grade" name="grade" options={options.grades} current={current} onChange={setFilter} />
      <Picker label="Reports to" name="manager" options={options.managers} current={current} onChange={setFilter} />

      <Field label="Staff or RM" htmlFor="type">
        <Select id="type" value={current.type ?? ""} onChange={(e) => setFilter("type", e.target.value)}>
          <option value="">Everybody</option>
          <option value="STAFF">Staff</option>
          <option value="RM">Relationship Manager</option>
        </Select>
      </Field>

      <Field label="Active or left" htmlFor="status">
        <Select id="status" value={current.status ?? ""} onChange={(e) => setFilter("status", e.target.value)}>
          <option value="">Everybody</option>
          <option value="ACTIVE">Active</option>
          <option value="LEFT">Left</option>
        </Select>
      </Field>

      <div className="grid grid-cols-2 gap-2">
        <Field label="Joined from" htmlFor="joinedFrom">
          <Input
            id="joinedFrom"
            type="date"
            value={current.joinedFrom ?? ""}
            onChange={(e) => setFilter("joinedFrom", e.target.value)}
          />
        </Field>
        <Field label="Joined to" htmlFor="joinedTo">
          <Input
            id="joinedTo"
            type="date"
            value={current.joinedTo ?? ""}
            onChange={(e) => setFilter("joinedTo", e.target.value)}
          />
        </Field>
      </div>

      <button
        type="button"
        onClick={() => {
          setQ("");
          router.replace("/hr/employees");
        }}
        className="text-xs text-ink-500 hover:text-ink-900"
      >
        Clear all filters
      </button>
    </aside>
  );
}

function Picker({
  label,
  name,
  options,
  current,
  onChange,
}: {
  label: string;
  name: string;
  options: Option[];
  current: Record<string, string | undefined>;
  onChange: (key: string, value: string) => void;
}) {
  return (
    <Field label={label} htmlFor={name}>
      <Select id={name} value={current[name] ?? ""} onChange={(e) => onChange(name, e.target.value)}>
        <option value="">All</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </Select>
    </Field>
  );
}
