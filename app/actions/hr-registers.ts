"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { currentIp, getSessionContext } from "@/lib/auth";
import { actorFrom, changedFields, record } from "@/lib/audit";
import { can } from "@/lib/permissions";
import { fromISODate } from "@/lib/dates";

export type RegisterResult = { ok: true } | { error: string };

// ---------------------------------------------------------------------------
// §6.7 Branches
// ---------------------------------------------------------------------------

const branchSchema = z.object({
  name: z.string().trim().min(2, "Give the branch a name."),
  code: z
    .string()
    .trim()
    .min(2, "Give it a short code.")
    .max(10)
    .regex(/^[A-Za-z0-9-]+$/, "A code is letters, digits and hyphens only."),
  address: z.string().trim().max(300).optional().default(""),
  phone: z.string().trim().max(40).optional().default(""),
  openedOn: z.string().trim().optional().default(""),
  branchManagerId: z.string().trim().optional().default(""),
});

export async function saveBranch(
  branchId: string | null,
  _previous: unknown,
  formData: FormData,
): Promise<RegisterResult> {
  const context = await getSessionContext();
  if (!context) return { error: "Please sign in again." };
  if (!can(context.viewer, "branches.manage")) return { error: "Only the HR Head manages branches." };

  const parsed = branchSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };

  const code = parsed.data.code.toUpperCase();
  const clash = await prisma.branch.findUnique({ where: { code } });
  if (clash && clash.id !== branchId) return { error: `Another branch already uses the code ${code}.` };

  const data = {
    name: parsed.data.name,
    code,
    address: parsed.data.address,
    phone: parsed.data.phone,
    openedOn: fromISODate(parsed.data.openedOn),
    branchManagerId: parsed.data.branchManagerId || null,
  };

  const actorName = context.employee?.fullName ?? context.user.email;
  const ip = await currentIp();

  await prisma.$transaction(async (tx) => {
    if (branchId) {
      const before = await tx.branch.findUnique({ where: { id: branchId } });
      await tx.branch.update({ where: { id: branchId }, data });
      await record({
        action: "branch.updated",
        actor: actorFrom({ id: context.user.id, fullName: actorName, role: context.user.role }),
        targetType: "branch",
        targetId: branchId,
        targetLabel: data.name,
        detail: changedFields(before as unknown as Record<string, unknown>, data),
        ip,
        tx,
      });
    } else {
      const created = await tx.branch.create({ data });
      await record({
        action: "branch.created",
        actor: actorFrom({ id: context.user.id, fullName: actorName, role: context.user.role }),
        targetType: "branch",
        targetId: created.id,
        targetLabel: `${data.name} (${code})`,
        ip,
        tx,
      });
    }
  });

  revalidatePath("/hr/branches");
  return { ok: true };
}

/**
 * §6.7 — "Closing a branch is marking it closed on a date, and its people must
 * be moved somewhere else first. The history survives."
 */
export async function closeBranch(branchId: string, isoDate: string): Promise<RegisterResult> {
  const context = await getSessionContext();
  if (!context) return { error: "Please sign in again." };
  if (!can(context.viewer, "branches.manage")) return { error: "Only the HR Head manages branches." };

  const closedOn = fromISODate(isoDate);
  if (!closedOn) return { error: "Set the date it closed." };

  const branch = await prisma.branch.findUnique({
    where: { id: branchId },
    include: { employees: { where: { status: "ACTIVE" }, select: { id: true } } },
  });
  if (!branch) return { error: "Not found." };
  if (branch.closedOn) return { error: "This branch is already closed." };

  if (branch.employees.length) {
    return {
      error: `${branch.employees.length} ${branch.employees.length === 1 ? "person is" : "people are"} still attached to this branch. Move them somewhere else first.`,
    };
  }

  const actorName = context.employee?.fullName ?? context.user.email;
  await prisma.$transaction(async (tx) => {
    // Marked closed, never deleted. The history — every assignment that ever
    // pointed here, every attendance sheet — survives.
    await tx.branch.update({ where: { id: branchId }, data: { closedOn } });
    await record({
      action: "branch.closed",
      actor: actorFrom({ id: context.user.id, fullName: actorName, role: context.user.role }),
      targetType: "branch",
      targetId: branchId,
      targetLabel: branch.name,
      detail: { closedOn: isoDate },
      ip: await currentIp(),
      tx,
    });
  });

  revalidatePath("/hr/branches");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// §6.9 Trading terminals
// ---------------------------------------------------------------------------

const terminalSchema = z.object({
  terminalId: z.string().trim().min(2, "Enter the terminal ID.").max(40),
  exchange: z.string().trim().min(2, "Which exchange?").max(20),
  branchId: z.string().trim().optional().default(""),
});

export async function saveTerminal(_previous: unknown, formData: FormData): Promise<RegisterResult> {
  const context = await getSessionContext();
  if (!context) return { error: "Please sign in again." };
  if (!can(context.viewer, "terminals.manage")) return { error: "You cannot manage terminals." };

  const parsed = terminalSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };

  const terminalId = parsed.data.terminalId.toUpperCase();
  if (await prisma.tradingTerminal.findUnique({ where: { terminalId } })) {
    return { error: `${terminalId} is already on the register.` };
  }

  const actorName = context.employee?.fullName ?? context.user.email;
  await prisma.$transaction(async (tx) => {
    const created = await tx.tradingTerminal.create({
      data: {
        terminalId,
        exchange: parsed.data.exchange.toUpperCase(),
        branchId: parsed.data.branchId || null,
      },
    });
    await record({
      action: "terminal.created",
      actor: actorFrom({ id: context.user.id, fullName: actorName, role: context.user.role }),
      targetType: "terminal",
      targetId: created.id,
      targetLabel: terminalId,
      ip: await currentIp(),
      tx,
    });
  });

  revalidatePath("/hr/terminals");
  return { ok: true };
}

export async function assignTerminal(
  terminalId: string,
  employeeId: string,
  isoDate: string,
): Promise<RegisterResult> {
  const context = await getSessionContext();
  if (!context) return { error: "Please sign in again." };
  if (!can(context.viewer, "terminals.manage")) return { error: "You cannot manage terminals." };

  const assignedOn = fromISODate(isoDate);
  if (!assignedOn) return { error: "Set the date it was assigned." };

  const [terminal, employee] = await Promise.all([
    prisma.tradingTerminal.findUnique({
      where: { id: terminalId },
      include: { assignments: { where: { releasedOn: null } } },
    }),
    prisma.employee.findUnique({ where: { id: employeeId } }),
  ]);
  if (!terminal || !employee) return { error: "Not found." };
  if (terminal.assignments.length) {
    return { error: "This terminal is already assigned. Release it first." };
  }
  // A terminal is tied to a person, and that person has to still work here.
  if (employee.status === "LEFT") {
    return { error: `${employee.fullName} has left. A terminal cannot be assigned to them.` };
  }
  if (terminal.status === "SURRENDERED") {
    return { error: "This terminal has been surrendered to the exchange." };
  }

  const actorName = context.employee?.fullName ?? context.user.email;
  await prisma.$transaction(async (tx) => {
    await tx.terminalAssignment.create({
      data: {
        terminalId,
        employeeId,
        assignedOn,
        assignedById: context.user.id,
        assignedByName: actorName,
      },
    });
    await record({
      action: "terminal.assigned",
      actor: actorFrom({ id: context.user.id, fullName: actorName, role: context.user.role }),
      targetType: "employee",
      targetId: employeeId,
      targetLabel: employee.fullName,
      detail: { terminal: terminal.terminalId, exchange: terminal.exchange, assignedOn: isoDate },
      ip: await currentIp(),
      tx,
    });
  });

  revalidatePath("/hr/terminals");
  return { ok: true };
}

export async function releaseTerminal(assignmentId: string, isoDate: string): Promise<RegisterResult> {
  const context = await getSessionContext();
  if (!context) return { error: "Please sign in again." };
  if (!can(context.viewer, "terminals.manage")) return { error: "You cannot manage terminals." };

  const releasedOn = fromISODate(isoDate);
  if (!releasedOn) return { error: "Set the date it was released." };

  const assignment = await prisma.terminalAssignment.findUnique({
    where: { id: assignmentId },
    include: { terminal: true, employee: true },
  });
  if (!assignment || assignment.releasedOn) return { error: "Not found." };
  if (releasedOn < assignment.assignedOn) {
    return { error: "It cannot be released before it was assigned." };
  }

  const actorName = context.employee?.fullName ?? context.user.email;
  await prisma.$transaction(async (tx) => {
    // The assignment is CLOSED, not deleted. Who held which terminal and when
    // is exactly what an inspection asks for.
    await tx.terminalAssignment.update({ where: { id: assignmentId }, data: { releasedOn } });
    await record({
      action: "terminal.released",
      actor: actorFrom({ id: context.user.id, fullName: actorName, role: context.user.role }),
      targetType: "employee",
      targetId: assignment.employeeId,
      targetLabel: assignment.employee.fullName,
      detail: { terminal: assignment.terminal.terminalId, releasedOn: isoDate },
      ip: await currentIp(),
      tx,
    });
  });

  revalidatePath("/hr/terminals");
  revalidatePath("/hr/exits");
  return { ok: true };
}
