import type { Capability, Viewer } from "@/lib/permissions";
import { can } from "@/lib/permissions";
import type { IconName } from "./icons";

/**
 * The navigation, declared once as data.
 *
 * The sidebar and the mobile drawer both render this list, so a destination
 * cannot exist in one and be missing from the other. This module has no data
 * access and no hooks, so both Server and Client Components can import it.
 *
 * Hiding an item a person cannot use is a courtesy, not a permission — every
 * page guards itself, and typing the URL gets the same answer as not seeing
 * the link.
 */

export type NavItem = {
  label: string;
  href: string;
  icon: IconName;
  /** Null means everybody with an open panel. */
  capability: Capability | null;
  /** Shown only to Associates — the certificate countdown (§5.1). */
  rmOnly?: boolean;
};

export type NavSection = { heading: string; items: NavItem[] };

const SECTIONS: NavSection[] = [
  {
    heading: "Me",
    items: [
      { label: "My information", href: "/me/profile", icon: "user", capability: null },
      { label: "My documents", href: "/me/documents", icon: "documents", capability: null },
      {
        label: "Emergency contacts",
        href: "/me/emergency-contacts",
        icon: "contacts",
        capability: null,
      },
      { label: "Leave & attendance", href: "/me/leave", icon: "calendar", capability: null },
      {
        label: "My Associate certificate",
        href: "/me/certificate",
        icon: "certificate",
        capability: null,
        rmOnly: true,
      },
      { label: "Calendar & notes", href: "/me/calendar", icon: "calendar", capability: null },
    ],
  },
  {
    heading: "My team",
    items: [
      {
        label: "Leave waiting for me",
        href: "/team/approvals",
        icon: "approvals",
        capability: "leave.approve",
      },
      { label: "My team", href: "/team/roster", icon: "team", capability: "team.readRecords" },
      {
        label: "Branch attendance",
        href: "/team/attendance",
        icon: "grid",
        capability: "attendance.submit",
      },
      {
        label: "Requisitions",
        href: "/team/requisitions",
        icon: "inbox",
        capability: "requisitions.raise",
      },
    ],
  },
  {
    heading: "HR",
    items: [
      { label: "Joiners", href: "/hr/joiners", icon: "approvals", capability: "documents.approve" },
      { label: "Find anybody", href: "/hr/employees", icon: "team", capability: "employees.readAll" },
      {
        label: "Associate certificates",
        href: "/hr/certificates",
        icon: "certificate",
        capability: "certificates.manage",
      },
      {
        label: "Branch attendance",
        href: "/hr/attendance",
        icon: "grid",
        capability: "attendance.verify",
      },
      { label: "Leavers", href: "/hr/exits", icon: "exit", capability: "exits.record" },
      { label: "Import employees", href: "/hr/import", icon: "import", capability: "employees.setup" },
    ],
  },
  {
    heading: "Head of HR",
    items: [
      { label: "Approvals", href: "/hr/approvals", icon: "inbox", capability: "requisitions.approve" },
      { label: "Branches", href: "/hr/branches", icon: "branch", capability: "branches.manage" },
      {
        label: "Trading terminals",
        href: "/hr/terminals",
        icon: "terminal",
        capability: "terminals.manage",
      },
      {
        label: "Compliance",
        href: "/hr/compliance",
        icon: "shield",
        capability: "showcause.issue",
      },
      { label: "Reports", href: "/hr/reports", icon: "report", capability: "reports.read" },
      { label: "Settings", href: "/hr/settings", icon: "settings", capability: "settings.manage" },
    ],
  },
  {
    heading: "Super Admin",
    items: [
      {
        label: "Final approvals",
        href: "/admin/approvals",
        icon: "approvals",
        capability: "leave.approveFinal",
      },
      {
        label: "The month",
        href: "/admin/month",
        icon: "report",
        capability: "reports.monthlySummary",
      },
      { label: "Accounts", href: "/admin/accounts", icon: "user", capability: "accounts.manage" },
      {
        label: "Permanent record",
        href: "/admin/audit",
        icon: "shield",
        capability: "audit.read",
      },
    ],
  },
];

/**
 * The menu for one person, computed on the server from their capabilities
 * rather than from their role name — so a capability moved between roles moves
 * the menu with it, and nobody has to remember to edit two places.
 */
export function navFor(viewer: Viewer, options: { isRm: boolean }): NavSection[] {
  return SECTIONS.map((section) => ({
    heading: section.heading,
    items: section.items.filter((item) => {
      if (item.rmOnly && !options.isRm) return false;
      return item.capability === null || can(viewer, item.capability);
    }),
  })).filter((section) => section.items.length > 0);
}
