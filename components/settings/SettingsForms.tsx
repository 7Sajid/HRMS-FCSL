"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addHoliday,
  createLeaveType,
  removeHoliday,
  retireOrgItem,
  saveLeaveRule,
  saveOrgItem,
  saveSetting,
} from "@/app/actions/hr-settings";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Field";
import { ErrorBox } from "@/components/ui/Feedback";

export function LeaveRuleForm({
  leaveTypeId,
  current,
}: {
  leaveTypeId: string;
  current: {
    daysPerYear: string;
    carryForward: boolean;
    carryForwardCap: string;
    overBalance: string;
    attachmentRequiredAfterDays: string;
  } | null;
}) {
  const [state, formAction, pending] = useActionState(saveLeaveRule, null);

  return (
    <form action={formAction} className="grid gap-3 sm:grid-cols-3">
      <input type="hidden" name="leaveTypeId" value={leaveTypeId} />
      <Field label="Days a year" htmlFor={`days-${leaveTypeId}`} required>
        <Input
          id={`days-${leaveTypeId}`}
          name="daysPerYear"
          type="number"
          step="0.5"
          min="0"
          defaultValue={current?.daysPerYear ?? "0"}
          required
        />
      </Field>
      <Field
        label="Takes effect from"
        htmlFor={`from-${leaveTypeId}`}
        required
        hint="A new dated rule. The old one still governs older leave."
      >
        <Input id={`from-${leaveTypeId}`} name="effectiveFrom" type="date" required />
      </Field>
      <Field label="Over the balance" htmlFor={`over-${leaveTypeId}`}>
        <Select id={`over-${leaveTypeId}`} name="overBalance" defaultValue={current?.overBalance ?? "REFUSE"}>
          <option value="REFUSE">Refuse the application</option>
          <option value="WARN">Allow it with a warning</option>
        </Select>
      </Field>
      <Field label="Carry-forward cap" htmlFor={`cap-${leaveTypeId}`} hint="Blank for none.">
        <Input
          id={`cap-${leaveTypeId}`}
          name="carryForwardCap"
          type="number"
          step="0.5"
          min="0"
          defaultValue={current?.carryForwardCap ?? ""}
        />
      </Field>
      <Field
        label="Attachment needed after"
        htmlFor={`att-${leaveTypeId}`}
        hint="Days. Blank for never."
      >
        <Input
          id={`att-${leaveTypeId}`}
          name="attachmentRequiredAfterDays"
          type="number"
          min="0"
          defaultValue={current?.attachmentRequiredAfterDays ?? ""}
        />
      </Field>
      <div className="flex items-end gap-3">
        <label className="flex items-center gap-2 pb-3 text-sm text-ink-700">
          <input
            type="checkbox"
            name="carryForward"
            value="yes"
            defaultChecked={current?.carryForward}
            className="h-4 w-4 accent-brand-500"
          />
          Carries forward
        </label>
      </div>
      <div className="sm:col-span-3 space-y-2">
        {state && "error" in state && <ErrorBox>{state.error}</ErrorBox>}
        {state && "ok" in state && <p className="text-sm text-success-500">New rule added.</p>}
        <Button type="submit" variant="secondary" className="px-3 py-1.5 text-xs" disabled={pending}>
          {pending ? "Adding…" : "Add a new rule from a date"}
        </Button>
      </div>
    </form>
  );
}

export function NewLeaveTypeForm() {
  const [state, formAction, pending] = useActionState(createLeaveType, null);
  return (
    <form action={formAction} className="grid gap-3 sm:grid-cols-4">
      <Field label="Name" htmlFor="lt-name" required>
        <Input id="lt-name" name="name" required placeholder="Study leave" />
      </Field>
      <Field label="Code" htmlFor="lt-code" required hint="Capitals, no spaces.">
        <Input id="lt-code" name="code" required placeholder="STUDY" />
      </Field>
      <Field label="Days a year" htmlFor="lt-days" required>
        <Input id="lt-days" name="daysPerYear" type="number" step="0.5" min="0" defaultValue="0" required />
      </Field>
      <div className="flex items-end pb-1">
        <Button type="submit" disabled={pending}>
          {pending ? "Adding…" : "Add"}
        </Button>
      </div>
      {state && "error" in state && (
        <div className="sm:col-span-4">
          <ErrorBox>{state.error}</ErrorBox>
        </div>
      )}
    </form>
  );
}

export function HolidayForm() {
  const [state, formAction, pending] = useActionState(addHoliday, null);
  return (
    <form action={formAction} className="grid gap-3 sm:grid-cols-4">
      <Field label="Date" htmlFor="h-date" required>
        <Input id="h-date" name="date" type="date" required />
      </Field>
      <Field label="What is it" htmlFor="h-name" required>
        <Input id="h-name" name="name" required placeholder="Eid-ul-Fitr" />
      </Field>
      <div className="flex items-end pb-3">
        <label className="flex items-center gap-2 text-sm text-ink-700">
          <input type="checkbox" name="halfDay" value="yes" className="h-4 w-4 accent-brand-500" />
          Half day
        </label>
      </div>
      <div className="flex items-end pb-1">
        <Button type="submit" disabled={pending}>
          {pending ? "Adding…" : "Add"}
        </Button>
      </div>
      {state && "error" in state && (
        <div className="sm:col-span-4">
          <ErrorBox>{state.error}</ErrorBox>
        </div>
      )}
    </form>
  );
}

export function RemoveHolidayButton({ id }: { id: string }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  return (
    <span className="inline-flex flex-col items-end">
      <button
        type="button"
        disabled={pending}
        className="text-xs text-ink-500 hover:text-red-600"
        onClick={() =>
          startTransition(async () => {
            const result = await removeHoliday(id);
            if ("error" in result) setError(result.error);
            else router.refresh();
          })
        }
      >
        Remove
      </button>
      {error && <span className="mt-1 max-w-xs text-right text-xs text-red-600">{error}</span>}
    </span>
  );
}

export function OrgListForm({ kind }: { kind: "department" | "designation" | "grade" }) {
  const [state, formAction, pending] = useActionState(saveOrgItem.bind(null, kind), null);
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2">
      <Field label="Name" htmlFor={`org-${kind}`}>
        <Input id={`org-${kind}`} name="name" required className="w-56 py-2 text-sm" />
      </Field>
      {kind === "grade" && (
        <Field label="Rank" htmlFor={`rank-${kind}`} hint="1 is most senior.">
          <Input id={`rank-${kind}`} name="rank" type="number" min="0" defaultValue="0" className="w-20 py-2 text-sm" />
        </Field>
      )}
      <Button type="submit" variant="secondary" className="mb-1 px-3 py-2 text-xs" disabled={pending}>
        Add
      </Button>
      {state && "error" in state && (
        <div className="w-full">
          <ErrorBox>{state.error}</ErrorBox>
        </div>
      )}
    </form>
  );
}

export function RetireButton({
  kind,
  id,
}: {
  kind: "department" | "designation" | "grade";
  id: string;
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  return (
    <span className="inline-flex flex-col items-end">
      <button
        type="button"
        disabled={pending}
        className="text-xs text-ink-500 hover:text-ink-900"
        onClick={() =>
          startTransition(async () => {
            const result = await retireOrgItem(kind, id);
            if ("error" in result) setError(result.error);
            else router.refresh();
          })
        }
      >
        Retire
      </button>
      {error && <span className="mt-1 max-w-xs text-right text-xs text-red-600">{error}</span>}
    </span>
  );
}

export function SettingRow({
  settingKey,
  label,
  value,
  note,
}: {
  settingKey: string;
  label: string;
  value: string;
  note: string;
}) {
  const router = useRouter();
  const [next, setNext] = useState(value);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-wrap items-end gap-3 px-5 py-4">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-ink-900">{label}</p>
        <p className="text-xs text-ink-500">{note}</p>
        {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      </div>
      <Input className="w-32 py-2 text-sm" value={next} onChange={(e) => setNext(e.target.value)} />
      <Button
        variant="secondary"
        className="px-3 py-2 text-xs"
        disabled={pending || next === value}
        onClick={() =>
          startTransition(async () => {
            const result = await saveSetting(settingKey, next);
            if ("error" in result) setError(result.error);
            else {
              setSaved(true);
              router.refresh();
            }
          })
        }
      >
        {pending ? "…" : saved && next === value ? "Saved" : "Save"}
      </Button>
    </div>
  );
}
