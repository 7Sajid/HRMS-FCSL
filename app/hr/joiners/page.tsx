import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireCapability } from "@/lib/auth";
import { formatDateTime, todayInDhaka, workingDaysSince } from "@/lib/dates";
import { loadOnboardingState } from "@/lib/onboarding";
import { Card, EmptyState, PageHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Feedback";
import { ButtonLink } from "@/components/ui/Button";

export const metadata = { title: "Joiners · FCSL HR" };

/**
 * §4 step 5 and §3 — the queue of people waiting behind the locked door.
 *
 * Sorted by how long each has waited and amber past two working days. §3 is
 * blunt about why: "A new joiner cannot use the system on day one... If HR is
 * slow, the person sits blocked." Making the wait visible is the whole
 * mitigation for that cost.
 */
export default async function Page() {
  await requireCapability("documents.approve");
  const today = todayInDhaka();

  const waiting = await prisma.employee.findMany({
    where: { onboardingStatus: { in: ["SUBMITTED", "SENT_BACK", "DRAFT"] } },
    include: { user: { select: { email: true, role: true, tempPasswordExpiresAt: true } } },
    orderBy: [{ submittedAt: "asc" }, { createdAt: "asc" }],
  });

  const submitted = waiting.filter((w) => w.onboardingStatus === "SUBMITTED");
  const sentBack = waiting.filter((w) => w.onboardingStatus === "SENT_BACK");
  const notStarted = waiting.filter((w) => w.onboardingStatus === "DRAFT");

  const progress = new Map<string, string>();
  for (const person of notStarted) {
    const state = await loadOnboardingState(person);
    progress.set(person.id, state.progress.label);
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <PageHeader
        title="Joiners"
        subtitle="People waiting to get through the locked door. Their panel opens when you approve them."
        actions={<ButtonLink href="/hr/accounts/new" variant="primary">Create an account</ButtonLink>}
      />

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold text-ink-900">
          Waiting for review{submitted.length ? ` (${submitted.length})` : ""}
        </h2>
        {submitted.length === 0 ? (
          <EmptyState>Nobody is waiting. Every file that has been submitted is dealt with.</EmptyState>
        ) : (
          <div className="space-y-3">
            {submitted.map((person) => {
              const waited = person.submittedAt
                ? workingDaysSince(person.submittedAt, new Set(), [5, 6], today)
                : 0;
              // §8: a reminder after two working days.
              const overdue = waited >= 2;
              return (
                <Card
                  key={person.id}
                  className={`flex flex-wrap items-center gap-4 p-5 ${overdue ? "border-warn-500/50 bg-warn-50/30" : ""}`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium text-ink-900">{person.fullName}</p>
                      <Badge tone={person.staffType === "RM" ? "brand" : "neutral"}>
                        {person.staffType === "RM" ? "RM" : "Staff"}
                      </Badge>
                      {overdue && (
                        <Badge tone="warn">
                          Waiting {waited} working day{waited === 1 ? "" : "s"}
                        </Badge>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-ink-500">
                      {person.user.email} · submitted {formatDateTime(person.submittedAt)}
                    </p>
                  </div>
                  <ButtonLink href={`/hr/joiners/${person.id}`} variant="primary">
                    Review
                  </ButtonLink>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {sentBack.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-sm font-semibold text-ink-900">Sent back, waiting on them</h2>
          <div className="space-y-3">
            {sentBack.map((person) => (
              <Card key={person.id} className="flex flex-wrap items-center gap-4 p-5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ink-900">{person.fullName}</p>
                  <p className="mt-0.5 text-xs text-ink-500">{person.sendBackReason}</p>
                </div>
                <ButtonLink href={`/hr/joiners/${person.id}`}>Open</ButtonLink>
              </Card>
            ))}
          </div>
        </section>
      )}

      {notStarted.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold text-ink-900">
            Accounts created, nothing uploaded yet
          </h2>
          <p className="mb-3 text-xs text-ink-500">
            {/* §4: after thirty days with nothing uploaded, chase them or
                deactivate the account. */}
            An account that sits here for ever is one nobody is watching. After a month, chase them
            or deactivate it.
          </p>
          <div className="space-y-3">
            {notStarted.map((person) => {
              const stale = workingDaysSince(person.createdAt, new Set(), [5, 6], today) >= 20;
              const expired =
                person.user.tempPasswordExpiresAt && person.user.tempPasswordExpiresAt < new Date();
              return (
                <Card key={person.id} className="flex flex-wrap items-center gap-4 p-5">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium text-ink-900">{person.fullName}</p>
                      {stale && <Badge tone="warn">Nothing for a month</Badge>}
                      {expired && <Badge tone="danger">Password expired</Badge>}
                    </div>
                    <p className="mt-0.5 text-xs text-ink-500">
                      {person.user.email} · {progress.get(person.id)}
                    </p>
                  </div>
                  <Link
                    href={`/hr/joiners/${person.id}`}
                    className="rounded-lg border border-ink-300/60 bg-white px-4 py-2.5 text-sm font-medium hover:bg-surface"
                  >
                    Open
                  </Link>
                </Card>
              );
            })}
          </div>
        </section>
      )}
    </main>
  );
}
