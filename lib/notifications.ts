import { prisma } from "./db";

/**
 * The bell (§8). Two channels: this, which is the complete list, and email,
 * which carries only what should interrupt somebody's day.
 */

const UNREAD_CAP = 99;

/**
 * A pre-formatted string — "7", "99+", or "" for none.
 *
 * Deliberately not `count(*)`: an unread count is rendered in the chrome of
 * every page, and counting four hundred people's notifications to print "99+"
 * is work nobody sees. `take: cap + 1` answers the same question.
 */
export async function unreadBadge(userId: string): Promise<string> {
  const rows = await prisma.notification.findMany({
    where: { userId, readAt: null },
    select: { id: true },
    take: UNREAD_CAP + 1,
  });
  if (rows.length === 0) return "";
  return rows.length > UNREAD_CAP ? `${UNREAD_CAP}+` : String(rows.length);
}

export type NotifyInput = {
  userId: string;
  title: string;
  body?: string;
  /** A path back into the system. Never a value, only a pointer. */
  link?: string;
};

/**
 * Written inside the same transaction as the action it reports, so a person is
 * never told about something that did not happen — and never left untold about
 * something that did.
 *
 * §8: notifications say what happened and carry a link back into the system.
 * They never carry an NID, bank details or a document, because an inbox is not
 * a place personal information should travel to.
 */
export async function notify(
  input: NotifyInput | NotifyInput[],
  tx?: { notification: { createMany: (args: { data: unknown[] }) => Promise<unknown> } },
): Promise<void> {
  const rows = (Array.isArray(input) ? input : [input]).map((n) => ({
    userId: n.userId,
    title: n.title,
    body: n.body ?? "",
    link: n.link ?? "",
  }));
  if (!rows.length) return;
  const client = tx ?? prisma;
  await client.notification.createMany({ data: rows });
}

export async function markAllRead(userId: string): Promise<void> {
  await prisma.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  });
}
