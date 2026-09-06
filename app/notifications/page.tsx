import { requireOpenPanel } from "@/lib/auth";
import { markAllRead } from "@/lib/notifications";
import { prisma } from "@/lib/db";
import { formatDateTime } from "@/lib/dates";
import { Card, EmptyState, PageHeader } from "@/components/ui/Card";
import Link from "next/link";

export const metadata = { title: "Notifications · FCSL HR" };

export default async function Page() {
  const context = await requireOpenPanel();

  const notifications = await prisma.notification.findMany({
    where: { userId: context.user.id },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  // Marked read on view, after the read, so the page still shows which ones
  // were new when it was opened.
  await markAllRead(context.user.id);

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <PageHeader title="Notifications" subtitle="The complete list. Email carries only the urgent ones." />
      {notifications.length === 0 ? (
        <EmptyState>Nothing yet. This is where the system tells you what has happened.</EmptyState>
      ) : (
        <Card className="divide-y divide-ink-300/20">
          {notifications.map((n) => {
            const row = (
              <div className={`px-5 py-4 ${n.readAt ? "" : "bg-brand-50/40"}`}>
                <p className="text-sm font-medium text-ink-900">{n.title}</p>
                {n.body && <p className="mt-0.5 text-sm text-ink-500">{n.body}</p>}
                <p className="mt-1 text-xs text-ink-400">{formatDateTime(n.createdAt)}</p>
              </div>
            );
            return n.link ? (
              <Link key={n.id} href={n.link} className="block hover:bg-surface">
                {row}
              </Link>
            ) : (
              <div key={n.id}>{row}</div>
            );
          })}
        </Card>
      )}
    </main>
  );
}
