"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { NavSection } from "./nav-items";
import { ICONS } from "./icons";

export function NavList({
  sections,
  onNavigate,
}: {
  sections: NavSection[];
  onNavigate?: () => void;
}) {
  // The current item comes from the router rather than from a prop, so no page
  // has to remember to declare where it is — a page that forgot would render a
  // sidebar with nothing highlighted, which reads as "you are nowhere".
  const pathname = usePathname();
  return (
    <nav className="space-y-6">
      {sections.map((section) => (
        <div key={section.heading}>
          <p className="px-3 pb-2 text-[11px] font-semibold tracking-widest text-ink-400">
            {section.heading.toUpperCase()}
          </p>
          <ul className="space-y-0.5">
            {section.items.map((item) => {
              const current = pathname === item.href || pathname.startsWith(`${item.href}/`);
              const Icon = ICONS[item.icon];
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={current ? "page" : undefined}
                    className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                      current
                        ? "bg-brand-50 font-medium text-brand-500"
                        : "text-ink-700 hover:bg-surface"
                    }`}
                  >
                    <Icon className="h-[18px] w-[18px] shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
