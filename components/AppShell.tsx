import Link from "next/link";
import type { ReactNode } from "react";
import { signOut } from "@/app/actions/auth";
import { ROLE_LABELS } from "@/lib/permissions";
import type { NavSection } from "./nav-items";
import { NavList } from "./NavList";
import { MobileNav } from "./MobileNav";
import { IconBell } from "./icons";

/**
 * One shell for the whole system.
 *
 * §2 is explicit: "Everyone opens the same website... Everyone uses the same
 * website, but each panel shows only what that job allows." So the navigation
 * is computed from capabilities and rendered once, rather than five shells
 * that drift apart.
 */
export function AppShell({
  sections,
  person,
  unread,
  children,
}: {
  sections: NavSection[];
  person: { name: string; role: keyof typeof ROLE_LABELS; employeeId: string | null };
  unread: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-ink-300/40 bg-white">
        <div className="mx-auto flex h-16 max-w-[90rem] items-center gap-4 px-4 sm:px-6">
          <MobileNav sections={sections} />

          <Link href="/" className="flex items-baseline gap-2">
            <span className="text-sm font-bold tracking-tight text-brand-500">FCSL</span>
            <span className="text-sm text-ink-500">HR</span>
          </Link>

          <div className="ml-auto flex items-center gap-1 sm:gap-3">
            <Link
              href="/notifications"
              aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
              className="relative -m-3 p-3 text-ink-500 hover:text-ink-900"
            >
              <IconBell />
              {unread && (
                <span className="absolute right-1.5 top-1.5 min-w-[18px] rounded-full bg-brand-500 px-1 text-center text-[10px] font-semibold leading-[18px] text-white">
                  {unread}
                </span>
              )}
            </Link>

            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium leading-tight text-ink-900">{person.name}</p>
              <p className="text-xs leading-tight text-ink-500">
                {ROLE_LABELS[person.role]}
                {person.employeeId ? ` · ${person.employeeId}` : ""}
              </p>
            </div>

            <form action={signOut}>
              <button
                type="submit"
                className="rounded-lg px-3 py-2 text-sm font-medium text-ink-500 hover:bg-red-50 hover:text-red-600"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-[90rem]">
        <aside className="hidden w-60 shrink-0 border-r border-ink-300/40 px-3 py-6 lg:block">
          <NavList sections={sections} />
        </aside>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
