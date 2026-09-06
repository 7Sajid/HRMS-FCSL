import { prisma } from "@/lib/db";
import { requireEmployee } from "@/lib/auth";
import { formatDate } from "@/lib/dates";
import { documentLabel, laterUploadKinds } from "@/lib/documents";
import { formatBytes } from "@/lib/uploads";
import { Card, EmptyState, PageHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Feedback";
import { UploadBox } from "@/components/onboarding/UploadBox";

export const metadata = { title: "My documents · FCSL HR" };

/**
 * Page 2 (§5.1). "Every file uploaded, with the date and whether HR accepted
 * it... an employee can add a training certificate, a confirmation letter or
 * clearance documents at any time, but cannot replace or delete a document HR
 * has already accepted. Each new upload goes to HR as a small approval of its
 * own."
 */
export default async function Page() {
  const { employee } = await requireEmployee();

  const documents = await prisma.employeeDocument.findMany({
    where: { employeeId: employee.id },
    orderBy: [{ uploadedAt: "desc" }],
  });

  const current = documents.filter((d) => !d.supersededAt);
  const replaced = documents.filter((d) => d.supersededAt);
  const acceptedKinds = new Set(
    current.filter((d) => d.status === "ACCEPTED").map((d) => d.kind),
  );
  // Anything not rejected counts as on file — a document sitting with HR is
  // not something to ask for again.
  const onFile = new Set(current.filter((d) => d.status !== "REJECTED").map((d) => d.kind));

  const addable = laterUploadKinds(employee.staffType, onFile);

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <PageHeader
        title="My documents"
        subtitle="Everything on your file, and what HR has done with it."
      />

      {current.length === 0 ? (
        <EmptyState>Nothing on file yet.</EmptyState>
      ) : (
        <Card className="divide-y divide-ink-300/20">
          {current.map((doc) => (
            <div key={doc.id} className="flex flex-wrap items-center gap-3 px-5 py-4">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink-900">{documentLabel(doc.kind)}</p>
                <p className="mt-0.5 truncate text-xs text-ink-500">
                  {doc.originalName} · {formatBytes(doc.size)} · uploaded {formatDate(doc.uploadedAt)}
                </p>
                {doc.status === "REJECTED" && doc.rejectionReason && (
                  <p className="mt-1 text-xs text-red-600">HR sent this back: {doc.rejectionReason}</p>
                )}
                {doc.expiryDate && (
                  <p className="mt-1 text-xs text-ink-500">
                    Issued {formatDate(doc.issueDate)} · expires {formatDate(doc.expiryDate)}
                  </p>
                )}
              </div>
              {doc.status === "ACCEPTED" && <Badge tone="success">Accepted</Badge>}
              {doc.status === "PENDING" && <Badge tone="warn">With HR</Badge>}
              {doc.status === "REJECTED" && <Badge tone="danger">Sent back</Badge>}
              {!doc.purgedAt ? (
                <a
                  href={`/api/download?id=${doc.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-lg border border-ink-300/60 bg-white px-3 py-1.5 text-xs font-medium hover:bg-surface"
                >
                  Open
                </a>
              ) : (
                <span className="text-xs text-ink-400">Removed</span>
              )}
            </div>
          ))}
        </Card>
      )}

      <section className="mt-10">
        <h2 className="text-sm font-semibold text-ink-900">Add something</h2>
        <p className="mb-4 mt-1 text-xs text-ink-500">
          A training certificate, your confirmation letter when probation ends, or clearance
          documents whenever they arrive. Each one goes to HR to check.
        </p>
        <div className="space-y-3">
          {addable.map((spec) => (
            <UploadBox
              key={spec.kind}
              kind={spec.kind}
              label={spec.label}
              note={spec.note}
              accepts={[...spec.accepts]}
              required={false}
              multiple={spec.multiple}
              satisfied={false}
              locked={acceptedKinds.has(spec.kind) && !spec.multiple}
              rejectionReason=""
              capturesDates={Boolean(spec.capturesDates)}
              documents={[]}
            />
          ))}
        </div>
      </section>

      {replaced.length > 0 && (
        <section className="mt-10">
          <h2 className="text-sm font-semibold text-ink-900">Replaced earlier versions</h2>
          <p className="mb-4 mt-1 text-xs text-ink-500">
            Nothing is ever deleted. An older version stays here, marked replaced.
          </p>
          <Card className="divide-y divide-ink-300/20">
            {replaced.map((doc) => (
              <div key={doc.id} className="flex items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs text-ink-500">
                    {documentLabel(doc.kind)} · {doc.originalName} · uploaded{" "}
                    {formatDate(doc.uploadedAt)}
                  </p>
                </div>
                <Badge tone="neutral">Replaced</Badge>
              </div>
            ))}
          </Card>
        </section>
      )}
    </main>
  );
}
