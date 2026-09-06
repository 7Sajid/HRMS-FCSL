import { prisma } from "@/lib/db";
import { requireEmployee } from "@/lib/auth";
import { formatDateTime } from "@/lib/dates";
import { Card, PageHeader } from "@/components/ui/Card";
import { Badge, NoticeBox } from "@/components/ui/Feedback";
import { EmergencyContactForm } from "@/components/onboarding/EmergencyContactForm";

export const metadata = { title: "Emergency contacts · FCSL HR" };

/**
 * Page 3 (§5.1). The employee MAY edit this, and the change goes to HR as a
 * one-click approval with the previous version kept.
 *
 * The original draft had this page view-only in all five panels. Over three
 * years that fills with numbers that no longer connect — and it is the one
 * page that matters on the worst day of somebody's career.
 */
export default async function Page() {
  const { employee } = await requireEmployee();

  const contacts = await prisma.emergencyContact.findMany({
    where: { employeeId: employee.id },
    orderBy: [{ slot: "asc" }, { proposedAt: "desc" }],
  });

  const live = (slot: number) =>
    contacts.find((c) => c.slot === slot && c.status === "CURRENT") ?? null;
  const proposed = (slot: number) =>
    contacts.find((c) => c.slot === slot && c.status === "PENDING") ?? null;
  const history = contacts.filter((c) => c.status === "SUPERSEDED");

  const values = (slot: number) => {
    // The form shows the PROPOSAL when one is outstanding, because that is
    // what the person last typed and what they may want to amend. What is
    // still in force is printed beside it, so "the old details stay in use"
    // is something they can read rather than something they must trust.
    const row = proposed(slot) ?? live(slot);
    return row
      ? { name: row.name, relationship: row.relationship, mobile: row.mobile, address: row.address }
      : null;
  };

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <PageHeader
        title="Emergency contacts"
        subtitle="Who we call if something happens to you at work. Keep it current — you can change it yourself."
      />

      {[1, 2].map((slot) => {
        const pendingChange = proposed(slot);
        return (
          <Card key={slot} className="mb-4 p-6">
            <div className="mb-4 flex items-center justify-between">
              <p className="text-xs font-semibold tracking-widest text-ink-400">
                {slot === 1 ? "CONTACT 1 — REQUIRED" : "CONTACT 2 — OPTIONAL"}
              </p>
              {pendingChange && <Badge tone="warn">Waiting for HR</Badge>}
            </div>

            {pendingChange && (
              <div className="mb-4">
                <NoticeBox tone="warn">
                  <p>
                    Your change was sent to HR on {formatDateTime(pendingChange.proposedAt)}. The
                    details below are what HR will see.
                  </p>
                  {live(slot) && (
                    <p className="mt-2 text-ink-700">
                      <span className="font-medium">Still in use until they approve it:</span>{" "}
                      {live(slot)!.name} ({live(slot)!.relationship}) · {live(slot)!.mobile}
                    </p>
                  )}
                </NoticeBox>
              </div>
            )}

            <EmergencyContactForm
              slot={slot as 1 | 2}
              initial={values(slot)}
              pendingApproval={employee.onboardingStatus === "APPROVED"}
            />
          </Card>
        );
      })}

      {history.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-semibold text-ink-900">Earlier versions</h2>
          <p className="mb-3 mt-1 text-xs text-ink-500">
            The old number is never simply lost.
          </p>
          <Card className="divide-y divide-ink-300/20">
            {history.map((c) => (
              <div key={c.id} className="px-5 py-3 text-xs text-ink-500">
                Contact {c.slot} · {c.name} ({c.relationship}) · {c.mobile} · replaced{" "}
                {formatDateTime(c.approvedAt ?? c.proposedAt)}
              </div>
            ))}
          </Card>
        </section>
      )}
    </main>
  );
}
