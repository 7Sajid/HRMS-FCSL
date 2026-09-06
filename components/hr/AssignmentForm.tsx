"use client";

import { useActionState } from "react";
import { recordAssignment } from "@/app/actions/hr-setup";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Field";
import { ErrorBox, NoticeBox } from "@/components/ui/Feedback";

type Option = { id: string; name: string };

export function AssignmentForm({
  employeeId,
  options,
  current,
}: {
  employeeId: string;
  options: {
    branches: Option[];
    departments: Option[];
    designations: Option[];
    grades: Option[];
    managers: Option[];
  };
  current: {
    branchId: string | null;
    departmentId: string | null;
    designationId: string | null;
    gradeId: string | null;
    managerId: string | null;
  };
}) {
  const [state, formAction, pending] = useActionState(
    recordAssignment.bind(null, employeeId),
    null,
  );

  return (
    <form action={formAction} className="space-y-4">
      <NoticeBox tone="brand">
        This is recorded as a dated event, never as an overwrite. The old posting keeps its history
        and the new one takes over from the date you set — which is what lets a former manager still
        see the period somebody reported to them.
      </NoticeBox>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Takes effect from" htmlFor="effectiveFrom" required>
          <Input id="effectiveFrom" name="effectiveFrom" type="date" required />
        </Field>
        <Field label="What is this" htmlFor="reason" required>
          <Select id="reason" name="reason" defaultValue="TRANSFER">
            <option value="TRANSFER">Transfer</option>
            <option value="PROMOTION">Promotion</option>
            <option value="MANAGER_CHANGE">Change of manager</option>
            <option value="CORRECTION">Correcting a mistake</option>
          </Select>
        </Field>

        <Picker label="Branch" name="branchId" options={options.branches} value={current.branchId} />
        <Picker label="Department" name="departmentId" options={options.departments} value={current.departmentId} />
        <Picker label="Designation" name="designationId" options={options.designations} value={current.designationId} />
        <Picker label="Grade" name="gradeId" options={options.grades} value={current.gradeId} />
        <Picker label="Reports to" name="managerId" options={options.managers} value={current.managerId} />

        <Field label="Note" htmlFor="note" hint="They see this.">
          <Input id="note" name="note" />
        </Field>
      </div>

      {state && "error" in state && <ErrorBox>{state.error}</ErrorBox>}
      {state && "ok" in state && <p className="text-sm text-success-500">Recorded.</p>}

      <Button type="submit" disabled={pending}>
        {pending ? "Recording…" : "Record the change"}
      </Button>
    </form>
  );
}

function Picker({
  label,
  name,
  options,
  value,
}: {
  label: string;
  name: string;
  options: Option[];
  value: string | null;
}) {
  return (
    <Field label={label} htmlFor={name} hint="Leave as it is to keep the current one.">
      <Select id={name} name={name} defaultValue={value ?? ""}>
        <option value="">— not set —</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </Select>
    </Field>
  );
}
