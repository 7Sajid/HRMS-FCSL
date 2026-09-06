"use client";

import { useActionState, useState } from "react";
import { issueShowCause } from "@/app/actions/compliance";
import { SHOWCAUSE_TEMPLATES } from "@/lib/showcause";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { ErrorBox, NoticeBox } from "@/components/ui/Feedback";

export function IssueShowCauseForm({ people }: { people: { id: string; name: string }[] }) {
  const [state, formAction, pending] = useActionState(issueShowCause, null);
  const [body, setBody] = useState("");
  const [subject, setSubject] = useState("");

  return (
    <form action={formAction} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Who is this about" htmlFor="employeeId" required>
          <Select id="employeeId" name="employeeId" defaultValue="" required>
            <option value="" disabled>
              Choose somebody
            </option>
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Start from a template"
          htmlFor="template"
          hint="So the wording and legal footing stay consistent."
        >
          <Select
            id="template"
            defaultValue=""
            onChange={(e) => {
              const template = SHOWCAUSE_TEMPLATES.find((t) => t.name === e.target.value);
              if (template) {
                setSubject(template.name);
                setBody(template.body);
              }
            }}
          >
            <option value="">Write it from scratch</option>
            {SHOWCAUSE_TEMPLATES.map((template) => (
              <option key={template.name} value={template.name}>
                {template.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Field label="Subject" htmlFor="subject" required>
        <Input
          id="subject"
          name="subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          required
        />
      </Field>

      <Field
        label="The letter"
        htmlFor="body"
        required
        hint="Replace anything in [SQUARE BRACKETS] before issuing."
      >
        <Textarea id="body" name="body" rows={12} value={body} onChange={(e) => setBody(e.target.value)} required />
      </Field>

      <label className="flex items-start gap-2 text-sm text-ink-700">
        <input type="checkbox" name="visibleToManager" value="yes" className="mt-0.5 h-4 w-4 accent-brand-500" />
        <span>
          Let their manager see this file.
          <span className="mt-0.5 block text-xs text-ink-500">
            {/* §6.5 — off by default, and the default is the point. */}
            Off unless you turn it on. By default a show-cause is visible only to you and to the
            person concerned.
          </span>
        </span>
      </label>

      {state && "error" in state && <ErrorBox>{state.error}</ErrorBox>}

      <NoticeBox tone="warn">
        They are told immediately — a notification, an email that carries no detail, and a red banner
        across their panel that cannot be dismissed. Delivery and receipt are timestamped, which
        protects them and the company equally.
      </NoticeBox>

      <Button type="submit" disabled={pending}>
        {pending ? "Issuing…" : "Issue the letter"}
      </Button>
    </form>
  );
}
