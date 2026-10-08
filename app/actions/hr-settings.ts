"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { currentIp, getSessionContext } from "@/lib/auth";
import { actorFrom, record } from "@/lib/audit";
import { can } from "@/lib/permissions";
import { fromISODate, toISODate } from "@/lib/dates";
import { clearEscalateCache } from "@/lib/escalation";

export type SettingsResult = { ok: true } | { error: string };

type Guard = { ok: true; context: NonNullable<Awaited<ReturnType<typeof getSessionContext>>> } | { ok: false; error: string };

async function requireHrHead(): Promise<Guard> {
  const context = await getSessionContext();
  if (!context) return { ok: false, error: "Please sign in again." };
  // §12.2 puts leave types and the holiday calendar in the HR Head's hands.
  if (!can(context.viewer, "settings.manage")) {
    return { ok: false, error: "Only the HR Head changes these." };
  }
  return { ok: true, context };
}

/**
 * §6.2 — "There is a settings screen where the HR Head adds leave types and
 * the number of days each one carries... Each change is saved with the date it
 * takes effect, so last year's leave is still calculated on last year's rule
 * and old records do not silently change meaning."
 *
 * So changing an entitlement adds a RULE, it never edits one.
 */
const ruleSchema = z.object({
  leaveTypeId: z.string().trim().min(1),
  effectiveFrom: z.string().trim().min(1, "Set the date this takes effect."),
  daysPerYear: z.coerce.number().min(0, "Days cannot be negative.").max(366),
  carryForward: z.string().optional(),
  carryForwardCap: z.string().trim().optional().default(""),
  overBalance: z.enum(["REFUSE", "WARN"]),
  attachmentRequiredAfterDays: z.string().trim().optional().default(""),
});

/**
 * Who a leave type is for (§6.2).
 *
 * Not a dated rule, unlike the days: the days change from year to year and
 * last year's leave must keep computing on last year's number, whereas who a
 * type is for is a property of the type itself. Audited like every other
 * change to a leave type, because it decides who is offered a statutory
 * entitlement.
 */
export async function setLeaveTypeAudience(
  leaveTypeId: string,
  appliesTo: "ALL" | "FEMALE" | "MALE",
): Promise<SettingsResult> {
  const guard = await requireHrHead();
  if (!guard.ok) return { error: guard.error };
  const { context } = guard;

  const type = await prisma.leaveType.findUnique({ where: { id: leaveTypeId } });
  if (!type) return { error: "Unknown leave type." };
  if (type.appliesTo === appliesTo) return { ok: true };

  const actorName = context.employee?.fullName ?? context.user.email;
  await prisma.$transaction(async (tx) => {
    await tx.leaveType.update({ where: { id: leaveTypeId }, data: { appliesTo } });
    await record({
      action: "leavetype.rule_added",
      actor: actorFrom({ id: context.user.id, fullName: actorName, role: context.user.role }),
      targetType: "leaveType",
      targetId: type.id,
      targetLabel: type.name,
      detail: { appliesTo: { from: type.appliesTo, to: appliesTo } },
      ip: await currentIp(),
      tx,
    });
  });

  revalidatePath("/hr/settings");
  return { ok: true };
}

/**
 * What a leave type does during somebody's probation (FCSL, 10 September 2026)
 * — see `grantWindow` in lib/leave.ts.
 *
 * A property of the type, like who it is for, and audited the same way. It
 * shapes grants made from now on; a grant already made keeps the window it was
 * made with, because leave may already have been taken from it.
 */
const PROBATION_POLICIES = ["NORMAL", "ADVANCE", "AFTER_PROBATION"] as const;

export async function setLeaveTypeProbation(
  leaveTypeId: string,
  probation: (typeof PROBATION_POLICIES)[number],
): Promise<SettingsResult> {
  const guard = await requireHrHead();
  if (!guard.ok) return { error: guard.error };
  const { context } = guard;
  // A server action is a public endpoint; the type annotation checks nothing.
  if (!PROBATION_POLICIES.includes(probation)) return { error: "Pick one of the options." };

  const type = await prisma.leaveType.findUnique({ where: { id: leaveTypeId } });
  if (!type) return { error: "Unknown leave type." };
  if (type.probation === probation) return { ok: true };

  const actorName = context.employee?.fullName ?? context.user.email;
  await prisma.$transaction(async (tx) => {
    await tx.leaveType.update({ where: { id: leaveTypeId }, data: { probation } });
    await record({
      action: "leavetype.rule_added",
      actor: actorFrom({ id: context.user.id, fullName: actorName, role: context.user.role }),
      targetType: "leaveType",
      targetId: type.id,
      targetLabel: type.name,
      detail: { probation: { from: type.probation, to: probation } },
      ip: await currentIp(),
      tx,
    });
  });

  revalidatePath("/hr/settings");
  return { ok: true };
}

export async function saveLeaveRule(_previous: unknown, formData: FormData): Promise<SettingsResult> {
  const guard = await requireHrHead();
  if (!guard.ok) return { error: guard.error };
  const { context } = guard;

  const parsed = ruleSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };

  const effectiveFrom = fromISODate(parsed.data.effectiveFrom);
  if (!effectiveFrom) return { error: "That is not a date." };

  const type = await prisma.leaveType.findUnique({ where: { id: parsed.data.leaveTypeId } });
  if (!type) return { error: "Unknown leave type." };

  const existing = await prisma.leaveTypeRule.findUnique({
    where: { leaveTypeId_effectiveFrom: { leaveTypeId: type.id, effectiveFrom } },
  });
  if (existing) {
    return {
      error: `A rule already starts on ${parsed.data.effectiveFrom}. Pick another date — rules are added, never edited.`,
    };
  }

  const actorName = context.employee?.fullName ?? context.user.email;
  await prisma.$transaction(async (tx) => {
    await tx.leaveTypeRule.create({
      data: {
        leaveTypeId: type.id,
        effectiveFrom,
        daysPerYear: parsed.data.daysPerYear,
        carryForward: parsed.data.carryForward === "yes",
        carryForwardCap: parsed.data.carryForwardCap ? Number(parsed.data.carryForwardCap) : null,
        overBalance: parsed.data.overBalance,
        attachmentRequiredAfterDays: parsed.data.attachmentRequiredAfterDays
          ? Number(parsed.data.attachmentRequiredAfterDays)
          : null,
        createdById: context.user.id,
        createdByName: actorName,
      },
    });
    await record({
      action: "leavetype.rule_added",
      actor: actorFrom({ id: context.user.id, fullName: actorName, role: context.user.role }),
      targetType: "leaveType",
      targetId: type.id,
      targetLabel: type.name,
      detail: {
        effectiveFrom: parsed.data.effectiveFrom,
        daysPerYear: parsed.data.daysPerYear,
        carryForward: parsed.data.carryForward === "yes",
        overBalance: parsed.data.overBalance,
      },
      ip: await currentIp(),
      tx,
    });
  });

  revalidatePath("/hr/settings");
  return { ok: true };
}

export async function createLeaveType(_previous: unknown, formData: FormData): Promise<SettingsResult> {
  const guard = await requireHrHead();
  if (!guard.ok) return { error: guard.error };
  const { context } = guard;

  const name = String(formData.get("name") ?? "").trim();
  const code = String(formData.get("code") ?? "").trim().toUpperCase();
  const days = Number(formData.get("daysPerYear") ?? 0);
  if (name.length < 3) return { error: "Give the leave type a name." };
  if (!/^[A-Z_]{2,20}$/.test(code)) return { error: "A code is capitals and underscores, 2–20 characters." };
  if (await prisma.leaveType.findUnique({ where: { code } })) {
    return { error: `${code} is already a leave type.` };
  }

  const actorName = context.employee?.fullName ?? context.user.email;
  await prisma.$transaction(async (tx) => {
    const count = await tx.leaveType.count();
    const type = await tx.leaveType.create({
      data: {
        name,
        code,
        sortOrder: count + 1,
        appliesTo: (["ALL", "FEMALE", "MALE"] as const).includes(
          String(formData.get("appliesTo")) as never,
        )
          ? (String(formData.get("appliesTo")) as "ALL" | "FEMALE" | "MALE")
          : "ALL",
      },
    });
    await tx.leaveTypeRule.create({
      data: {
        leaveTypeId: type.id,
        effectiveFrom: new Date(Date.UTC(new Date().getUTCFullYear(), 0, 1)),
        daysPerYear: days,
        createdById: context.user.id,
        createdByName: actorName,
      },
    });
    await record({
      action: "leavetype.created",
      actor: actorFrom({ id: context.user.id, fullName: actorName, role: context.user.role }),
      targetType: "leaveType",
      targetId: type.id,
      targetLabel: name,
      detail: { code, daysPerYear: days },
      tx,
    });
  });

  revalidatePath("/hr/settings");
  return { ok: true };
}

/**
 * §12.2 — "The HR Head enters the year's holiday calendar once, at the start
 * of each year. Government holidays in Bangladesh are announced annually, so
 * this cannot be built into the software permanently."
 */
export async function addHoliday(_previous: unknown, formData: FormData): Promise<SettingsResult> {
  const guard = await requireHrHead();
  if (!guard.ok) return { error: guard.error };
  const { context } = guard;

  const date = fromISODate(String(formData.get("date") ?? ""));
  const name = String(formData.get("name") ?? "").trim();
  const halfDay = formData.get("halfDay") === "yes";
  if (!date) return { error: "Pick the date." };
  if (name.length < 2) return { error: "Name the holiday." };
  if (await prisma.holiday.findUnique({ where: { date } })) {
    return { error: `${toISODate(date)} is already a holiday.` };
  }

  const actorName = context.employee?.fullName ?? context.user.email;
  await prisma.$transaction(async (tx) => {
    await tx.holiday.create({
      data: {
        date,
        name,
        halfDay,
        year: date.getUTCFullYear(),
        createdById: context.user.id,
        createdByName: actorName,
      },
    });
    await record({
      action: "holiday.added",
      actor: actorFrom({ id: context.user.id, fullName: actorName, role: context.user.role }),
      targetType: "holiday",
      targetLabel: `${name} — ${toISODate(date)}`,
      detail: { halfDay },
      tx,
    });
  });

  revalidatePath("/hr/settings");
  return { ok: true };
}

export async function removeHoliday(id: string): Promise<SettingsResult> {
  const guard = await requireHrHead();
  if (!guard.ok) return { error: guard.error };
  const { context } = guard;

  const holiday = await prisma.holiday.findUnique({ where: { id } });
  if (!holiday) return { error: "Not found." };

  // Leave already granted around this date was counted using it. Removing a
  // holiday after the fact would silently change what those days cost.
  const affected = await prisma.leaveDay.count({
    where: { date: holiday.date, dayKind: "HOLIDAY" },
  });
  if (affected > 0) {
    return {
      error: `${affected} leave day${affected === 1 ? " was" : "s were"} already counted against this holiday. Removing it now would change what that leave cost.`,
    };
  }

  const actorName = context.employee?.fullName ?? context.user.email;
  await prisma.$transaction(async (tx) => {
    await tx.holiday.delete({ where: { id } });
    await record({
      action: "holiday.removed",
      actor: actorFrom({ id: context.user.id, fullName: actorName, role: context.user.role }),
      targetType: "holiday",
      targetLabel: `${holiday.name} — ${toISODate(holiday.date)}`,
      tx,
    });
  });

  revalidatePath("/hr/settings");
  return { ok: true };
}

/** Departments, designations, grades and divisions — retired, never deleted. */
/** The four lists the HR Head keeps (§12.2). */
export type OrgKind = "department" | "designation" | "grade" | "division";

export async function saveOrgItem(
  kind: OrgKind,
  _previous: unknown,
  formData: FormData,
): Promise<SettingsResult> {
  const guard = await requireHrHead();
  if (!guard.ok) return { error: guard.error };
  const { context } = guard;

  const name = String(formData.get("name") ?? "").trim();
  if (name.length < 2) return { error: "Give it a name." };
  const rank = Number(formData.get("rank") ?? 0);

  const actorName = context.employee?.fullName ?? context.user.email;
  const exists =
    kind === "department"
      ? await prisma.department.findUnique({ where: { name } })
      : kind === "designation"
        ? await prisma.designation.findUnique({ where: { name } })
        : kind === "division"
          ? await prisma.division.findUnique({ where: { name } })
          : await prisma.grade.findUnique({ where: { name } });
  if (exists) return { error: `"${name}" is already there.` };

  await prisma.$transaction(async (tx) => {
    if (kind === "department") await tx.department.create({ data: { name } });
    else if (kind === "designation") await tx.designation.create({ data: { name } });
    else if (kind === "division") await tx.division.create({ data: { name } });
    else await tx.grade.create({ data: { name, rank } });

    await record({
      action: "orglist.created",
      actor: actorFrom({ id: context.user.id, fullName: actorName, role: context.user.role }),
      targetType: kind,
      targetLabel: name,
      tx,
    });
  });

  revalidatePath("/hr/settings");
  return { ok: true };
}

export async function retireOrgItem(
  kind: OrgKind,
  id: string,
): Promise<SettingsResult> {
  const guard = await requireHrHead();
  if (!guard.ok) return { error: guard.error };
  const { context } = guard;

  // Retired, not deleted — historic assignments point at these rows and a
  // deleted grade would make an old posting unreadable.
  // A division holds BRANCHES, not people — FCSL's divisions are geographic —
  // so the question "is anything still on this" is a different one for it.
  if (kind === "division") {
    const branches = await prisma.branch.count({ where: { divisionId: id, closedOn: null } });
    if (branches > 0) {
      return {
        error: `${branches} open branch${branches === 1 ? " is" : "es are"} still in this division. Move them first.`,
      };
    }
  } else {
    const inUse =
      kind === "department"
        ? await prisma.employee.count({ where: { departmentId: id, status: "ACTIVE" } })
        : kind === "designation"
          ? await prisma.employee.count({ where: { designationId: id, status: "ACTIVE" } })
          : await prisma.employee.count({ where: { gradeId: id, status: "ACTIVE" } });
    if (inUse > 0) {
      return {
        error: `${inUse} active ${inUse === 1 ? "person is" : "people are"} still on this. Move them first.`,
      };
    }
  }

  // The NAME, read before it is retired. Every other historical row in this
  // system carries a denormalised snapshot of its subject; this one recorded
  // the word "department", so the permanent record could not answer which
  // department was retired in March.
  const named =
    kind === "department"
      ? await prisma.department.findUnique({ where: { id }, select: { name: true } })
      : kind === "designation"
        ? await prisma.designation.findUnique({ where: { id }, select: { name: true } })
        : kind === "division"
          ? await prisma.division.findUnique({ where: { id }, select: { name: true } })
          : await prisma.grade.findUnique({ where: { id }, select: { name: true } });
  if (!named) return { error: "Not found." };

  const retiredAt = new Date();
  const actorName = context.employee?.fullName ?? context.user.email;
  await prisma.$transaction(async (tx) => {
    if (kind === "department") await tx.department.update({ where: { id }, data: { retiredAt } });
    else if (kind === "designation") await tx.designation.update({ where: { id }, data: { retiredAt } });
    else if (kind === "division") await tx.division.update({ where: { id }, data: { retiredAt } });
    else await tx.grade.update({ where: { id }, data: { retiredAt } });

    await record({
      action: "orglist.retired",
      actor: actorFrom({ id: context.user.id, fullName: actorName, role: context.user.role }),
      targetType: kind,
      targetId: id,
      targetLabel: `${named.name} (${kind})`,
      ip: await currentIp(),
      tx,
    });
  });

  revalidatePath("/hr/settings");
  return { ok: true };
}

export async function saveSetting(key: string, value: string): Promise<SettingsResult> {
  const guard = await requireHrHead();
  if (!guard.ok) return { error: guard.error };
  const { context } = guard;

  const before = await prisma.setting.findUnique({ where: { key } });
  const actorName = context.employee?.fullName ?? context.user.email;

  await prisma.$transaction(async (tx) => {
    await tx.setting.upsert({
      where: { key },
      create: { key, value, updatedById: context.user.id, updatedByName: actorName },
      update: { value, updatedById: context.user.id, updatedByName: actorName },
    });
    await record({
      action: "settings.updated",
      actor: actorFrom({ id: context.user.id, fullName: actorName, role: context.user.role }),
      targetType: "setting",
      targetId: key,
      targetLabel: key,
      detail: { changes: { [key]: { from: before?.value ?? null, to: value } } },
      tx,
    });
  });

  if (key === "approval.escalateAfterWorkingDays") clearEscalateCache();
  revalidatePath("/hr/settings");
  return { ok: true };
}

/**
 * Who answers for a department when an approved requisition arrives
 * (FCSL, 1 October 2026).
 *
 * The HR Head's to set, because they are the one who names the department on
 * each requisition and so the one who finds out first when a department has
 * nobody behind it.
 *
 * Deliberately not restricted to managers. FCSL's Accounts and IT heads are
 * managers today, but a rule that only a MANAGER may head a department would
 * be a second place where "who is senior" is decided, disagreeing with
 * lib/permissions.ts the first time somebody is promoted on one screen and not
 * the other. The head gets no new powers from this — only this department's
 * approved requisitions.
 */
export async function setDepartmentHead(
  departmentId: string,
  employeeId: string | null,
): Promise<SettingsResult> {
  const guard = await requireHrHead();
  if (!guard.ok) return { error: guard.error };
  const { context } = guard;

  const department = await prisma.department.findUnique({
    where: { id: departmentId },
    include: { head: { select: { fullName: true } } },
  });
  if (!department) return { error: "Unknown department." };
  if (department.retiredAt) return { error: "That department is retired." };
  if (department.headId === employeeId) return { ok: true };

  let incoming: { id: string; fullName: string } | null = null;
  if (employeeId) {
    incoming = await prisma.employee.findFirst({
      where: { id: employeeId, status: "ACTIVE", onboardingStatus: "APPROVED" },
      select: { id: true, fullName: true },
    });
    // Somebody who has left, or who is still behind the locked door, cannot be
    // the person an approved requisition waits on.
    if (!incoming) return { error: "That person is not an active, approved employee." };
  }

  const actorName = context.employee?.fullName ?? context.user.email;
  await prisma.$transaction(async (tx) => {
    await tx.department.update({
      where: { id: departmentId },
      data: { headId: incoming?.id ?? null },
    });
    await record({
      action: "department.head_set",
      actor: actorFrom({ id: context.user.id, fullName: actorName, role: context.user.role }),
      targetType: "department",
      targetId: department.id,
      targetLabel: department.name,
      detail: { from: department.head?.fullName ?? null, to: incoming?.fullName ?? null },
      ip: await currentIp(),
      tx,
    });
  });

  revalidatePath("/hr/settings");
  revalidatePath("/team/requisitions");
  return { ok: true };
}
