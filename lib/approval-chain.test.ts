import { describe, expect, it } from "vitest";
import type { Role } from "@prisma/client";
import {
  LEAVE_CHAIN,
  canDecideAt,
  chainAdvance,
  chainStart,
  everyApproverRole,
  requisitionChain,
} from "./approval-chain";

describe("§7.1 — the leave chain, exactly as the table prints it", () => {
  const TABLE: [Role, Role[]][] = [
    ["EMPLOYEE", ["MANAGER", "HR_HEAD", "SUPER_ADMIN"]],
    ["MANAGER", ["HR_HEAD", "SUPER_ADMIN"]],
    ["HR_EXECUTIVE", ["HR_HEAD", "SUPER_ADMIN"]],
    ["HR_HEAD", ["SUPER_ADMIN"]],
    ["SUPER_ADMIN", []],
  ];

  for (const [role, chain] of TABLE) {
    it(`${role} → ${chain.join(" → ") || "recorded directly"}`, () => {
      expect(LEAVE_CHAIN[role]).toEqual(chain);
    });
  }

  it("ends at the Super Admin for everybody who needs approval at all", () => {
    for (const [role, chain] of TABLE) {
      if (chain.length) expect(chain.at(-1)).toBe("SUPER_ADMIN");
      else expect(role).toBe("SUPER_ADMIN");
    }
  });

  it("never puts an HR Executive in anybody's chain — they cannot approve leave", () => {
    for (const chain of Object.values(LEAVE_CHAIN)) {
      expect(chain).not.toContain("HR_EXECUTIVE");
    }
  });
});

describe("the worked example — an employee asks for three days", () => {
  it("starts with their manager", () => {
    const start = chainStart("EMPLOYEE");
    expect(start.approver).toBe("MANAGER");
    expect(start.isFinalStep).toBe(false);
  });

  it("passes to the HR Head when the manager grants", () => {
    const afterManager = chainAdvance("EMPLOYEE", 0);
    expect(afterManager.approver).toBe("HR_HEAD");
    expect(afterManager.isFinalStep).toBe(false);
  });

  it("passes to the Super Admin when the HR Head grants", () => {
    const afterHr = chainAdvance("EMPLOYEE", 1);
    expect(afterHr.approver).toBe("SUPER_ADMIN");
    // The last step, and the only moment the leave is actually granted.
    expect(afterHr.isFinalStep).toBe(true);
  });

  it("finishes when the Super Admin grants", () => {
    expect(chainAdvance("EMPLOYEE", 2).approver).toBeNull();
  });
});

describe("rule 1 — one step at a time, in order", () => {
  it("lets the person whose turn it is decide", () => {
    expect(canDecideAt("EMPLOYEE", 0, "MANAGER")).toBe(true);
    expect(canDecideAt("EMPLOYEE", 1, "HR_HEAD")).toBe(true);
    expect(canDecideAt("EMPLOYEE", 2, "SUPER_ADMIN")).toBe(true);
  });

  it("refuses anybody approving out of turn", () => {
    // The HR Head never sees an application the manager has not dealt with.
    expect(canDecideAt("EMPLOYEE", 0, "HR_HEAD")).toBe(false);
    // The Super Admin cannot reach past the HR Head either.
    expect(canDecideAt("EMPLOYEE", 1, "SUPER_ADMIN")).toBe(false);
    // And a manager cannot decide again once they have.
    expect(canDecideAt("EMPLOYEE", 1, "MANAGER")).toBe(false);
  });

  it("refuses a step past the end of the chain", () => {
    expect(canDecideAt("HR_HEAD", 1, "SUPER_ADMIN")).toBe(false);
    expect(canDecideAt("SUPER_ADMIN", 0, "SUPER_ADMIN")).toBe(false);
  });

  it("keeps a manager's own leave away from themselves", () => {
    // A manager's leave starts at the HR Head — they cannot grant their own.
    expect(chainStart("MANAGER").approver).toBe("HR_HEAD");
    expect(canDecideAt("MANAGER", 0, "MANAGER")).toBe(false);
  });

  it("keeps the HR Head's own leave away from themselves", () => {
    expect(chainStart("HR_HEAD").approver).toBe("SUPER_ADMIN");
    expect(canDecideAt("HR_HEAD", 0, "HR_HEAD")).toBe(false);
  });
});

describe("rule 3 — who is told on final approval", () => {
  it("names every approver along the way, not just the last", () => {
    // "the employee, their manager and the HR Head all receive the
    // confirmation at the same time."
    expect(everyApproverRole("EMPLOYEE")).toEqual(["MANAGER", "HR_HEAD", "SUPER_ADMIN"]);
  });
});

describe("§7.2 — the requisition route", () => {
  it("stops at the HR Head below the threshold FCSL sets", () => {
    expect(requisitionChain(false, "MANAGER")).toEqual(["HR_HEAD"]);
  });

  it("goes on to the Super Admin above it", () => {
    expect(requisitionChain(true, "MANAGER")).toEqual(["HR_HEAD", "SUPER_ADMIN"]);
  });

  it("never sends the HR Head's own requisition to the HR Head", () => {
    // Below the threshold it would otherwise be final on their own say-so.
    expect(requisitionChain(false, "HR_HEAD")).toEqual(["SUPER_ADMIN"]);
    expect(requisitionChain(true, "HR_HEAD")).toEqual(["SUPER_ADMIN"]);
  });
});
