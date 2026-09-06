import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { homePathFor } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { loadOnboardingState } from "@/lib/onboarding";
import { formatDateTime } from "@/lib/dates";
import { Card, PageHeader } from "@/components/ui/Card";
import { NoticeBox } from "@/components/ui/Feedback";
import { signOut } from "@/app/actions/auth";
import { UploadBox } from "@/components/onboarding/UploadBox";
import { BankDetailsForm } from "@/components/onboarding/BankDetailsForm";
import { EmergencyContactForm } from "@/components/onboarding/EmergencyContactForm";
import { SubmitForReview } from "@/components/onboarding/SubmitForReview";

export const metadata = { title: "Upload my documents · FCSL HR" };

/**
 * Stage 1 — the locked door (§3, §4 step 3).
 *
 * One screen, one job. Deliberately outside the panel shell: there is no
 * navigation here because there is nowhere else to go, and a sidebar full of
 * greyed-out links would only invite people to try them.
 */
export default async function OnboardingPage() {
  const context = await requireUser();
  if (context.user.mustChangePassword) redirect("/set-password");
  if (!context.employee) redirect(homePathFor(context.viewer));
  const employee = context.employee;
  if (employee.onboardingStatus === "APPROVED") redirect(homePathFor(context.viewer));

  const [state, bank, contacts] = await Promise.all([
    loadOnboardingState(employee),
    prisma.employeeBankDetail.findUnique({ where: { employeeId: employee.id } }),
    prisma.emergencyContact.findMany({
      where: { employeeId: employee.id, status: { in: ["CURRENT", "PENDING"] } },
    }),
  ]);

  const waiting = employee.onboardingStatus === "SUBMITTED";
  const sentBack = employee.onboardingStatus === "SENT_BACK";
  const contact = (slot: number) => {
    const found = contacts.find((c) => c.slot === slot);
    return found
      ? {
          name: found.name,
          relationship: found.relationship,
          mobile: found.mobile,
          address: found.address,
        }
      : null;
  };

  return (
    <div className="min-h-screen">
      <header className="border-b border-ink-300/40 bg-white">
        <div className="mx-auto flex h-16 max-w-3xl items-center px-6">
          <span className="text-sm font-bold tracking-tight text-brand-500">FCSL</span>
          <span className="ml-2 text-sm text-ink-500">HR</span>
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-sm text-ink-500 sm:inline">{employee.fullName}</span>
            <form action={signOut}>
              <button
                type="submit"
                className="rounded-lg px-3 py-2 text-sm font-medium text-ink-500 hover:bg-red-50 hover:text-red-600"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-10">
        <PageHeader
          eyebrow="STAGE 1"
          title="Upload my documents"
          subtitle="This is the only thing you can do until HR has checked your file. Everything else opens the moment they approve it."
        />

        {waiting && (
          <div className="mb-6">
            <NoticeBox tone="success">
              <strong className="font-medium">Sent to HR.</strong> Your file was submitted
              {employee.submittedAt ? ` on ${formatDateTime(employee.submittedAt)}` : ""}. You will get
              an email when it has been checked. You can still add anything optional below.
            </NoticeBox>
          </div>
        )}

        {sentBack && (
          <div className="mb-6">
            <NoticeBox tone="warn">
              <strong className="font-medium">HR sent your file back.</strong>{" "}
              {employee.sendBackReason || "Please look at the items marked in red below."} Only those
              need re-doing — everything already accepted stays accepted.
            </NoticeBox>
          </div>
        )}

        {/* The progress line §4 asks for, in the words it asks for them. */}
        <div className="mb-6">
          <div className="flex items-baseline justify-between">
            <p className="text-sm font-medium text-ink-700">{state.progress.label}</p>
            <p className="text-xs text-ink-400">
              {state.progress.complete ? "All required items in" : "Required items are marked *"}
            </p>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-ink-300/30">
            <div
              className={`h-full transition-all ${state.progress.complete ? "bg-success-500" : "bg-brand-500"}`}
              style={{
                width: `${state.progress.total ? (state.progress.done / state.progress.total) * 100 : 0}%`,
              }}
            />
          </div>
        </div>

        <div className="space-y-3">
          {state.boxes
            .filter((box) => !box.spec.isForm)
            .map((box) => (
              <UploadBox
                key={box.spec.kind}
                kind={box.spec.kind}
                label={box.spec.label}
                note={box.spec.note}
                accepts={[...box.spec.accepts]}
                required={box.required}
                multiple={box.spec.multiple}
                satisfied={box.satisfied}
                locked={box.locked}
                rejectionReason={box.rejectionReason}
                capturesDates={Boolean(box.spec.capturesDates)}
                documents={box.documents.map((d) => ({
                  id: d.id,
                  originalName: d.originalName,
                  size: d.size,
                  status: d.status,
                }))}
              />
            ))}
        </div>

        <section className="mt-8">
          <h2 className="mb-1 text-sm font-semibold text-ink-900">
            Bank details <span className="text-brand-500">*</span>
          </h2>
          <p className="mb-3 text-xs text-ink-500">
            Where your salary is paid. Only HR can see these.
          </p>
          <Card className="p-5">
            <BankDetailsForm initial={bank} />
          </Card>
        </section>

        <section className="mt-8">
          <h2 className="mb-1 text-sm font-semibold text-ink-900">
            Emergency contacts <span className="text-brand-500">*</span>
          </h2>
          <p className="mb-3 text-xs text-ink-500">
            One is required. This is the page that matters on the worst day of a career, so keep it
            current — you can change it yourself later.
          </p>
          <Card className="p-5">
            <p className="mb-3 text-xs font-semibold tracking-widest text-ink-400">CONTACT 1</p>
            <EmergencyContactForm slot={1} initial={contact(1)} />
          </Card>
          <Card className="mt-3 p-5">
            <p className="mb-3 text-xs font-semibold tracking-widest text-ink-400">
              CONTACT 2 — OPTIONAL
            </p>
            <EmergencyContactForm slot={2} initial={contact(2)} />
          </Card>
        </section>

        {!waiting && (
          <section className="mt-8 border-t border-ink-300/40 pt-6">
            <SubmitForReview canSubmit={state.canSubmit} missing={state.missing} />
          </section>
        )}
      </main>
    </div>
  );
}
