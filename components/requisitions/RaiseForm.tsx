"use client";

import { useActionState, useState } from "react";
import { raiseRequisition } from "@/app/actions/requisitions";
import { REQUISITION_TYPES } from "@/lib/requisitions";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { ErrorBox, NoticeBox } from "@/components/ui/Feedback";

/**
 * One form, four types. The fields change to suit the type chosen; the journey
 * afterwards is identical, which is why this is one screen and not four.
 */
export function RaiseRequisitionForm({
  /**
   * Non-empty only for the HR Head. Their own requisition skips their desk and
   * goes straight to the Super Admin (§7.2), so there is no approval step at
   * which they could name the department that will action it — they name it
   * here. Everybody else's is named by the HR Head when they approve it.
   */
  departments = [],
}: {
  departments?: readonly { id: string; name: string }[];
}) {
  const [state, formAction, pending] = useActionState(raiseRequisition, null);
  const [type, setType] = useState(REQUISITION_TYPES[0]!.type);
  const [amount, setAmount] = useState("");

  const spec = REQUISITION_TYPES.find((r) => r.type === type)!;

  return (
    <form action={formAction} className="space-y-4">
      <Field label="What are you asking for?" htmlFor="type" required>
        <Select
          id="type"
          name="type"
          value={type}
          onChange={(e) => setType(e.target.value as typeof type)}
        >
          {REQUISITION_TYPES.map((r) => (
            <option key={r.type} value={r.type}>
              {r.label}
            </option>
          ))}
        </Select>
      </Field>

      {/* Keyed on the type, so switching does not leave the previous type's
          answers sitting invisibly in the form. */}
      <div key={type} className="grid gap-4 sm:grid-cols-2">
        {spec.fields.map((field) => (
          <Field
            key={field.name}
            label={field.label}
            htmlFor={field.name}
            required={field.required}
            hint={field.hint}
          >
            {field.type === "textarea" ? (
              <Textarea id={field.name} name={field.name} rows={2} required={field.required} />
            ) : (
              <Input
                id={field.name}
                name={field.name}
                type={field.type === "number" ? "number" : field.type}
                min={field.type === "number" ? 1 : undefined}
                required={field.required}
              />
            )}
          </Field>
        ))}

        {spec.hasAmount && (
          <Field label="Amount (৳)" htmlFor="amount" required>
            <Input
              id="amount"
              name="amount"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
          </Field>
        )}
      </div>

      {departments.length > 0 && (
        <Field
          label="Which department will action it?"
          htmlFor="actionDepartmentId"
          required
          hint="Yours goes straight to the Super Admin, so say now who does the work."
        >
          <Select id="actionDepartmentId" name="actionDepartmentId" defaultValue="" required>
            <option value="" disabled>
              Choose a department…
            </option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </Field>
      )}

      <NoticeBox tone="brand">
        <p>
          {departments.length > 0 ? (
            <>
              This goes straight to the <strong className="font-medium">Super Admin</strong>.
            </>
          ) : (
            <>
              This goes to the <strong className="font-medium">HR Head</strong>, who says which
              department will action it, and then to the{" "}
              <strong className="font-medium">Super Admin</strong>.
            </>
          )}
        </p>
        <p className="mt-1">{spec.endsWith}</p>
      </NoticeBox>

      {state && "error" in state && <ErrorBox>{state.error}</ErrorBox>}
      {state && "ok" in state && <p className="text-sm text-success-500">Raised. It is on its way.</p>}

      <Button type="submit" disabled={pending}>
        {pending ? "Sending…" : "Raise it"}
      </Button>
    </form>
  );
}
