"use client";

import { useEffect, useRef, useState } from "react";
import type { NavSection } from "./nav-items";
import { NavList } from "./NavList";
import { IconClose, IconMenu } from "./icons";

/**
 * The drawer below `lg`. Branch managers fill the attendance sheet on a phone,
 * so this is not an afterthought.
 *
 * The tap target is grown with `p-3 -m-3`: the padding makes it 44px, the
 * negative margin gives the space back to the layout, so the icon still sits
 * where the design puts it.
 */
export function MobileNav({ sections }: { sections: NavSection[] }) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
      if (event.key !== "Tab" || !panelRef.current) return;
      // Trap focus: tabbing out of an open drawer lands on the page behind it,
      // which for a screen-reader user means the drawer has silently vanished.
      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled])',
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.querySelector<HTMLElement>("a[href]")?.focus();

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      // Send focus back where it came from, not to the top of the document.
      openerRef.current?.focus();
    };
  }, [open]);

  return (
    <>
      <button
        ref={openerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        aria-expanded={open}
        aria-controls="mobile-nav"
        className="-m-3 p-3 text-ink-700 lg:hidden"
      >
        <IconMenu />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-ink-900/40"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div
            id="mobile-nav"
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label="Menu"
            className="absolute inset-y-0 left-0 w-72 overflow-y-auto bg-white px-3 py-4 shadow-xl"
          >
            <div className="mb-4 flex items-center justify-between px-3">
              <span className="text-sm font-bold tracking-tight text-brand-500">FCSL HR</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close menu"
                className="-m-3 p-3 text-ink-500"
              >
                <IconClose />
              </button>
            </div>
            <NavList sections={sections} onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}
    </>
  );
}
