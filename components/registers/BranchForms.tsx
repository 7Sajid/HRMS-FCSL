"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { closeBranch, saveBranch } from "@/app/actions/hr-registers";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Field";
import { ErrorBox } from "@/components/ui/Feedback";

type Option = { id: string; name: string };

export function BranchForm({
  branchId,
  initial,
  managers,
}: {
  branchId: string | null;
  initial?: {
    name: string;
    code: string;
    address: string;
    phone: string;
    openedOn: string;
    branchManagerId: string | null;
  };
  managers: Option[];
}) {
  const [state, formAction, pending] = useActionState(saveBranch.bind(null, branchId), null);

  return (
    <form action={formAction} className="grid gap-4 sm:grid-cols-2">
      <Field label="Name" htmlFor={`name-${branchId ?? "new"}`} required>
        <Input id={`name-${branchId ?? "new"}`} name="name" defaultValue={initial?.name ?? ""} required />
      </Field>
      <Field label="Code" htmlFor={`code-${branchId ?? "new"}`} required hint="Short, like HO or MOT.">
        <Input id={`code-${branchId ?? "new"}`} name="code" defaultValue={initial?.code ?? ""} required />
      </Field>
      <Field label="Address" htmlFor={`address-${branchId ?? "new"}`}>
        <Input id={`address-${branchId ?? "new"}`} name="address" defaultValue={initial?.address ?? ""} />
      </Field>
      <Field label="Phone" htmlFor={`phone-${branchId ?? "new"}`}>
        <Input id={`phone-${branchId ?? "new"}`} name="phone" defaultValue={initial?.phone ?? ""} />
      </Field>
      <Field label="Opened on" htmlFor={`opened-${branchId ?? "new"}`}>
        <Input
          id={`opened-${branchId ?? "new"}`}
          name="openedOn"
          type="date"
          defaultValue={initial?.openedOn ?? ""}
        />
      </Field>
      <Field
        label="Branch manager"
        htmlFor={`manager-${branchId ?? "new"}`}
        hint="They fill in this branch's monthly attendance."
      >
        <Select
          id={`manager-${branchId ?? "new"}`}
          name="branchManagerId"
          defaultValue={initial?.branchManagerId ?? ""}
        >
          <option value="">— not set —</option>
          {managers.map((manager) => (
            <option key={manager.id} value={manager.id}>
              {manager.name}
            </option>
          ))}
        </Select>
      </Field>

      <div className="sm:col-span-2 space-y-2">
        {state && "error" in state && <ErrorBox>{state.error}</ErrorBox>}
        {state && "ok" in state && <p className="text-sm text-success-500">Saved.</p>}
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : branchId ? "Save changes" : "Create the branch"}
        </Button>
      </div>
    </form>
  );
}

export function CloseBranchButton({ branchId, attached }: { branchId: string; attached: number }) {
  const router = useRouter();
  const [date, setDate] = useState("");
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  if (attached > 0) {
    return (
      <p className="text-xs text-ink-400">
        {/* §6.7: its people must be moved somewhere else first. */}
        {attached} {attached === 1 ? "person is" : "people are"} still here, so this branch cannot be
        closed yet.
      </p>
    );
  }

  if (!open) {
    return (
      <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => setOpen(true)}>
        Close this branch
      </Button>
    );
  }

  return (
    <div className="space-y-2">
      <Input type="date" className="max-w-[12rem] py-1.5 text-xs" value={date} onChange={(e) => setDate(e.target.value)} />
      {error && <ErrorBox>{error}</ErrorBox>}
      <div className="flex gap-2">
        <Button
          variant="danger"
          className="px-3 py-1.5 text-xs"
          disabled={pending || !date}
          onClick={() =>
            startTransition(async () => {
              const result = await closeBranch(branchId, date);
              if ("error" in result) setError(result.error);
              else router.refresh();
            })
          }
        >
          Mark it closed
        </Button>
        <Button variant="ghost" className="px-3 py-1.5 text-xs" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      <p className="text-xs text-ink-400">
        Closing is a date, not a deletion. Everything that happened here stays readable.
      </p>
    </div>
  );
}
