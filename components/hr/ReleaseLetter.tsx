"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { issueReleaseLetter } from "@/app/actions/hr-exit";
import { Button } from "@/components/ui/Button";
import { Field, Textarea } from "@/components/ui/Field";
import { ErrorBox, NoticeBox } from "@/components/ui/Feedback";

/**
 * §6.6 step 5 — "produced from a template and stored in the person's file."
 *
 * The draft is filled in from what the system knows; HR reads it and changes
 * whatever FCSL words differently before the PDF is made. That editing step is
 * the point — a release letter is shown to a future employer, and no default
 * wording should go out over the company's name unread.
 */
export function ReleaseLetter({
  employeeId,
  draft,
  existingDocumentId,
}: {
  employeeId: string;
  draft: string;
  existingDocumentId: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState(draft);
  const [error, setError] = useState("");

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" onClick={() => setOpen(true)}>
          {existingDocumentId ? "Issue a new release letter" : "Write the release letter"}
        </Button>
        {existingDocumentId && (
          <a
            href={`/api/download?id=${existingDocumentId}`}
            target="_blank"
            rel="noopener"
            className="text-sm text-brand-500 hover:underline"
          >
            Open the letter on file
          </a>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {error && <ErrorBox>{error}</ErrorBox>}
      <NoticeBox tone="warn">
        This draft is written by the software from the dates and the job title on file. Read it
        before you issue it — it goes out over the company&rsquo;s name and the person may show it
        to a future employer.
        {existingDocumentId
          ? " A letter has already been issued; the old one stays in the file."
          : ""}
      </NoticeBox>
      <Field label="The letter" htmlFor={`letter-${employeeId}`} required>
        <Textarea
          id={`letter-${employeeId}`}
          rows={12}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const result = await issueReleaseLetter(employeeId, body);
              if ("error" in result) setError(result.error);
              else {
                setError("");
                setOpen(false);
                router.refresh();
              }
            })
          }
        >
          {pending ? "Producing…" : "Produce the PDF and file it"}
        </Button>
        <Button variant="secondary" disabled={pending} onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
