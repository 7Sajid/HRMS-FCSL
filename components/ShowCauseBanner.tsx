import Link from "next/link";
import { prisma } from "@/lib/db";

/**
 * §6.5 — "a red banner across their panel that does not go away."
 *
 * There is deliberately no dismiss button. A show-cause carries a deadline of
 * three working days, and a banner somebody can click away is one they will
 * click away.
 */
export async function ShowCauseBanner({ employeeId }: { employeeId: string | null }) {
  if (!employeeId) return null;

  const open = await prisma.showCause.findFirst({
    where: { employeeId, closedAt: null },
    orderBy: { issuedAt: "desc" },
  });
  if (!open) return null;

  return (
    <Link
      href={`/me/compliance/${open.id}`}
      className="block bg-red-600 px-6 py-3 text-center text-sm font-medium text-white hover:bg-red-700"
    >
      You have a show-cause letter to answer — {open.subject}
      {open.repliedAt ? " · your reply has been sent" : " · you have not replied yet"}
    </Link>
  );
}
