# FCSL HR Management System

An HR system for **First Capital Securities Limited**, a stock brokerage in Bangladesh regulated by BSEC. It holds people, their papers, their time off, and the company's decisions about them. It does not pay salaries.

The specification is `docs/System Breakdown v2.0.md` — *FCSL HR Management System — System Breakdown, version 2.0*, 3 September 2026, marked **Ready to build**. Section references throughout this file and in code comments point at it. Where this file and the spec disagree, the spec wins and this file is wrong.

## What this is not

It is **not** the FCSL Client's Portal. That is separate software with its own repository, database, storage and deployment, and nothing here imports from it or writes to it. The two share a visual language and a set of engineering habits, deliberately, so that an employee who uses both does not feel they have changed company between tabs. That is the whole of the relationship.

## The five kinds of user

`SUPER_ADMIN` · `HR_HEAD` · `HR_EXECUTIVE` · `MANAGER` · `EMPLOYEE`.

**Associate is not a role.** An Associate — the person BSEC licenses as an Authorised Representative — uses exactly the same screens as any other employee. They are `Employee.staffType = "RM"`, which demands a stricter document list and attaches a BSEC certificate whose expiry the system watches. Say **Associate**, never RM or AR. The licence is the **Associate certificate**.

**The words on screen are not the words in the database** (FCSL, 16 September 2026). FCSL renamed two things and neither rename reached the schema, because renaming an enum in place rewrites every row for a difference nobody can see:

| On screen | Stored as |
|---|---|
| Executive | `Employee.staffType = "STAFF"` |
| Associate | `Employee.staffType = "RM"` |
| Executive (the role) | `Role.EMPLOYEE` |

So `StaffType`, `RmCertificate`, `RM_CERTIFICATE` and `staffType` keep their names in code, and the translation happens at the edges: `ROLE_LABELS`, the screens, the CSV export, and the importer — which accepts *Executive* and *Associate* as well as the older *STAFF* and *RM*, so a spreadsheet drafted against the old template still lands correctly. The general word for everybody is **employee**; an Associate is an employee who is not an executive.

A person can be more than one thing at once: a Branch Manager is also an employee who takes leave. So each person carries one job title plus a set of powers, never a single box.

## The rules that hold everywhere

1. **Authorisation is asked of `lib/permissions.ts`, never inferred from a role string.** An inline `user.role === "HR_HEAD"` is a bug even when it produces the right answer, because it is a rule written in a place nobody will think to check when the rules change.
2. **Deny by default.** A capability nobody is granted is a capability nobody has.
3. **The role comes from the database on every request**, never from the session cookie. The cookie carries `{ userId, sid }` and nothing else. An authorisation decision must never be made from a value the holder could influence or that could simply be stale.
4. **Dates are Asia/Dhaka, always**, through `lib/dates.ts`. Vercel runs UTC, six hours behind. A bare `toLocaleString()` is banned.
5. **An action and its audit row are one transaction.** If the log write fails, the action rolls back. `record({ ..., tx })` takes the transaction client; `recordQuietly()` is only for observations *around* an action — a sign-in, an export — where refusing the action because the log is unavailable would punish the wrong person.
6. **Anything a person is told, they are told the reason for.** The spec refuses an empty denial reason and so does the code.
7. **Nothing unbounded reaches a page.** Every list is paged; every count is capped.
8. **Nothing is ever deleted.** A wrong document is superseded, not removed. A person who leaves is marked `LEFT` on a date and their record stays whole — a brokerage that cannot produce a former employee's file when asked has a real problem. The single exception is the one-year document purge in §12, which removes the *files* and keeps the *record*.
9. **`lib/` has no React.** Domain logic must be callable from a script, a test or a cron job.
10. **Every export in a `"use server"` file is a callable HTTP endpoint.** Do not put helpers in one.

## The locked door (§3)

When an account is created the person can do exactly one thing: upload their documents. Everything else stays locked until the level above approves them. `Employee.onboardingStatus` is `DRAFT → SUBMITTED → APPROVED`, with `SENT_BACK` when HR returns specific documents.

This is a **lock, not a hidden menu**. Hiding a nav item stops an ordinary user; it does not stop anyone determined, and an auditor will ask which of the two you built. Every page guards itself.

The 412 employees imported from the existing spreadsheet enter directly at Stage 2 — they are already employed and their files already exist.

## The leave chain (§7.1)

Every leave application in the company ends at the Super Admin.

| Who applies | Step 1 | Step 2 | Step 3 |
|---|---|---|---|
| Executive / Associate | Manager | HR Head | Super Admin |
| Manager | HR Head | Super Admin | — |
| HR Executive | HR Head | Super Admin | — |
| HR Head | Super Admin | — | — |
| Super Admin | recorded directly | | |

Three rules, and they are the part most likely to cause an argument later:

- **One step at a time, in order.** The application sits in exactly one inbox. Nobody skips a step or approves out of turn.
- **A denial stops the chain dead.** Whoever denies it ends it. The applicant is told with the reason; **nobody above that point is ever notified**, because as far as the chain is concerned the request no longer exists.
- **Final approval is the only moment leave is granted.** The applicant *and every approver along the way* are told together, and only then do the days come off the balance.

## Things that are settled and must not be re-litigated (§12)

- Weekly off is **Friday and Saturday**. Public holidays are entered yearly by the HR Head.
- **The screens say "Branch attendance", not "Attendance"** (FCSL, 2 October 2026). Every heading, menu item and page title where the monthly sheet is filled in, checked, published or reported — plus the audit labels, the settings row and the nightly chaser. Two deliberate exceptions, because repeating the word says nothing: the report's per-branch table keeps a column headed *Attendance* beside its *Branch* column, and the employee's own page keeps **"Leave & attendance"** and **"My attendance"** — that is their own month, not the branch's sheet. URLs, `AttendanceSheet` and the `attendance.*` capabilities are unchanged; this is wording, not structure.
- Leave types and their days are configured by the HR Head. Never hardcoded, and each change is dated so last year's leave still computes on last year's rule. FCSL's figures (10 September 2026): **casual 6, sick 6, earned 20 with no carry-forward**, maternity 16 weeks, leave without pay.
- **Each person's leave year runs from their joining date**, not 1 January (FCSL, 10 September 2026).
- **Probation** is the first year, or until HR's confirmation date. Casual and sick leave can be taken during it, but the days come out of the first permanent year — one bucket whose window runs from the joining date to the end of that year. Earned leave opens when probation ends. Which type does which is `LeaveType.probation`, the HR Head's setting.
- **The Super Admin says whether each leave is paid** (FCSL, 1 October 2026) — every application, from anybody: probationer, permanent, intern. Two buttons at the final step, *Grant with pay* and *Grant without pay*, and the library refuses to grant without one of them rather than defaulting. **Paid** consumes entitlement exactly as before; **unpaid** writes the `LeaveDay` rows but no `LeaveDayEntitlement` rows, so the absence is on the calendar and the attendance sheet while nothing comes off any balance. `LeaveRequest.paid` records it. A type that grants no days (leave without pay) cannot be granted *with* pay. This is the half that makes the probation rule fair: a probationer's paid days are advanced against their first permanent year, and days granted without pay cost them nothing later.
- **The designations are FCSL's own 16** (FCSL, 2 October 2026): Intern · Junior Executive · Executive · Senior Executive · Assistant Manager · Manager · Department Head · Divisional Manager · Deputy General Manager · AGM · General Manager · Senior General Manager · CEO · COO · Deputy CEO · Deputy COO. Singular, because a designation is one person's job title. `Designation` carries **no rank** — these sort alphabetically everywhere.
- **Manager and Department Head are the same rank.** Every department head is a manager; most managers are not. Which manager heads which department is **not** the designation — it is `Department.headId`, the HR Head's to set on the settings screen. A promotion into or out of heading a department changes one dropdown and no job title. The same shape as `Branch.branchManagerId`, which is why "Branch Manager" is not a designation either.
- **The grades are FCSL's own 21** (FCSL, 2 October 2026): `AR1a` `AR1b` `AR1c` · `AR2a` `AR2b` `AR2c` · `AR3a` `AR3b` `AR3c` · `AD1a` `AD1b` `AD1c` · `AD2a` `AD2b` `AD2c` · `AD3a` `AD3b` `AD3c` · `AD4a` `AD4b` `AD4c`. There are no others. They live in the database because the 412-row import matches the spreadsheet's Grade column against them **by name**, and a grade that is absent does not fail the import — the person arrives with no grade at all. `Grade.rank` is seniority and is **provisional**, following the order FCSL listed them in; FCSL has not yet said which end is the top, and nothing reads it but the sort order of "headcount by grade".
- Employee ID is **`A XXX - YY - 70`**. `XXX` never resets and is never reused. The letter advances at 999. `YY` is the joining year. `70` is constant. The highest existing is `A 412 - 26 - 70`.
- The Associate certificate warns **four months** before expiry and **never blocks** the person or their work.
- Documents are purged one year after the last working day; **the employee record is kept permanently** so headcount reports stay correct.
- Requisitions are raised by **managers, department heads and the HR Head only** (FCSL, 10 September 2026). Executives, Associates and HR Executives ask their manager. The HR Head's own requisition goes straight to the Super Admin.
- **Every requisition ends at the Super Admin** (FCSL, 1 October 2026) — manager → HR Head → Super Admin, whatever it costs. The ৳50,000 escalation threshold is gone; it decided nothing for three of the four types, which carry no amount at all. `Requisition.escalationThreshold` is kept as history on the rows that travelled under it, and the setting row is deleted.
- **An approval is not the end of a requisition.** The HR Head names the department that will action it *as they approve* (on their own requisition, which skips their desk, they name it when raising). On final approval the raiser, the HR Head and that department's head are told together, and the department head marks it delivered. `Department.headId` says who that is — **a manager with one more list, never a new role**, because a role per department is a role added every time a department is, each one needing its own line in the permission table and the leave chain.
- **"My team" is for managers, department heads and the HR Head.** The HR Executive and the Super Admin have no team section (FCSL, 10 September 2026).
- **The permanent record (`/admin/audit`) is the Super Admin's alone.** The HR Head does not read it (FCSL, 10 September 2026).
- **Out of scope:** payroll, recruitment, appraisal, personal-trading surveillance, punch machines, SMS, Bangla, a mobile app, and any connection to the back office.
- Reading NIDs with AI is **deferred**. HR types the fields manually. The schema leaves room for the amber-dot confirmation flow to arrive later.

## Privacy (§9)

Two rows are easy to get wrong and both are deliberate:

- **The Super Admin cannot see bank details.** The Super Admin approves and oversees; the people who need account numbers to do their job are in HR. This is why bank details live in their own table — an accidental `employee.findMany()` cannot leak them.
- **The Super Admin does not verify or publish attendance.** That is HR's job.

And one that is absolute: **nobody at any level can read somebody else's private notes**, the Super Admin included. A notepad management can read is not a notepad, and people will simply not use it.

## Conventions

- **Server Actions for every mutation**, in `app/actions/`, one file per area. Route handlers only for multipart upload, authorised file reads and CSV export.
- Actions return `{ ok: true, ... }` or `{ error: string, field?: string }` — they do not throw for user-facing failures. Pages redirect; actions return a readable message.
- Zod validates shape, in `lib/*-schema.ts`, one per form. Cross-field rules are hand-written.
- Prisma: models PascalCase, fields camelCase, no `@map`. `cuid()` ids. `@db.Timestamptz(3)` for instants, `@db.Date` for calendar dates. Nullable timestamps as state (`disabledAt`, `revokedAt`, `retiredAt`) rather than booleans — *when* is a question HR will ask.
- Every historical row carries the actor's id **and** a denormalised `…ByName` snapshot, so the record still reads correctly after the account changes or is disabled.
- `prisma db push` is **banned**. The audit trigger and the partial unique indexes are hand-written SQL that `db push` would silently drop.
- **A new table is published to the internet unless something stops it.** Supabase's Data API serves the whole `public` schema to whoever holds the publishable key, and its default privileges grant every table `postgres` creates to `anon`. On 16 September 2026 all 42 were readable and writable that way. `20260916071500_close_the_data_api` revoked the grant, revoked the default so later tables do not inherit it, and turned RLS on everywhere — `ENABLE`, never `FORCE`, because the owner is the application. A new model needs nothing extra, but §32 of `qa-regressions` checks that, so run it after a migration that adds one.
- Comments explain **why**, not what, and carry the decision and the alternative that was rejected.

## Build order

Foundation first, then one panel at a time, bottom-up: **Executive/Associate → Manager → HR Executive → HR Head → Super Admin**. Each panel is finished and deployed before the next begins.

Accounts and the locked door are HR Executive jobs that only arrive at Panel 3, so `scripts/create-account.ts` and `scripts/approve-joiner.ts` do them from the terminal until then. Those scripts are permanent ops tools, not scaffolding — they are how you recover when a screen is broken at nine in the evening. `scripts/run-job.ts` joins them at Panel 5: it runs any scheduled job by hand, and `--on YYYY-MM-DD` moves the date the job *thinks* it is, so the certificate ladder can be checked without waiting four months for it.

## The scheduled jobs (§8)

`lib/jobs.ts`, called by `app/api/cron` on one daily Vercel Cron at 02:00 UTC — eight in the morning in Dhaka, because §8 asks for a *morning* summary. One schedule, not eight: `runJobs` already orders them with the digest last. The note reminders (FCSL, 10 September 2026) go to the bell only — never into the digest email, and never with the note's words.

Every job is **idempotent within a day**. `ReminderState` records what has already been said about each subject, so a Vercel retry, an overlapping deploy or somebody running it by hand does not send a second email. A warning that arrives twice is a warning people start deleting, which is the failure the register exists to prevent arriving by another route.

`CRON_SECRET` unset means the endpoint 404s and nothing runs. That is deliberate — see `.env.example`.

## Local development

```bash
npm install
cp .env.example .env      # fill in DATABASE_URL, DIRECT_URL, SESSION_SECRET
npm run db:migrate
npm run db:seed
npm run dev
```

`npm test` runs the Vitest suites over `lib/`. `npm run typecheck` is the gate before any commit.

## Local database

Postgres 17 via Homebrew, matching the version Supabase runs so nothing works here and then fails in production on a version difference.

```bash
brew services start postgresql@17
export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"
psql -d fcsl_hrm
```

`fcsl_hrm` is the development database, `fcsl_hrm_test` is for the QA scripts. Both are local and hold no real employee data.

**`prisma migrate reset` asks for explicit human consent** and will not run unattended. That is correct — it drops every table — but it means a schema change during development is applied with `npm run db:migrate`, not by resetting.

Production is Supabase project `FCSL-HRM-Application` in **ap-south-1 (Mumbai)**, with Vercel pinned to `bom1` to sit beside it — the two must match, and Singapore was the original guess before the project existed. Cloud hosting was deferred during the build: the Supabase free tier pauses a project after seven days idle and caps storage at 1 GB, which the 412 employees' files would exceed. The decision was to build locally and move to Supabase Pro before go-live. Nothing in the code changes — `lib/storage.ts` already addresses files by key and falls back to a local folder when Supabase is not configured.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
