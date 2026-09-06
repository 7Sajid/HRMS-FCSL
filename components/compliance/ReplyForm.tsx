"use client";

import { useActionState } from "react";
import { replyToShowCause } from "@/app/actions/compliance";
import { Button } from "@/components/ui/Button";
import { Field, Textarea } from "@/components/ui/Field";
import { ErrorBox, NoticeBox } from "@/components/ui/Feedback";

export function ReplyForm({ showCauseId }: { showCauseId: string }) {
  const [state, formAction, pending] = useActionState(
    replyToShowCause.bind(null, showCauseId),
    null,
  );

  return (
    <form action={formAction} className="space-y-4">
      <Field label="Your reply" htmlFor="replyBody" required>
        <Textarea
          id="replyBody"
          name="replyBody"
          rows={10}
          required
          minLength={20}
          placeholder="Your account of what happened, in your own words."
        />
      </Field>
      {state && "error" in state && <ErrorBox>{state.error}</ErrorBox>}
      <NoticeBox tone="brand">
        {/* §6.5: "The draft asks for the reply as a PDF; the system produces
            that PDF automatically from what they write, so nothing has to be
            typed in Word and scanned." */}
        You do not need to type this in Word and scan it. Write it here and the system produces the
        document, stored with the letter and the outcome in your file.
      </NoticeBox>
      <Button type="submit" disabled={pending}>
        {pending ? "Sending…" : "Send my reply"}
      </Button>
    </form>
  );
}
