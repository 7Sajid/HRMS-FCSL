"use client";

import { useState, useTransition } from "react";
import { reissuePassword } from "@/app/actions/hr-accounts";
import { Button } from "@/components/ui/Button";
import { ErrorBox, NoticeBox } from "@/components/ui/Feedback";

type Issued = { password: string; dictation: string; expiresAt: string; name: string };

/**
 * §4 — a fresh temporary password.
 *
 * The action has always existed and no screen called it, so the sentence on
 * the sign-in page — "Forgotten your password? Ask HR to issue a new one" —
 * and the one on the create-account screen — "if you lose it, issue a new one
 * from their file" — both pointed at something nobody could do. A temporary
 * password expires after seven days; without this, anybody who lost theirs was
 * locked out for good.
 *
 * Confirmed before it runs, because it ends every session that person has
 * open and makes the password they may be holding useless.
 */
export function ReissuePassword({
  employeeId,
  fullName,
}: {
  employeeId: string;
  fullName: string;
}) {
  const [pending, start] = useTransition();
  const [asking, setAsking] = useState(false);
  const [issued, setIssued] = useState<Issued | null>(null);
  const [error, setError] = useState("");

  if (issued) {
    return (
      <div className="rounded-xl border-2 border-brand-500 bg-brand-50/40 p-6">
        <p className="text-xs font-semibold tracking-widest text-ink-400">TEMPORARY PASSWORD</p>
        <p className="mt-2 select-all font-mono text-2xl font-bold tracking-wide text-ink-900">
          {issued.dictation}
        </p>
        <p className="mt-3 text-sm text-ink-700">
          {/* §4 step 2: handed over by a person, never emailed. */}
          <strong className="font-medium">
            Hand this over by phone or in person — never by email.
          </strong>{" "}
          The spaces are for reading it aloud and are not part of the password. It works once and
          expires on {issued.expiresAt}.
        </p>
        <p className="mt-2 text-sm text-warn-500">
          This is shown once. Anything {issued.name.split(" ")[0]} had open has been signed out.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {error && <ErrorBox>{error}</ErrorBox>}
      {asking ? (
        <NoticeBox tone="warn">
          <p>
            This gives {fullName} a new temporary password and{" "}
            <strong className="font-medium">signs them out everywhere</strong>. Any password they
            are holding stops working. It is shown to you once.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              variant="primary"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const result = await reissuePassword(employeeId);
                  if ("error" in result) setError(result.error);
                  else {
                    setError("");
                    setIssued({
                      password: result.password,
                      dictation: result.dictation,
                      expiresAt: result.expiresAt,
                      name: result.name,
                    });
                  }
                })
              }
            >
              {pending ? "Issuing…" : "Yes, issue a new one"}
            </Button>
            <Button variant="secondary" disabled={pending} onClick={() => setAsking(false)}>
              Cancel
            </Button>
          </div>
        </NoticeBox>
      ) : (
        <Button variant="secondary" onClick={() => setAsking(true)}>
          Issue a new temporary password
        </Button>
      )}
    </div>
  );
}
