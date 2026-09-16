import { prisma } from "@/lib/db";
import { requireCapability } from "@/lib/auth";
import { formatDate, todayInDhaka } from "@/lib/dates";
import { ruleOn } from "@/lib/leave";
import { Card, PageHeader } from "@/components/ui/Card";
import { Badge, NoticeBox } from "@/components/ui/Feedback";
import {
  HolidayForm,
  LeaveAudienceForm,
  LeaveProbationForm,
  LeaveRuleForm,
  NewLeaveTypeForm,
  OrgListForm,
  RemoveHolidayButton,
  RetireButton,
  SettingRow,
} from "@/components/settings/SettingsForms";

export const metadata = { title: "Settings · FCSL HR" };

const SETTING_LABELS: Record<string, { label: string; note: string }> = {
  "requisition.escalationThreshold": {
    label: "Requisition escalation threshold (৳)",
    note: "Above this a requisition goes on to the Super Admin. Below it, your approval is final.",
  },
  "attendance.deadlineDayOfMonth": {
    label: "Attendance deadline",
    note: "Day of the following month by which branches must submit.",
  },
  "leave.maximumDays": {
    label: "Longest leave application (days)",
    note: "Calendar days in one application. Anything longer is recorded in parts.",
  },
  "certificate.warnMonthsBefore": {
    label: "Certificate warning (months)",
    note: "How far ahead the Associate certificate warning starts. It warns only — it never blocks.",
  },
  "onboarding.reviewReminderWorkingDays": {
    label: "Joiner review reminder",
    note: "Working days a joiner may wait before HR is reminded.",
  },
  "approval.escalateAfterWorkingDays": {
    label: "Approval escalation",
    note: "Working days before a waiting request turns amber and emails the approver.",
  },
  "documents.retentionYearsAfterExit": {
    label: "Document retention (years)",
    note: "Files are removed this long after the last working day. The record itself is kept for ever.",
  },
};

/**
 * §12.2 — the settings the HR Head owns, so that changing them needs no
 * developer.
 */
export default async function Page() {
  await requireCapability("settings.manage");
  const today = todayInDhaka();
  const year = today.getUTCFullYear();

  const [types, holidays, departments, designations, grades, settings] = await Promise.all([
    prisma.leaveType.findMany({
      where: { retiredAt: null },
      include: { rules: { orderBy: { effectiveFrom: "desc" } } },
      orderBy: { sortOrder: "asc" },
    }),
    prisma.holiday.findMany({ where: { year }, orderBy: { date: "asc" } }),
    prisma.department.findMany({ orderBy: { name: "asc" } }),
    prisma.designation.findMany({ orderBy: { name: "asc" } }),
    prisma.grade.findMany({ orderBy: { rank: "asc" } }),
    prisma.setting.findMany({ orderBy: { key: "asc" } }),
  ]);

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <PageHeader
        title="Settings"
        subtitle="Leave, holidays and the company's lists — yours to change without a developer."
      />

      <section className="mb-10">
        <h2 className="mb-1 text-sm font-semibold text-ink-900">Leave types and days</h2>
        <div className="mb-4">
          <NoticeBox tone="brand">
            {/* §6.2 / §12.2 — the reason rules are added rather than edited. */}
            A change is a <strong className="font-medium">new dated rule</strong>, never an edit.
            Last year&rsquo;s leave keeps being calculated on last year&rsquo;s rule, so old records
            do not silently change meaning. These are FCSL&rsquo;s figures as decided on 10 September
            2026; change or rename them as FCSL wishes. &ldquo;During probation&rdquo; decides whether a
            type can be taken in somebody&rsquo;s first year.
          </NoticeBox>
        </div>

        <div className="space-y-4">
          {types.map((type) => {
            const current = ruleOn(type.rules, today);
            // Partition by date, never by position in the array. A rule dated
            // next January is the one HR most needs to see — slicing the list
            // by index hid it completely and invited them to enter it twice.
            const scheduled = type.rules.filter((r) => r.effectiveFrom > today);
            const earlier = type.rules.filter(
              (r) => r.effectiveFrom <= today && r.id !== current?.id,
            );
            return (
              <Card key={type.id} className="p-5">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold text-ink-900">{type.name}</h3>
                  <Badge tone="neutral">{type.code}</Badge>
                  {current && (
                    <span className="text-xs text-ink-500">
                      {String(current.daysPerYear)} days a year · in force since{" "}
                      {formatDate(current.effectiveFrom)}
                      {current.carryForward ? " · carries forward" : ""}
                    </span>
                  )}
                </div>

                <div className="mb-3 flex flex-wrap gap-x-6 gap-y-2">
                  <LeaveAudienceForm leaveTypeId={type.id} current={type.appliesTo} />
                  <LeaveProbationForm leaveTypeId={type.id} current={type.probation} />
                </div>

                <LeaveRuleForm
                  leaveTypeId={type.id}
                  current={
                    current
                      ? {
                          daysPerYear: String(current.daysPerYear),
                          carryForward: current.carryForward,
                          carryForwardCap: current.carryForwardCap ? String(current.carryForwardCap) : "",
                          overBalance: current.overBalance,
                          attachmentRequiredAfterDays:
                            current.attachmentRequiredAfterDays !== null
                              ? String(current.attachmentRequiredAfterDays)
                              : "",
                        }
                      : null
                  }
                />

                {scheduled.length > 0 && (
                  <div className="mt-3 rounded-lg border border-warn-500/40 bg-warn-50 px-3 py-2">
                    <p className="text-xs font-semibold tracking-widest text-warn-500">
                      ALREADY SCHEDULED — NOT IN FORCE YET
                    </p>
                    <ul className="mt-1 space-y-0.5 text-xs text-ink-700">
                      {scheduled.map((rule) => (
                        <li key={rule.id}>
                          From {formatDate(rule.effectiveFrom)}: {String(rule.daysPerYear)} days ·{" "}
                          {rule.createdByName}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {earlier.length > 0 && (
                  <div className="mt-3 border-t border-ink-300/30 pt-3">
                    <p className="text-xs font-semibold tracking-widest text-ink-400">
                      EARLIER RULES, STILL GOVERNING THEIR OWN PERIOD
                    </p>
                    <ul className="mt-1 space-y-0.5 text-xs text-ink-500">
                      {earlier.map((rule) => (
                        <li key={rule.id}>
                          From {formatDate(rule.effectiveFrom)}: {String(rule.daysPerYear)} days ·{" "}
                          {rule.createdByName}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </Card>
            );
          })}
        </div>

        <Card className="mt-4 p-5">
          <h3 className="mb-3 text-xs font-semibold tracking-widest text-ink-400">
            ADD A LEAVE TYPE
          </h3>
          <NewLeaveTypeForm />
        </Card>
      </section>

      <section className="mb-10">
        <h2 className="mb-1 text-sm font-semibold text-ink-900">Public holidays, {year}</h2>
        <p className="mb-3 text-xs text-ink-500">
          {/* §12.2: announced annually, so they cannot be built into the code. */}
          Government holidays in Bangladesh are announced each year, so these are entered rather than
          built in. Fridays and Saturdays are already the weekly off and do not belong here.
        </p>
        <Card className="mb-3 divide-y divide-ink-300/20">
          {holidays.length === 0 && (
            <p className="px-5 py-6 text-center text-sm text-ink-400">
              Nothing entered for {year} yet — leave counting will treat every weekday as a working
              day until you do.
            </p>
          )}
          {holidays.map((holiday) => (
            <div key={holiday.id} className="flex items-center gap-3 px-5 py-3 text-sm">
              <span className="w-32 shrink-0 tabular text-ink-500">{formatDate(holiday.date)}</span>
              <span className="flex-1 text-ink-900">{holiday.name}</span>
              {holiday.halfDay && <Badge tone="warn">Half day</Badge>}
              <RemoveHolidayButton id={holiday.id} />
            </div>
          ))}
        </Card>
        <Card className="p-5">
          <HolidayForm />
        </Card>
      </section>

      <section className="mb-10">
        <h2 className="mb-1 text-sm font-semibold text-ink-900">The company&rsquo;s lists</h2>
        <p className="mb-3 text-xs text-ink-500">
          Retired, never deleted — an old posting that pointed at a deleted grade would become
          unreadable.
        </p>
        <div className="grid gap-4 lg:grid-cols-3">
          <OrgList
            title="Departments"
            kind="department"
            rows={departments.map((d) => ({ id: d.id, name: d.name, retired: Boolean(d.retiredAt) }))}
          />
          <OrgList
            title="Designations"
            kind="designation"
            rows={designations.map((d) => ({ id: d.id, name: d.name, retired: Boolean(d.retiredAt) }))}
          />
          <OrgList
            title="Grades"
            kind="grade"
            rows={grades.map((g) => ({ id: g.id, name: g.name, retired: Boolean(g.retiredAt) }))}
          />
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-ink-900">Numbers the system uses</h2>
        <Card className="divide-y divide-ink-300/20">
          {settings.map((setting) => (
            <SettingRow
              key={setting.key}
              settingKey={setting.key}
              label={SETTING_LABELS[setting.key]?.label ?? setting.key}
              value={setting.value}
              note={SETTING_LABELS[setting.key]?.note ?? ""}
            />
          ))}
        </Card>
      </section>
    </main>
  );
}

function OrgList({
  title,
  kind,
  rows,
}: {
  title: string;
  kind: "department" | "designation" | "grade";
  rows: { id: string; name: string; retired: boolean }[];
}) {
  return (
    <Card className="p-5">
      <h3 className="mb-3 text-xs font-semibold tracking-widest text-ink-400">
        {title.toUpperCase()}
      </h3>
      <ul className="mb-4 space-y-1 text-sm">
        {rows.map((row) => (
          <li key={row.id} className="flex items-center gap-2">
            <span className={`flex-1 ${row.retired ? "text-ink-400 line-through" : "text-ink-900"}`}>
              {row.name}
            </span>
            {!row.retired && <RetireButton kind={kind} id={row.id} />}
          </li>
        ))}
      </ul>
      <OrgListForm kind={kind} />
    </Card>
  );
}
