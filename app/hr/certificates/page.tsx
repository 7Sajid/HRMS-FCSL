import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireCapability } from "@/lib/auth";
import { formatDate, todayInDhaka } from "@/lib/dates";
import { certificateStatus, expiringWithinMonths, urgencyRank } from "@/lib/certificate";
import { Card, EmptyState, PageHeader } from "@/components/ui/Card";
import { Badge, NoticeBox } from "@/components/ui/Feedback";
import { TableShell, Tbody, Td, Th, Thead, TableEmpty } from "@/components/ui/Table";

export const metadata = { title: "Associate certificates · FCSL HR" };

/** Rule 7. FCSL has fewer than 200 Associates; this is a guard, not a limit. */
const REGISTER_CAP = 1000;

/**
 * §6.8 — "Every Associate in the company on one screen, with issue date, expiry date,
 * and a status that colours itself: green for valid, amber inside four months,
 * red once expired. Sorted so the most urgent sits at the top."
 *
 * This single page is the answer to the first problem in §1: nobody knows when
 * a licence is about to expire.
 */
export default async function Page() {
  await requireCapability("certificates.manage");
  const today = todayInDhaka();

  const [certificates, rmsWithout, totalActive] = await Promise.all([
    prisma.rmCertificate.findMany({
      where: { status: "ACTIVE" },
      include: { employee: { include: { branch: true } } },
      // Rule 7. Ordered by expiry so the cap, if it is ever reached, keeps the
      // urgent end — which is the same end the JS sort below puts on top.
      orderBy: { expiryDate: "asc" },
      take: REGISTER_CAP,
    }),
    // An Associate with no certificate on file at all is the case the register would
    // otherwise never show, because it has no expiry date to sort by.
    prisma.employee.findMany({
      where: {
        staffType: "RM",
        status: "ACTIVE",
        onboardingStatus: "APPROVED",
        certificates: { none: { status: "ACTIVE" } },
      },
      include: { branch: true },
      orderBy: { fullName: "asc" },
      take: REGISTER_CAP,
    }),
    prisma.rmCertificate.count({ where: { status: "ACTIVE" } }),
  ]);

  const sorted = certificates.sort(
    (a, b) => urgencyRank(a.expiryDate, today) - urgencyRank(b.expiryDate, today),
  );

  const expired = sorted.filter((c) => c.expiryDate < today);
  const counts = {
    three: sorted.filter((c) => expiringWithinMonths(c.expiryDate, 3, today)).length,
    six: sorted.filter((c) => expiringWithinMonths(c.expiryDate, 6, today)).length,
    twelve: sorted.filter((c) => expiringWithinMonths(c.expiryDate, 12, today)).length,
  };

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <PageHeader
        title="Associate certificates"
        subtitle="Every Associate in the company, most urgent first. The system warns four months ahead — and never blocks anybody."
        actions={
          <a
            href="/api/export?type=certificates"
            className="rounded-lg border border-ink-300/60 bg-white px-4 py-2.5 text-sm font-medium hover:bg-surface"
          >
            Export
          </a>
        }
      />

      <section className="mb-6 grid gap-3 sm:grid-cols-4">
        <Stat label="Expired" value={expired.length} tone={expired.length ? "danger" : "neutral"} />
        <Stat label="Next 3 months" value={counts.three} tone={counts.three ? "warn" : "neutral"} />
        <Stat label="Next 6 months" value={counts.six} tone="neutral" />
        <Stat label="Next 12 months" value={counts.twelve} tone="neutral" />
      </section>

      {certificates.length < totalActive && (
        // Never silently. A register that quietly stops at a thousand is a
        // register that says the last Associate does not exist.
        <div className="mb-6">
          <NoticeBox tone="warn">
            Showing {certificates.length} of {totalActive} active certificates, most urgent first.
            Use Export for the whole register.
          </NoticeBox>
        </div>
      )}

      {rmsWithout.length > 0 && (
        <Card className="mb-6 border-warn-500/50 bg-warn-50/30 p-5">
          <h2 className="text-sm font-medium text-ink-900">
            {rmsWithout.length} Associate{rmsWithout.length === 1 ? " has" : "s have"} no certificate on file
          </h2>
          <p className="mt-1 text-xs text-ink-500">
            They cannot appear in the countdown below because there is no date to count to.
          </p>
          <ul className="mt-3 space-y-1 text-sm">
            {rmsWithout.map((rm) => (
              <li key={rm.id}>
                <Link href={`/hr/employees/${rm.id}`} className="text-brand-500 hover:underline">
                  {rm.fullName}
                </Link>
                <span className="ml-2 text-ink-500">
                  {rm.employeeId ?? "no ID"} · {rm.branch?.name ?? "no branch"}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <TableShell>
        <Thead>
          <tr>
            <Th>Employee ID</Th>
            <Th>Name</Th>
            <Th>Branch</Th>
            <Th>Certificate</Th>
            <Th>Issued</Th>
            <Th>Expires</Th>
            <Th>Status</Th>
          </tr>
        </Thead>
        <Tbody>
          {sorted.length === 0 && (
            <TableEmpty colSpan={7}>No Associate certificates are on the register yet.</TableEmpty>
          )}
          {sorted.map((certificate) => {
            const status = certificateStatus(certificate, today);
            return (
              <tr
                key={certificate.id}
                className={status.state === "EXPIRED" ? "bg-red-50/40" : status.state === "RENEWAL_DUE" ? "bg-warn-50/30" : ""}
              >
                <Td className="whitespace-nowrap tabular text-ink-500">
                  {certificate.employee.employeeId ?? "—"}
                </Td>
                <Td>
                  <Link
                    href={`/hr/employees/${certificate.employeeId}`}
                    className="text-brand-500 hover:underline"
                  >
                    {certificate.employee.fullName}
                  </Link>
                </Td>
                <Td>{certificate.employee.branch?.name ?? "—"}</Td>
                <Td className="text-ink-500">{certificate.certificateNumber}</Td>
                <Td className="whitespace-nowrap">{formatDate(certificate.issueDate)}</Td>
                <Td className="whitespace-nowrap">{formatDate(certificate.expiryDate)}</Td>
                <Td>
                  <Badge tone={status.tone}>{status.label}</Badge>
                  {status.daysRemaining !== null && status.state !== "EXPIRED" && (
                    <span className="ml-2 text-xs text-ink-500">{status.daysRemaining} days</span>
                  )}
                </Td>
              </tr>
            );
          })}
        </Tbody>
      </TableShell>

      {sorted.length > 0 && (
        <EmptyState>
          <span className="text-ink-500">
            An expired certificate stays at the top of this list until it is resolved. It never stops
            the person working — FCSL decided the system warns and nothing more.
          </span>
        </EmptyState>
      )}
    </main>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "danger" | "warn" | "neutral";
}) {
  const colour =
    tone === "danger" ? "text-red-600" : tone === "warn" ? "text-warn-500" : "text-ink-900";
  return (
    <Card className="p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-400">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular ${colour}`}>{value}</p>
    </Card>
  );
}
