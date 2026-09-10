import { describe, expect, it } from "vitest";
import type { Role } from "@prisma/client";
import { navFor } from "./nav-items";

const viewer = (role: Role) => ({ id: `u-${role}`, role });
const hrefs = (role: Role, isRm = false) =>
  navFor(viewer(role), { isRm }).flatMap((s) => s.items.map((i) => i.href));

describe("the menu each panel gets", () => {
  it("gives an employee their own five pages and nothing else", () => {
    expect(hrefs("EMPLOYEE")).toEqual([
      "/me/profile",
      "/me/documents",
      "/me/emergency-contacts",
      "/me/leave",
      "/me/calendar",
    ]);
  });

  it("adds the certificate countdown for an RM, and only for an RM", () => {
    expect(hrefs("EMPLOYEE", true)).toContain("/me/certificate");
    expect(hrefs("EMPLOYEE", false)).not.toContain("/me/certificate");
    // It is not a role — a manager who is not an RM does not get it either.
    expect(hrefs("MANAGER", false)).not.toContain("/me/certificate");
  });

  it("gives a manager their team and nothing of HR's", () => {
    const links = hrefs("MANAGER");
    expect(links).toContain("/team/approvals");
    expect(links).toContain("/team/roster");
    expect(links).toContain("/team/attendance");
    expect(links).toContain("/team/requisitions");
    expect(links.filter((h) => h.startsWith("/hr/"))).toEqual([]);
    expect(links.filter((h) => h.startsWith("/admin/"))).toEqual([]);
  });

  it("gives an HR Executive records but not decisions", () => {
    const links = hrefs("HR_EXECUTIVE");
    expect(links).toContain("/hr/joiners");
    expect(links).toContain("/hr/employees");
    expect(links).toContain("/hr/exits");
    // §5.3's CANNOT list.
    expect(links).not.toContain("/hr/approvals");
    expect(links).not.toContain("/hr/branches");
    expect(links).not.toContain("/hr/terminals");
    expect(links).not.toContain("/hr/compliance");
    expect(links).not.toContain("/hr/reports");
    // FCSL, 10 September 2026: no "My team" section at all — no team, no
    // requisitions, no leave to approve.
    expect(links.filter((h) => h.startsWith("/team/"))).toEqual([]);
  });

  it("gives the HR Head the widest panel in the system", () => {
    const links = hrefs("HR_HEAD");
    for (const href of [
      "/team/approvals",
      "/team/roster",
      "/team/requisitions",
      "/hr/joiners",
      "/hr/approvals",
      "/hr/branches",
      "/hr/terminals",
      "/hr/compliance",
      "/hr/reports",
      "/hr/settings",
    ]) {
      expect(links).toContain(href);
    }
    // FCSL, 10 September 2026: the permanent record is the Super Admin's
    // alone. Nothing under /admin/ appears in this menu.
    expect(links.filter((h) => h.startsWith("/admin/"))).toEqual([]);
  });

  it("keeps the Super Admin's panel small, and without attendance", () => {
    const links = hrefs("SUPER_ADMIN");
    expect(links).toContain("/admin/approvals");
    expect(links).toContain("/admin/accounts");
    expect(links).toContain("/admin/audit");
    // §9: verifying and publishing attendance is HR's work, not the Super
    // Admin's. The menu must not offer it.
    expect(links).not.toContain("/hr/attendance");
    // §12.2 puts leave types and the holiday calendar in the HR Head's hands.
    expect(links).not.toContain("/hr/settings");
    // FCSL, 10 September 2026: "My team" is for managers, department heads and
    // the HR Head. The Super Admin's leave decisions are on Final approvals.
    expect(links.filter((h) => h.startsWith("/team/"))).toEqual([]);

    // Neither menu contains the other, and that is correct rather than a bug.
    // What makes the Super Admin's panel "small... used rarely" (§5.5) is how
    // much of it they touch, not how many entries it holds. Every difference
    // below is a row in §9 as FCSL amended it.
    const head = hrefs("HR_HEAD");
    expect(links.filter((h) => !head.includes(h)).sort()).toEqual([
      "/admin/accounts",
      "/admin/approvals",
      "/admin/audit",
    ]);
    expect(head.filter((h) => !links.includes(h)).sort()).toEqual([
      "/hr/attendance",
      "/hr/settings",
      "/team/approvals",
      "/team/requisitions",
      "/team/roster",
    ]);
  });

  it("never shows a section with nothing in it", () => {
    for (const role of ["EMPLOYEE", "MANAGER", "HR_EXECUTIVE", "HR_HEAD", "SUPER_ADMIN"] as Role[]) {
      for (const section of navFor(viewer(role), { isRm: false })) {
        expect(section.items.length).toBeGreaterThan(0);
      }
    }
  });
});
