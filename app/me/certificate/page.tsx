import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireEmployee } from "@/lib/auth";
import { formatDate } from "@/lib/dates";
import { certificateStatus } from "@/lib/certificate";
import { Card, EmptyState, PageHeader } from "@/components/ui/Card";
import { Badge, NoticeBox } from "@/components/ui/Feedback";
import { DataList, DataRow } from "@/components/ui/DataList";

export const metadata = { title: "My Associate certificate · FCSL HR" };

/**
 * §5.1, "What an Associate sees in addition" — a licence panel that counts down in
 * plain words.
 *
 * It never blocks anything. That is FCSL's decision and it is the reason this
 * page has no action on it: the system warns, HR renews, and the person keeps
 * working either way.
 */
export default async function Page() {
  const { employee } = await requireEmployee();
  // Not an Associate: nothing here belongs to them.
  if (employee.staffType !== "RM") redirect("/me/profile");

  const certificates = await prisma.rmCertificate.findMany({
    where: { employeeId: employee.id },
    orderBy: { expiryDate: "desc" },
  });

  const current = certificates.find((c) => c.status === "ACTIVE") ?? null;
  const status = certificateStatus(current);
  const history = certificates.filter((c) => c.id !== current?.id);

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <PageHeader
        title="My Associate certificate"
        subtitle="The BSEC licence that lets you deal with clients."
        actions={<Badge tone={status.tone}>{status.label}</Badge>}
      />

      {current ? (
        <>
          <div className="mb-6">
            <NoticeBox tone={status.tone === "neutral" ? "brand" : status.tone}>
              <p className="text-base font-medium">{status.sentence}</p>
              {status.state === "RENEWAL_DUE" && (
                <p className="mt-1">
                  HR, your manager and the HR Head were told on the same day. Renewal takes time —
                  the paperwork has to be prepared, signed, submitted and processed by the regulator.
                </p>
              )}
              {status.state === "EXPIRED" && (
                <p className="mt-1">
                  Your account and your work are not affected. This stays at the top of HR&rsquo;s
                  register until it is resolved.
                </p>
              )}
            </NoticeBox>
          </div>

          <Card className="p-6">
            <DataList>
              <DataRow label="Certificate number" value={current.certificateNumber} />
              <DataRow label="Status" value={status.label} />
              <DataRow label="Issued" value={formatDate(current.issueDate)} />
              <DataRow label="Expires" value={formatDate(current.expiryDate)} />
            </DataList>
          </Card>
        </>
      ) : (
        <EmptyState>
          No certificate is on file yet. Upload it on your documents page with its issue and expiry
          dates, and HR will add it to the register.
        </EmptyState>
      )}

      {history.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-semibold text-ink-900">Renewal history</h2>
          <p className="mb-3 mt-1 text-xs text-ink-500">Every certificate you have held.</p>
          <Card className="divide-y divide-ink-300/20">
            {history.map((certificate) => (
              <div key={certificate.id} className="flex items-center gap-3 px-5 py-3 text-sm">
                <span className="flex-1 text-ink-700">{certificate.certificateNumber}</span>
                <span className="text-xs text-ink-500">
                  {formatDate(certificate.issueDate)} – {formatDate(certificate.expiryDate)}
                </span>
                <Badge tone="neutral">
                  {certificate.status === "SURRENDERED" ? "Surrendered" : "Replaced"}
                </Badge>
              </div>
            ))}
          </Card>
        </section>
      )}
    </main>
  );
}
