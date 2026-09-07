import Link from "next/link";
import type { Prisma, Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireCapability } from "@/lib/auth";
import { ROLE_LABELS } from "@/lib/permissions";
import { formatDate, formatDateTime } from "@/lib/dates";
import { Card, PageHeader } from "@/components/ui/Card";
import { Badge, NoticeBox } from "@/components/ui/Feedback";
import { ButtonLink } from "@/components/ui/Button";
import { TableShell, Tbody, Td, Th, Thead, TableEmpty } from "@/components/ui/Table";
import { AccountControls } from "@/components/admin/AccountControls";

export const metadata = { title: "Accounts · FCSL HR" };

const PAGE_SIZE = 50;

type Props = { searchParams: Promise<Record<string, string | undefined>> };

/**
 * §5.5 / P5.2 — "the ability to create and deactivate accounts of any kind",
 * and the one door nobody else can open: the HR Head's own documents.
 *
 * That second part is the reason this page exists rather than being another
 * row on the HR Executive's screen. §7.3: "The person uploads → HR Executive
 * or HR Head approves. Done. The exception is the HR Head's own documents,
 * which go to the Super Admin." An HR Executive checking the file of the
 * person who checks their work is not a review.
 */
export default async function Page({ searchParams }: Props) {
  const context = await requireCapability("accounts.manage");
  const params = await searchParams;

  const q = (params.q ?? "").trim();
  const page = Math.max(1, Math.min(1000, Number(params.page) || 1));
  const showing = params.show === "disabled" ? "disabled" : params.show === "all" ? "all" : "active";

  const where: Prisma.UserWhereInput = {
    AND: [
      showing === "active" ? { disabledAt: null } : showing === "disabled" ? { NOT: { disabledAt: null } } : {},
      params.role ? { role: params.role as Role } : {},
      q
        ? {
            OR: [
              { email: { contains: q, mode: "insensitive" } },
              { employee: { fullName: { contains: q, mode: "insensitive" } } },
              { employee: { employeeId: { contains: q, mode: "insensitive" } } },
            ],
          }
        : {},
    ],
  };

  const [rows, total, awaitingSuperAdmin] = await Promise.all([
    prisma.user.findMany({
      where,
      include: {
        employee: {
          select: { id: true, fullName: true, employeeId: true, status: true, onboardingStatus: true },
        },
        sessions: { where: { revokedAt: null, expiresAt: { gt: new Date() } }, select: { id: true } },
      },
      orderBy: [{ role: "asc" }, { email: "asc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.user.count({ where }),
    // The one door. An HR Head sitting behind the locked door is invisible to
    // everybody except this page, so it goes at the top rather than in a list.
    prisma.employee.findMany({
      where: {
        onboardingStatus: { in: ["SUBMITTED", "SENT_BACK"] },
        user: { role: { in: ["HR_HEAD", "SUPER_ADMIN"] } },
      },
      include: { user: { select: { email: true, role: true } } },
      orderBy: { submittedAt: "asc" },
    }),
  ]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <PageHeader
        title="Accounts"
        subtitle={`${total} ${total === 1 ? "account" : "accounts"}${showing === "active" ? " in use" : showing === "disabled" ? " turned off" : ""}. Nothing here is ever deleted.`}
        actions={
          <ButtonLink href="/hr/accounts/new" variant="primary">
            Create an account
          </ButtonLink>
        }
      />

      {awaitingSuperAdmin.length > 0 && (
        <div className="mb-6">
          <NoticeBox tone="warn">
            <strong className="font-medium">
              {awaitingSuperAdmin.length === 1
                ? "One file is waiting for you and can be approved by nobody else."
                : `${awaitingSuperAdmin.length} files are waiting for you and can be approved by nobody else.`}
            </strong>
            <ul className="mt-2 space-y-1">
              {awaitingSuperAdmin.map((person) => (
                <li key={person.id}>
                  <Link href={`/hr/joiners/${person.id}`} className="text-brand-500 hover:underline">
                    {person.fullName}
                  </Link>{" "}
                  <span className="text-ink-500">
                    — {ROLE_LABELS[person.user.role]},{" "}
                    {person.onboardingStatus === "SENT_BACK" ? "sent back" : "submitted"}
                    {person.submittedAt ? ` ${formatDate(person.submittedAt)}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </NoticeBox>
        </div>
      )}

      <form className="mb-6 flex flex-wrap items-end gap-3" action="/admin/accounts">
        <div>
          <label htmlFor="q" className="mb-1 block text-xs font-medium text-ink-700">
            Search
          </label>
          <input
            id="q"
            name="q"
            defaultValue={q}
            placeholder="Name, employee ID or email"
            className="rounded-lg border border-ink-300/60 bg-white px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label htmlFor="role" className="mb-1 block text-xs font-medium text-ink-700">
            Role
          </label>
          <select
            id="role"
            name="role"
            defaultValue={params.role ?? ""}
            className="rounded-lg border border-ink-300/60 bg-white px-3 py-2 text-sm"
          >
            <option value="">Every role</option>
            {(Object.keys(ROLE_LABELS) as Role[]).map((role) => (
              <option key={role} value={role}>
                {ROLE_LABELS[role]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="show" className="mb-1 block text-xs font-medium text-ink-700">
            Showing
          </label>
          <select
            id="show"
            name="show"
            defaultValue={showing}
            className="rounded-lg border border-ink-300/60 bg-white px-3 py-2 text-sm"
          >
            <option value="active">In use</option>
            <option value="disabled">Turned off</option>
            <option value="all">Both</option>
          </select>
        </div>
        <button
          type="submit"
          className="rounded-lg border border-ink-300/60 bg-white px-4 py-2 text-sm font-medium hover:bg-surface"
        >
          Apply
        </button>
      </form>

      <TableShell>
        <Thead>
          <tr>
            <Th>Person</Th>
            <Th>Role</Th>
            <Th>State</Th>
            <Th>Signed in</Th>
            <Th />
          </tr>
        </Thead>
        <Tbody>
          {rows.length === 0 && <TableEmpty colSpan={5}>No account matches that.</TableEmpty>}
          {rows.map((row) => (
            <tr key={row.id}>
              <Td>
                <div className="text-ink-900">
                  {row.employee ? (
                    <Link href={`/hr/employees/${row.employee.id}`} className="text-brand-500 hover:underline">
                      {row.employee.fullName}
                    </Link>
                  ) : (
                    // The first Super Admin was created at installation and has
                    // no employee record. §3 says so, and the page has to be
                    // able to show it rather than crashing on the exception.
                    <span className="text-ink-500">No employee record</span>
                  )}
                </div>
                <div className="text-xs text-ink-400">{row.email}</div>
                {row.employee?.employeeId && (
                  <div className="text-xs tabular text-ink-400">{row.employee.employeeId}</div>
                )}
              </Td>
              <Td>{ROLE_LABELS[row.role]}</Td>
              <Td>
                <div className="flex flex-wrap gap-1">
                  {row.disabledAt ? (
                    <Badge tone="neutral">Turned off {formatDate(row.disabledAt)}</Badge>
                  ) : (
                    <Badge tone="success">In use</Badge>
                  )}
                  {row.employee?.status === "LEFT" && <Badge tone="neutral">Left</Badge>}
                  {row.employee && row.employee.onboardingStatus !== "APPROVED" && (
                    <Badge tone="warn">Behind the locked door</Badge>
                  )}
                  {row.mustChangePassword && <Badge tone="warn">Temporary password</Badge>}
                </div>
              </Td>
              <Td className="whitespace-nowrap text-xs text-ink-500">
                {row.sessions.length > 0
                  ? `${row.sessions.length} open ${row.sessions.length === 1 ? "session" : "sessions"}`
                  : "—"}
                {row.tempPasswordExpiresAt && (
                  <div className="text-ink-400">
                    Password expires {formatDateTime(row.tempPasswordExpiresAt)}
                  </div>
                )}
              </Td>
              <Td>
                <AccountControls
                  userId={row.id}
                  disabled={row.disabledAt !== null}
                  role={row.role}
                  isSelf={row.id === context.user.id}
                />
              </Td>
            </tr>
          ))}
        </Tbody>
      </TableShell>

      {pages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm">
          <span className="text-ink-500">
            Page {page} of {pages}
          </span>
          <div className="flex gap-2">
            {page > 1 && <PageLink params={params} page={page - 1} label="Previous" />}
            {page < pages && <PageLink params={params} page={page + 1} label="Next" />}
          </div>
        </div>
      )}

      <Card className="mt-8 p-5 text-sm text-ink-700">
        <h2 className="mb-2 text-sm font-semibold text-ink-900">Two things this page cannot do</h2>
        <ul className="list-disc space-y-1 pl-5 text-ink-500">
          <li>
            {/* Restated on the screen because it is the row people try to
                "fix", and a Super Admin who does not know it is deliberate
                will file it as a bug. */}
            It cannot show bank details. The Super Admin approves and oversees;
            the people who need account numbers to do their job are in HR (§9).
          </li>
          <li>
            It cannot delete anything. An account is turned off and keeps its
            history — a brokerage that cannot produce a former employee&rsquo;s file
            when asked has a real problem.
          </li>
        </ul>
      </Card>
    </main>
  );
}

function PageLink({
  params,
  page,
  label,
}: {
  params: Record<string, string | undefined>;
  page: number;
  label: string;
}) {
  const query = new URLSearchParams(
    Object.entries({ ...params, page: String(page) }).filter(([, v]) => v) as [string, string][],
  );
  return (
    <Link
      href={`/admin/accounts?${query.toString()}`}
      className="rounded-lg border border-ink-300/60 bg-white px-3 py-1.5 text-sm hover:bg-surface"
    >
      {label}
    </Link>
  );
}
