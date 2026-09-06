import type { ReactNode } from "react";
import { requireOpenPanel } from "@/lib/auth";
import { navFor } from "@/components/nav-items";
import { unreadBadge } from "@/lib/notifications";
import { AppShell } from "@/components/AppShell";

/**
 * The locked door plus the chrome, in one place.
 *
 * Every route branch behind the door uses this, so a page added later cannot
 * forget the guard — a layout redirect happens before the page renders, so
 * there is no window in which a Stage 1 account sees anything.
 */
export async function PanelLayout({ children }: { children: ReactNode }) {
  const context = await requireOpenPanel();
  const sections = navFor(context.viewer, { isRm: context.employee?.staffType === "RM" });
  const unread = await unreadBadge(context.user.id);

  return (
    <AppShell
      sections={sections}
      unread={unread}
      person={{
        name: context.employee?.fullName ?? context.user.email,
        role: context.user.role,
        employeeId: context.employee?.employeeId ?? null,
      }}
    >
      {children}
    </AppShell>
  );
}
