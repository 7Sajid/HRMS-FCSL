"use client";

import { useActionState, useState } from "react";
import { importEmployees } from "@/app/actions/hr-import";
import { IMPORT_COLUMNS } from "@/lib/import";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { Badge, ErrorBox, NoticeBox } from "@/components/ui/Feedback";

/**
 * §12.1 — check every row before saving anything, and report exactly which
 * rows have a problem and why.
 *
 * Dry by default, and the commit button only appears once the file is clean.
 */
export function ImportPanel() {
  const [state, formAction, pending] = useActionState(importEmployees, null);
  const [commit, setCommit] = useState(false);

  const result = state && "ok" in state ? state : null;
  const clean =
    result &&
    result.problems.length === 0 &&
    result.missingColumns.length === 0 &&
    // An unmatched name empties a field rather than failing a row, so it has to
    // count against "clean" here too — otherwise the screen offers a Commit the
    // action then refuses.
    result.unmatched.length === 0;

  return (
    <div className="space-y-6">
      <form action={formAction} className="space-y-4">
        <input type="hidden" name="commit" value={commit ? "yes" : "no"} />

        <Field
          label="The spreadsheet"
          htmlFor="file"
          required
          hint="Saved as CSV. Nothing is written until you have seen the check."
        >
          <Input id="file" name="file" type="file" accept=".csv,text/csv" required />
        </Field>

        {state && "error" in state && <ErrorBox>{state.error}</ErrorBox>}

        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="secondary" disabled={pending} onClick={() => setCommit(false)}>
            {pending && !commit ? "Checking…" : "Check the file"}
          </Button>
          {clean && result.counted > 0 && (
            <Button type="submit" disabled={pending} onClick={() => setCommit(true)}>
              {pending && commit ? "Importing…" : `Import ${result.counted} people`}
            </Button>
          )}
        </div>
      </form>

      {result && (
        <div className="space-y-4">
          {result.committed ? (
            <NoticeBox tone="success">
              <p className="font-medium">
                {result.counted} {result.counted === 1 ? "person" : "people"} imported.
              </p>
              <p className="mt-1">
                They are at Stage 2 with the IDs they already had — they did not go through the
                locked door, because they are already employed.
              </p>
              {result.sequence && (
                <p className="mt-1">
                  The running counter now starts at {result.sequence.letter}{" "}
                  {String(result.sequence.nextNumber).padStart(3, "0")}, so the next person to join
                  cannot collide with anybody imported.
                </p>
              )}
            </NoticeBox>
          ) : (
            <NoticeBox tone={clean ? "success" : "warn"}>
              {clean ? (
                <p>
                  <strong className="font-medium">Nothing wrong with this file.</strong>{" "}
                  {result.counted} {result.counted === 1 ? "person" : "people"} would be imported.
                  Nothing has been saved yet.
                </p>
              ) : (
                <p>
                  <strong className="font-medium">
                    {result.problems.length + result.missingColumns.length + result.unmatched.length}{" "}
                    problem
                    {result.problems.length + result.missingColumns.length + result.unmatched.length === 1
                      ? ""
                      : "s"}{" "}
                    found.
                  </strong>{" "}
                  Nothing has been saved. Fix the spreadsheet and check it again.
                </p>
              )}
            </NoticeBox>
          )}

          {result.missingColumns.length > 0 && (
            <div className="rounded-xl border border-red-300 bg-red-50/40 p-5">
              <h3 className="text-sm font-medium text-red-700">Columns the file does not have</h3>
              <ul className="mt-2 list-inside list-disc text-sm text-ink-700">
                {result.missingColumns.map((column) => (
                  <li key={column}>{column}</li>
                ))}
              </ul>
            </div>
          )}

          {result.unmatched.length > 0 && (
            <div className="rounded-xl border border-red-300 bg-red-50/40 p-5">
              <h3 className="text-sm font-medium text-red-700">
                Names that match nothing in the system
              </h3>
              <p className="mt-1 text-xs text-ink-500">
                {/* §12.1. These do not fail a row — they would import the person
                    with that field empty — which is why nothing is saved until
                    they are settled. */}
                Each of these was typed in the file but is not on the company&rsquo;s lists. Left
                alone, those people would be imported with the field <strong>blank</strong>. Correct
                the spelling in the spreadsheet, or add the name in Settings, then run it again.
              </p>
              <ul className="mt-3 space-y-1.5 text-sm">
                {result.unmatched.map((miss) => (
                  <li key={`${miss.column}-${miss.value}`} className="text-ink-700">
                    <span className="text-xs uppercase tracking-wide text-ink-400">
                      {miss.column}
                    </span>{" "}
                    <strong className="font-medium text-ink-900">
                      &ldquo;{miss.value}&rdquo;
                    </strong>{" "}
                    <span className="text-xs text-ink-500">
                      — {miss.rows.length} row{miss.rows.length === 1 ? "" : "s"} (
                      {miss.rows.slice(0, 8).join(", ")}
                      {miss.rows.length > 8 ? ", …" : ""})
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result.unknownColumns.length > 0 && (
            <div className="rounded-xl border border-ink-300/40 bg-white p-5">
              <h3 className="text-sm font-medium text-ink-900">
                Columns this does not recognise, and will ignore
              </h3>
              <p className="mt-1 text-xs text-ink-500">
                Tell us what these are and they can be imported too.
              </p>
              <p className="mt-2 text-sm text-ink-700">{result.unknownColumns.join(", ")}</p>
            </div>
          )}

          {result.alreadyPresent.length > 0 && (
            <div className="rounded-xl border border-ink-300/40 bg-white p-5">
              <h3 className="text-sm font-medium text-ink-900">
                {result.alreadyPresent.length} already in the system — skipped, not an error
              </h3>
              <p className="mt-1 text-xs text-ink-500">
                So a file can be corrected and re-run without failing on the rows that already went
                in.
              </p>
              <p className="mt-2 text-xs text-ink-500">
                {result.alreadyPresent.slice(0, 10).join(" · ")}
                {result.alreadyPresent.length > 10 ? " …" : ""}
              </p>
            </div>
          )}

          {result.problems.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-ink-300/40 bg-white">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-ink-300/40 bg-surface text-xs uppercase tracking-wide text-ink-400">
                  <tr>
                    <th className="px-5 py-3 font-medium">Row</th>
                    <th className="px-5 py-3 font-medium">Column</th>
                    <th className="px-5 py-3 font-medium">What is wrong</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-300/20">
                  {result.problems.map((problem, i) => (
                    <tr key={i}>
                      <td className="px-5 py-2 tabular text-ink-500">{problem.row}</td>
                      <td className="px-5 py-2">{problem.column}</td>
                      <td className="px-5 py-2 text-ink-700">{problem.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <details className="rounded-xl border border-ink-300/40 bg-white p-5">
        <summary className="cursor-pointer text-sm font-medium text-ink-900">
          What columns the file should have
        </summary>
        <p className="mt-2 text-xs text-ink-500">
          Headers are matched loosely — &ldquo;Employee ID&rdquo;, &ldquo;employee_id&rdquo; and
          &ldquo;EMPLOYEE ID&rdquo; are all the same column.
        </p>
        <table className="mt-3 w-full text-left text-sm">
          <tbody className="divide-y divide-ink-300/20">
            {IMPORT_COLUMNS.map((column) => (
              <tr key={column.key}>
                <td className="py-2 pr-4 font-medium text-ink-900">{column.header}</td>
                <td className="py-2 pr-4">
                  {column.required ? <Badge tone="brand">Required</Badge> : <Badge>Optional</Badge>}
                </td>
                <td className="py-2 text-xs text-ink-500">{column.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
