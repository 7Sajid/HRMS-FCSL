"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { approveJoiner, reviewDocument, saveEmployeeDetails, sendBack } from "@/app/actions/hr-review";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { Badge, ErrorBox, NoticeBox } from "@/components/ui/Feedback";

export type ReviewDoc = {
  id: string;
  kind: string;
  label: string;
  fileName: string;
  status: "PENDING" | "ACCEPTED" | "REJECTED";
  rejectionReason: string;
  isImage: boolean;
  issueDate: string | null;
  expiryDate: string | null;
};

export type Option = { id: string; name: string };

/**
 * §4 step 5, "the most important half-hour".
 *
 * The scan on one side and the fields on the other, so HR can read what they
 * are typing from rather than switching windows. Each document is accepted or
 * rejected on its own — rejecting one does not throw away the rest.
 */
export function ReviewPanel({
  employeeId,
  documents,
  details,
  options,
  suggestedId,
  canApprove,
}: {
  employeeId: string;
  documents: ReviewDoc[];
  details: Record<string, string>;
  options: {
    branches: Option[];
    departments: Option[];
    designations: Option[];
    grades: Option[];
    managers: Option[];
  };
  suggestedId: string;
  canApprove: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(documents[0]?.id ?? null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const [detailState, detailAction, detailPending] = useActionState(
    saveEmployeeDetails.bind(null, employeeId),
    null,
  );
  const [approveState, approveAction, approvePending] = useActionState(
    approveJoiner.bind(null, employeeId),
    null,
  );

  const current = documents.find((d) => d.id === open) ?? null;
  const unchecked = documents.filter((d) => d.status === "PENDING").length;
  const rejected = documents.filter((d) => d.status === "REJECTED").length;

  const decide = (id: string, accept: boolean) =>
    startTransition(async () => {
      setError("");
      const result = await reviewDocument(id, accept, reason);
      if ("error" in result) setError(result.error);
      else {
        setRejecting(null);
        setReason("");
        router.refresh();
      }
    });

  return (
    <div className="space-y-8">
      <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
        <div className="space-y-2">
          <p className="text-xs font-semibold tracking-widest text-ink-400">
            DOCUMENTS — {unchecked} STILL TO CHECK
          </p>
          {documents.map((doc) => (
            <button
              key={doc.id}
              type="button"
              onClick={() => setOpen(doc.id)}
              className={`w-full rounded-lg border p-3 text-left transition-colors ${
                open === doc.id ? "border-brand-500 bg-brand-50/50" : "border-ink-300/40 bg-white hover:bg-surface"
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="flex-1 truncate text-sm font-medium text-ink-900">{doc.label}</span>
                {doc.status === "ACCEPTED" && <Badge tone="success">Accepted</Badge>}
                {doc.status === "REJECTED" && <Badge tone="danger">Sent back</Badge>}
                {doc.status === "PENDING" && <Badge tone="warn">Unchecked</Badge>}
              </div>
              <p className="mt-0.5 truncate text-xs text-ink-500">{doc.fileName}</p>
              {doc.expiryDate && (
                <p className="mt-0.5 text-xs text-ink-500">
                  Issued {doc.issueDate} · expires {doc.expiryDate}
                </p>
              )}
              {doc.rejectionReason && (
                <p className="mt-1 text-xs text-red-600">{doc.rejectionReason}</p>
              )}
            </button>
          ))}
        </div>

        <div className="space-y-3">
          {current ? (
            <>
              <div className="overflow-hidden rounded-xl border border-ink-300/40 bg-white">
                {current.isImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`/api/download?id=${current.id}`}
                    alt={current.label}
                    className="max-h-[28rem] w-full bg-surface object-contain"
                  />
                ) : (
                  <iframe
                    src={`/api/download?id=${current.id}`}
                    title={current.label}
                    className="h-[28rem] w-full bg-surface"
                  />
                )}
              </div>

              {error && <ErrorBox>{error}</ErrorBox>}

              {rejecting === current.id ? (
                <div className="space-y-2">
                  <Textarea
                    rows={2}
                    autoFocus
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="NID back side is blurred, please re-scan."
                  />
                  <div className="flex gap-2">
                    <Button
                      variant="danger"
                      className="px-3 py-1.5 text-xs"
                      disabled={pending || reason.trim().length < 5}
                      onClick={() => decide(current.id, false)}
                    >
                      Send this one back
                    </Button>
                    <Button
                      variant="ghost"
                      className="px-3 py-1.5 text-xs"
                      onClick={() => setRejecting(null)}
                    >
                      Cancel
                    </Button>
                  </div>
                  <p className="text-xs text-ink-400">
                    Only this box reopens for them. Everything already accepted stays accepted.
                  </p>
                </div>
              ) : (
                <div className="flex gap-2">
                  <Button
                    className="px-3 py-1.5 text-xs"
                    disabled={pending}
                    onClick={() => decide(current.id, true)}
                  >
                    Accept
                  </Button>
                  <Button
                    variant="secondary"
                    className="px-3 py-1.5 text-xs"
                    disabled={pending}
                    onClick={() => {
                      setRejecting(current.id);
                      setReason("");
                    }}
                  >
                    Something is wrong with it
                  </Button>
                </div>
              )}
            </>
          ) : (
            <NoticeBox tone="warn">Nothing uploaded yet.</NoticeBox>
          )}
        </div>
      </div>

      <section>
        <h2 className="mb-1 text-sm font-semibold text-ink-900">Their details</h2>
        <p className="mb-3 text-xs text-ink-500">
          {/* Reading these with AI is deferred; HR types them from the scan on
              the left, which is why the two sit side by side. */}
          Read from the scan and typed in here. Every change is recorded with what it was before.
        </p>
        <form action={detailAction} className="grid gap-4 rounded-xl border border-ink-300/40 bg-white p-6 sm:grid-cols-2">
          {DETAIL_FIELDS.map((field) => (
            <Field key={field.name} label={field.label} htmlFor={field.name} required={field.required}>
              <Input
                id={field.name}
                name={field.name}
                type={field.type ?? "text"}
                defaultValue={details[field.name] ?? ""}
                required={field.required}
              />
            </Field>
          ))}
          <div className="sm:col-span-2 space-y-2">
            {detailState && "error" in detailState && <ErrorBox>{detailState.error}</ErrorBox>}
            {detailState && "ok" in detailState && (
              <p className="text-sm text-success-500">Saved.</p>
            )}
            <Button type="submit" variant="secondary" disabled={detailPending}>
              {detailPending ? "Saving…" : "Save their details"}
            </Button>
          </div>
        </form>
      </section>

      <section>
        <h2 className="mb-1 text-sm font-semibold text-ink-900">Approve, and open their panel</h2>
        <p className="mb-3 text-xs text-ink-500">
          The employee ID is issued at this moment. It is never reused, by anybody, ever.
        </p>

        <form action={approveAction} className="space-y-4 rounded-xl border border-ink-300/40 bg-white p-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Joining date" htmlFor="joiningDate" required hint="This decides the year in their ID.">
              <Input id="joiningDate" name="joiningDate" type="date" required />
            </Field>
            <Field
              label="Employee ID"
              htmlFor="employeeIdOverride"
              hint={`Leave blank to use the next one: ${suggestedId}`}
            >
              <Input id="employeeIdOverride" name="employeeIdOverride" placeholder={suggestedId} />
            </Field>
            <Picker label="Branch" name="branchId" options={options.branches} />
            <Picker label="Department" name="departmentId" options={options.departments} />
            <Picker label="Designation" name="designationId" options={options.designations} />
            <Picker label="Grade" name="gradeId" options={options.grades} />
            <Picker label="Reports to" name="managerId" options={options.managers} />
          </div>

          {unchecked > 0 && (
            <NoticeBox tone="warn">
              {unchecked} document{unchecked === 1 ? " is" : "s are"} still unchecked. Accept or
              reject each one before approving.
            </NoticeBox>
          )}
          {rejected > 0 && (
            <NoticeBox tone="warn">
              {rejected} document{rejected === 1 ? " is" : "s are"} marked wrong. Send the file back
              rather than approving it.
            </NoticeBox>
          )}

          {approveState && "error" in approveState && <ErrorBox>{approveState.error}</ErrorBox>}
          {approveState && "ok" in approveState && (
            <NoticeBox tone="success">
              Approved. Employee ID {approveState.employeeId} issued and their panel is open.
            </NoticeBox>
          )}

          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={approvePending || !canApprove || unchecked > 0 || rejected > 0}>
              {approvePending ? "Approving…" : "Approve and issue the ID"}
            </Button>
            <SendBackButton employeeId={employeeId} disabled={rejected === 0} />
          </div>
          {!canApprove && (
            <p className="text-xs text-ink-400">
              Only the Super Admin approves an HR Head&rsquo;s own documents.
            </p>
          )}
        </form>
      </section>
    </div>
  );
}

function Picker({ label, name, options }: { label: string; name: string; options: Option[] }) {
  return (
    <Field label={label} htmlFor={name}>
      <Select id={name} name={name} defaultValue="">
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

function SendBackButton({ employeeId, disabled }: { employeeId: string; disabled: boolean }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <Button
        type="button"
        variant="secondary"
        disabled={disabled}
        onClick={() => setOpen(true)}
        title={disabled ? "Mark at least one document as wrong first." : undefined}
      >
        Send the file back
      </Button>
    );
  }

  return (
    <div className="w-full space-y-2">
      <Textarea
        rows={2}
        autoFocus
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="A note for them, on top of the reasons on each document."
      />
      {error && <ErrorBox>{error}</ErrorBox>}
      <div className="flex gap-2">
        <Button
          type="button"
          variant="danger"
          className="px-3 py-1.5 text-xs"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await sendBack(employeeId, note);
              if ("error" in result) setError(result.error);
              else router.refresh();
            })
          }
        >
          Send it back
        </Button>
        <Button type="button" variant="ghost" className="px-3 py-1.5 text-xs" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

const DETAIL_FIELDS: { name: string; label: string; required?: boolean; type?: string }[] = [
  { name: "fullName", label: "Full name", required: true },
  { name: "fatherName", label: "Father's name" },
  { name: "motherName", label: "Mother's name" },
  { name: "dateOfBirth", label: "Date of birth", type: "date" },
  { name: "gender", label: "Gender" },
  { name: "nationality", label: "Nationality" },
  { name: "religion", label: "Religion" },
  { name: "maritalStatus", label: "Marital status" },
  { name: "nidNumber", label: "NID number" },
  { name: "mobile", label: "Mobile" },
  { name: "personalEmail", label: "Personal email" },
  { name: "presentAddress", label: "Present address" },
  { name: "permanentAddress", label: "Permanent address" },
];
