"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Role } from "@prisma/client";
import { changeRole, disableAccount, enableAccount } from "@/app/actions/admin-accounts";
import { Button } from "@/components/ui/Button";
import { Select, Textarea } from "@/components/ui/Field";
import { ErrorBox } from "@/components/ui/Feedback";

const ROLES: { value: Role; label: string }[] = [
  { value: "EMPLOYEE", label: "Executive" },
  { value: "MANAGER", label: "Manager" },
  { value: "HR_EXECUTIVE", label: "HR Executive" },
  { value: "HR_HEAD", label: "HR Head" },
  { value: "SUPER_ADMIN", label: "Super Admin" },
];

/**
 * Every one of these asks for a reason before it will do anything.
 *
 * Not friction for its own sake: the reason is the only part of the row that
 * is still useful in two years, when somebody asks why a former branch
 * manager's account was turned off in September and the audit line is the only
 * person left who remembers.
 */
export function AccountControls({
  userId,
  disabled,
  role,
  isSelf,
}: {
  userId: string;
  disabled: boolean;
  role: Role;
  isSelf: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<"none" | "access" | "role">("none");
  const [reason, setReason] = useState("");
  const [nextRole, setNextRole] = useState<Role>(role);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  const run = (fn: () => Promise<{ ok: true } | { error: string }>) =>
    start(async () => {
      setError("");
      const result = await fn();
      if ("error" in result) setError(result.error);
      else {
        setOpen("none");
        setReason("");
        router.refresh();
      }
    });

  if (open === "none") {
    return (
      <div className="flex flex-wrap items-center gap-2">
        {error && <ErrorBox>{error}</ErrorBox>}
        {/* Not disabled for yourself. Handing over to another Super Admin and
            stepping down is a legitimate thing to do, and the server already
            refuses it when you are the last one — which is the real rule.
            A button greyed out for a reason the server does not share is a
            button that will be re-enabled by somebody who reads the code. */}
        <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => setOpen("role")}>
          Change role
        </Button>
        <Button
          variant={disabled ? "secondary" : "danger"}
          className="px-3 py-1.5 text-xs"
          onClick={() => setOpen("access")}
          disabled={isSelf && !disabled}
          title={isSelf && !disabled ? "You cannot disable your own account." : undefined}
        >
          {disabled ? "Re-enable" : "Disable"}
        </Button>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md space-y-2">
      {open === "role" && (
        <Select value={nextRole} onChange={(e) => setNextRole(e.target.value as Role)}>
          {ROLES.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </Select>
      )}

      <Textarea
        rows={2}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder={
          open === "role"
            ? "Why is their access changing? This is kept for ever."
            : disabled
              ? "Why is this account coming back?"
              : "Why is this account being turned off?"
        }
        autoFocus
      />
      {error && <ErrorBox>{error}</ErrorBox>}

      <div className="flex gap-2">
        <Button
          variant={open === "access" && !disabled ? "danger" : "primary"}
          className="px-3 py-1.5 text-xs"
          disabled={pending || reason.trim().length < 5 || (open === "role" && nextRole === role)}
          onClick={() =>
            run(() =>
              open === "role"
                ? changeRole(userId, nextRole, reason)
                : disabled
                  ? enableAccount(userId, reason)
                  : disableAccount(userId, reason),
            )
          }
        >
          {pending ? "…" : open === "role" ? "Change it" : disabled ? "Re-enable" : "Disable"}
        </Button>
        <Button
          variant="ghost"
          className="px-3 py-1.5 text-xs"
          disabled={pending}
          onClick={() => {
            setOpen("none");
            setReason("");
            setError("");
          }}
        >
          Cancel
        </Button>
      </div>

      <p className="text-xs text-ink-400">
        {open === "role"
          ? "They are signed out, so their next page is built for what they are now."
          : disabled
            ? "They can sign in again straight away."
            : "Every open session ends immediately. Nothing is deleted — their record stays whole."}
      </p>
    </div>
  );
}
