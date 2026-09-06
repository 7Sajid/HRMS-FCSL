# FCSL HR Management System

An HR system for **First Capital Securities Limited**, a stock brokerage in Bangladesh regulated by BSEC. It holds people, their papers, their time off, and the company's decisions about them. It does not pay salaries.

The specification is `docs/System Breakdown v2.0.md` — *FCSL HR Management System — System Breakdown, version 2.0*, 3 September 2026, marked **Ready to build**. Section references throughout this file and in code comments point at it. Where this file and the spec disagree, the spec wins and this file is wrong.

## What this is not

It is **not** the FCSL Client's Portal. That is separate software with its own repository, database, storage and deployment, and nothing here imports from it or writes to it. The two share a visual language and a set of engineering habits, deliberately, so that an employee who uses both does not feel they have changed company between tabs. That is the whole of the relationship.

## The five kinds of user

`SUPER_ADMIN` · `HR_HEAD` · `HR_EXECUTIVE` · `MANAGER` · `EMPLOYEE`.

**RM is not a role.** A Relationship Manager — also called an Authorised Representative — uses exactly the same screens as any other employee. They are `Employee.staffType = "RM"`, which demands a stricter document list and attaches a BSEC certificate whose expiry the system watches. Say **RM**, not AR. The licence is the **RM certificate**.

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

The 412 staff imported from the existing spreadsheet enter directly at Stage 2 — they are already employed and their files already exist.

## The leave chain (§7.1)

Every leave application in the company ends at the Super Admin.

| Who applies | Step 1 | Step 2 | Step 3 |
|---|---|---|---|
| Employee / RM | Manager | HR Head | Super Admin |
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
- Leave types and their days are configured by the HR Head, seeded with Bangladesh Labour Act 2006 minimums. Never hardcoded, and each change is dated so last year's leave still computes on last year's rule.
- Employee ID is **`A XXX - YY - 70`**. `XXX` never resets and is never reused. The letter advances at 999. `YY` is the joining year. `70` is constant. The highest existing is `A 412 - 26 - 70`.
- The RM certificate warns **four months** before expiry and **never blocks** the person or their work.
- Documents are purged one year after the last working day; **the employee record is kept permanently** so headcount reports stay correct.
- Requisitions are raised by managers, HR and the Super Admin only. Employees and RMs ask their manager.
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
- Comments explain **why**, not what, and carry the decision and the alternative that was rejected.

## Build order

Foundation first, then one panel at a time, bottom-up: **Employee/RM → Manager → HR Executive → HR Head → Super Admin**. Each panel is finished and deployed before the next begins.

Accounts and the locked door are HR Executive jobs that only arrive at Panel 3, so `scripts/create-account.ts` and `scripts/approve-joiner.ts` do them from the terminal until then. Those scripts are permanent ops tools, not scaffolding — they are how you recover when a screen is broken at nine in the evening.

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

`fcsl_hrm` is the development database, `fcsl_hrm_test` is for the QA scripts. Both are local and hold no real staff data.

**`prisma migrate reset` asks for explicit human consent** and will not run unattended. That is correct — it drops every table — but it means a schema change during development is applied with `npm run db:migrate`, not by resetting.

Cloud hosting is deferred: Supabase free tier pauses a project after seven days idle and caps storage at 1 GB, which the 412 staff files would exceed. The decision was to build locally and move to Supabase Pro before go-live. Nothing in the code changes — `lib/storage.ts` already addresses files by key and falls back to a local folder when Supabase is not configured.
