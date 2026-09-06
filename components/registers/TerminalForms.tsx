"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { assignTerminal, releaseTerminal, saveTerminal } from "@/app/actions/hr-registers";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Field";
import { ErrorBox } from "@/components/ui/Feedback";

type Option = { id: string; name: string };

export function AddTerminalForm({ branches }: { branches: Option[] }) {
  const [state, formAction, pending] = useActionState(saveTerminal, null);

  return (
    <form action={formAction} className="grid gap-4 sm:grid-cols-3">
      <Field label="Terminal ID" htmlFor="terminalId" required hint="As the exchange issued it.">
        <Input id="terminalId" name="terminalId" required placeholder="DSE-4471" />
      </Field>
      <Field label="Exchange" htmlFor="exchange" required>
        <Select id="exchange" name="exchange" defaultValue="DSE">
          <option value="DSE">DSE</option>
          <option value="CSE">CSE</option>
        </Select>
      </Field>
      <Field label="Branch" htmlFor="branchId">
        <Select id="branchId" name="branchId" defaultValue="">
          <option value="">— not set —</option>
          {branches.map((branch) => (
            <option key={branch.id} value={branch.id}>
              {branch.name}
            </option>
          ))}
        </Select>
      </Field>
      <div className="sm:col-span-3 space-y-2">
        {state && "error" in state && <ErrorBox>{state.error}</ErrorBox>}
        {state && "ok" in state && <p className="text-sm text-success-500">Added.</p>}
        <Button type="submit" disabled={pending}>
          {pending ? "Adding…" : "Add to the register"}
        </Button>
      </div>
    </form>
  );
}

export function AssignTerminal({ terminalId, people }: { terminalId: string; people: Option[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [employeeId, setEmployeeId] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => setOpen(true)}>
        Assign it
      </Button>
    );
  }

  return (
    <div className="w-full max-w-md space-y-2">
      <Select className="py-1.5 text-xs" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
        <option value="">Who holds it?</option>
        {people.map((person) => (
          <option key={person.id} value={person.id}>
            {person.name}
          </option>
        ))}
      </Select>
      <Input type="date" className="py-1.5 text-xs" value={date} onChange={(e) => setDate(e.target.value)} />
      {error && <ErrorBox>{error}</ErrorBox>}
      <div className="flex gap-2">
        <Button
          className="px-3 py-1.5 text-xs"
          disabled={pending || !employeeId}
          onClick={() =>
            startTransition(async () => {
              const result = await assignTerminal(terminalId, employeeId, date);
              if ("error" in result) setError(result.error);
              else {
                setOpen(false);
                router.refresh();
              }
            })
          }
        >
          Assign
        </Button>
        <Button variant="ghost" className="px-3 py-1.5 text-xs" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

export function ReleaseTerminal({ assignmentId }: { assignmentId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => setOpen(true)}>
        Release it
      </Button>
    );
  }

  return (
    <div className="space-y-2">
      <Input type="date" className="max-w-[12rem] py-1.5 text-xs" value={date} onChange={(e) => setDate(e.target.value)} />
      {error && <ErrorBox>{error}</ErrorBox>}
      <div className="flex gap-2">
        <Button
          className="px-3 py-1.5 text-xs"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await releaseTerminal(assignmentId, date);
              if ("error" in result) setError(result.error);
              else {
                setOpen(false);
                router.refresh();
              }
            })
          }
        >
          Release
        </Button>
        <Button variant="ghost" className="px-3 py-1.5 text-xs" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
