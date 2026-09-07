import { prisma } from "@/lib/db";
import { currentIp, getSessionContext } from "@/lib/auth";
import { actorFrom, recordQuietly } from "@/lib/audit";
import { canReadDocumentsOf } from "@/lib/permissions";
import { getObject } from "@/lib/storage";
import { contentDisposition } from "@/lib/uploads";

/**
 * The only way a document is ever read.
 *
 * §6.1 promises files with no public web address, links that stop working, and
 * a record of every view — "who looked at whose NID, and when". All three are
 * here, and none of them are possible if a bucket serves files directly.
 *
 * It answers 404 rather than 403 when somebody may not read a document. A 403
 * confirms the document exists, and for a show-cause file or a colleague's NID
 * the existence is itself the thing worth hiding. A person who genuinely
 * cannot tell the two apart is a person who cannot enumerate staff files.
 */
export async function GET(request: Request): Promise<Response> {
  const context = await getSessionContext();
  if (!context) return new Response("Not found", { status: 404 });

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return new Response("Not found", { status: 404 });

  const document = await prisma.employeeDocument.findUnique({
    where: { id },
    include: { employee: { select: { id: true, fullName: true } } },
  });
  if (!document) return new Response("Not found", { status: 404 });

  if (!canReadDocumentsOf(context.viewer, document.employeeId, context.employeeId, document.kind)) {
    return new Response("Not found", { status: 404 });
  }

  if (document.purgedAt) {
    // §12.2: the file is gone one year after the last working day; the record
    // of it stays. Say so plainly rather than pretending it never existed.
    return new Response("This file was removed under the one-year retention rule.", { status: 410 });
  }

  const bytes = await getObject(document.storageKey);
  if (!bytes) return new Response("Not found", { status: 404 });

  // Recorded quietly: a log failure must not stop HR reading a document during
  // a review. The write is still attempted, and its failure is loud in the
  // server log.
  await recordQuietly({
    action: "document.viewed",
    actor: actorFrom({
      ...context.user,
      fullName: context.employee?.fullName ?? context.user.email,
    }),
    targetType: "employee",
    targetId: document.employeeId,
    targetLabel: document.employee.fullName,
    detail: { kind: document.kind, documentId: document.id, fileName: document.originalName },
    ip: await currentIp(),
  });

  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": document.mimeType,
      // inline so HR can read a scan beside the fields without downloading it.
      // The name goes through contentDisposition rather than straight into the
      // header: it is a database column, and a character outside Latin-1 in it
      // makes this route answer 500 with nothing to say why.
      "content-disposition": contentDisposition("inline", document.originalName),
      // Never cached by a proxy, and not left in a shared browser's cache for
      // the next person at that desk.
      "cache-control": "private, no-store, max-age=0",
      "x-content-type-options": "nosniff",
    },
  });
}
