import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireEmployee } from "@/lib/auth";
import { formatDateTime } from "@/lib/dates";
import { outcomeLabel, outcomeTone } from "@/lib/showcause";
import { Card, PageHeader } from "@/components/ui/Card";
import { Badge, NoticeBox } from "@/components/ui/Feedback";
import { ReplyForm } from "@/components/compliance/ReplyForm";

type Props = { params: Promise<{ id: string }> };

/** The employee's own view of a show-cause issued to them (§6.5). */
export default async function Page({ params }: Props) {
  const { employee } = await requireEmployee();
  const { id } = await params;

  const showCause = await prisma.showCause.findFirst({
    // Scoped in the query: somebody else's letter simply does not match.
    where: { id, employeeId: employee.id },
  });
  if (!showCause) notFound();

  // Opening it is the receipt. §6.5: timestamped delivery and receipt protect
  // the employee and the company equally.
  if (!showCause.acknowledgedAt) {
    await prisma.showCause.update({ where: { id }, data: { acknowledgedAt: new Date() } });
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <PageHeader
        eyebrow="SHOW-CAUSE"
        title={showCause.subject}
        subtitle={`Issued by ${showCause.issuedByName} on ${formatDateTime(showCause.issuedAt)}`}
        actions={
          showCause.closedAt ? (
            <Badge tone={outcomeTone(showCause.outcome)}>{outcomeLabel(showCause.outcome)}</Badge>
          ) : (
            <Badge tone="danger">Open</Badge>
          )
        }
      />

      <Card className="mb-6 p-6">
        <p className="whitespace-pre-wrap text-sm text-ink-900">{showCause.body}</p>
      </Card>

      {showCause.repliedAt ? (
        <Card className="p-6">
          <h2 className="mb-1 text-xs font-semibold tracking-widest text-ink-400">YOUR REPLY</h2>
          <p className="mb-4 text-xs text-ink-500">Sent {formatDateTime(showCause.repliedAt)}</p>
          <p className="whitespace-pre-wrap text-sm text-ink-900">{showCause.replyBody}</p>
        </Card>
      ) : showCause.closedAt ? null : (
        <Card className="p-6">
          <h2 className="mb-4 text-sm font-semibold text-ink-900">Your reply</h2>
          <ReplyForm showCauseId={showCause.id} />
        </Card>
      )}

      {showCause.closedAt && (
        <div className="mt-6">
          <NoticeBox tone={outcomeTone(showCause.outcome)}>
            <p className="font-medium">
              {outcomeLabel(showCause.outcome)} — {formatDateTime(showCause.closedAt)}
            </p>
            {showCause.outcomeNote && <p className="mt-1">{showCause.outcomeNote}</p>}
          </NoticeBox>
        </div>
      )}

      <p className="mt-6 text-xs text-ink-400">
        {/* Said plainly, because the employee will wonder. */}
        This is visible to you and to the HR Head, and to nobody else
        {showCause.visibleToManager ? " except your manager, whom the HR Head included" : ""}. Every
        time it is opened, the system records who opened it.
      </p>
    </main>
  );
}
