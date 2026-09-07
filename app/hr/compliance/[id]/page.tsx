import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireCapability } from "@/lib/auth";
import { formatDateTime } from "@/lib/dates";
import { outcomeLabel, outcomeTone } from "@/lib/showcause";
import { noteShowCauseView } from "@/app/actions/compliance";
import { Card, PageHeader } from "@/components/ui/Card";
import { Badge, NoticeBox } from "@/components/ui/Feedback";
import { CloseShowCauseForm } from "@/components/compliance/CloseForm";

type Props = { params: Promise<{ id: string }> };

export default async function Page({ params }: Props) {
  await requireCapability("showcause.issue");
  const { id } = await params;

  const showCause = await prisma.showCause.findUnique({
    where: { id },
    include: { employee: { select: { id: true, fullName: true, employeeId: true } } },
  });
  if (!showCause) notFound();

  // §6.5: every opening is recorded, including this one.
  await noteShowCauseView(id);

  const views = await prisma.auditEvent.findMany({
    where: { action: "showcause.viewed", targetId: showCause.employeeId },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <PageHeader
        eyebrow={showCause.employee.employeeId ?? undefined}
        title={showCause.employee.fullName}
        subtitle={showCause.subject}
        actions={
          <div className="flex items-center gap-2">
            <Badge tone={outcomeTone(showCause.outcome)}>{outcomeLabel(showCause.outcome)}</Badge>
            <Link
              href="/hr/compliance"
              className="rounded-lg border border-ink-300/60 bg-white px-4 py-2.5 text-sm font-medium hover:bg-surface"
            >
              Back
            </Link>
          </div>
        }
      />

      <Card className="mb-4 p-6">
        <h2 className="mb-1 text-xs font-semibold tracking-widest text-ink-400">THE LETTER</h2>
        <p className="mb-4 text-xs text-ink-500">
          Issued by {showCause.issuedByName} on {formatDateTime(showCause.issuedAt)}
          {showCause.acknowledgedAt ? ` · opened by them ${formatDateTime(showCause.acknowledgedAt)}` : " · not yet opened by them"}
        </p>
        <p className="whitespace-pre-wrap text-sm text-ink-900">{showCause.body}</p>
      </Card>

      <Card className="mb-4 p-6">
        <h2 className="mb-1 text-xs font-semibold tracking-widest text-ink-400">THEIR REPLY</h2>
        {showCause.repliedAt ? (
          <>
            <p className="mb-4 text-xs text-ink-500">Sent {formatDateTime(showCause.repliedAt)}</p>
            <p className="whitespace-pre-wrap text-sm text-ink-900">{showCause.replyBody}</p>
            {showCause.replyDocumentId && (
              // §6.5's PDF. Served through app/api/download like every other
              // file, so opening it is permission-checked and recorded.
              <a
                href={`/api/download?id=${showCause.replyDocumentId}`}
                target="_blank"
                rel="noopener"
                className="mt-4 inline-block text-sm text-brand-500 hover:underline"
              >
                Open the PDF of this reply
              </a>
            )}
          </>
        ) : (
          <p className="text-sm text-ink-400">They have not replied yet.</p>
        )}
      </Card>

      {showCause.closedAt ? (
        <NoticeBox tone={outcomeTone(showCause.outcome)}>
          <p className="font-medium">
            {outcomeLabel(showCause.outcome)} — {showCause.closedByName},{" "}
            {formatDateTime(showCause.closedAt)}
          </p>
          {showCause.outcomeNote && <p className="mt-1">{showCause.outcomeNote}</p>}
        </NoticeBox>
      ) : (
        <Card className="p-6">
          <h2 className="mb-3 text-xs font-semibold tracking-widest text-ink-400">
            RECORD THE OUTCOME
          </h2>
          <CloseShowCauseForm id={showCause.id} hasReplied={Boolean(showCause.repliedAt)} />
        </Card>
      )}

      <section className="mt-8">
        <h2 className="mb-1 text-sm font-semibold text-ink-900">Who has opened this file</h2>
        <p className="mb-3 text-xs text-ink-500">
          Every reading is recorded, including this one. That is the point of the section.
        </p>
        <Card className="divide-y divide-ink-300/20">
          {views.map((view) => (
            <p key={view.id} className="px-5 py-2 text-xs text-ink-500">
              {view.actorName} ({view.actorRole}) · {formatDateTime(view.createdAt)}
            </p>
          ))}
        </Card>
      </section>
    </main>
  );
}
