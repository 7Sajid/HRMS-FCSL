# Deploying FCSL HRM

**Status: LIVE.** https://fcsl-hrm-application-fcsl.vercel.app

| | State |
|---|---|
| GitHub `sadmanfcsl/FCSL-HRM-Application` | ✅ pushed, private |
| Vercel `fcsl-hrm-application` (team `fcsl`), region `bom1` | ✅ deployed, Git-linked |
| Supabase schema — 42 tables, 3 migrations | ✅ applied |
| Append-only log — UPDATE / DELETE / TRUNCATE | ✅ **all three refused in production** |
| Seed — 5 leave types, 6 settings, Fri+Sat weekly off, next ID `A 413` | ✅ |
| First Super Admin, signed in and verified | ✅ |
| Every environment variable | ✅ set on Production |
| `/api/cron` — 404 without the secret, runs with it | ✅ verified against production |
| Every panel route redirects a stranger to `/signin` | ✅ verified against production |
| Storage bucket `hrm-documents` | ⛔ **create it, PUBLIC OFF — document uploads fail until it exists** |

## Deployment protection

`ssoProtection` was `all_except_custom_domains`, the team default for new projects, which put Vercel's own login in front of everything — including `/api/cron`, which never reached the route even with the right secret. It is now `preview` :

- **Production** — public, guarded by the application's own sign-in. Every route redirects to `/signin`; nothing but the sign-in page is reachable without a session.
- **Preview** — still locked to the Vercel team.

To put production back behind Vercel's login:

```bash
curl -X PATCH -H "Authorization: Bearer $VERCEL_TOKEN" -H "Content-Type: application/json" \
  -d '{"ssoProtection":{"deploymentType":"all_except_custom_domains"}}' \
  "https://api.vercel.com/v9/projects/fcsl-hrm-application?teamId=team_AIbM9QXJaky539NXnVenaHc8"
```

## The one thing left

Supabase → Storage → **New bucket** → name it exactly `hrm-documents` → leave **Public OFF**.

Until it exists, everything works except uploading a document. Public would make every scanned NID and bank detail reachable by URL for ever, with no sign-in and no audit line.

## A gotcha worth remembering

**Supabase's direct host has no IPv4.** `db.<ref>.supabase.co` resolves to nothing on a v4-only network — `prisma migrate deploy` reports *"Can't reach database server"*, which reads like the database is down rather than like a missing add-on.

Both URLs therefore go through the pooler, and that is not a workaround:

- `DATABASE_URL` → **6543**, transaction pooler, `pgbouncer=true&connection_limit=5` — for the app
- `DIRECT_URL` → **5432**, *session* pooler — for migrations, which need a connection held for the whole session

Username is `postgres.<project-ref>`, not `postgres`. The host is `aws-0-ap-south-1.pooler.supabase.com`; `aws-1-` also resolves but rejects the credentials, so picking the wrong one fails at authentication rather than at DNS.

---|---|
| GitHub `sadmanfcsl/FCSL-HRM-Application` | ✅ pushed, private |
| Vercel `fcsl-hrm-application` (team `fcsl`) | ✅ created, Git-linked, region `bom1` |
| Supabase schema — 42 tables, 3 migrations | ✅ applied |
| Append-only log — UPDATE / DELETE / TRUNCATE | ✅ **all three refused in production** |
| Seed — 5 leave types, 6 settings, Fri+Sat weekly off, next ID `A 413` | ✅ |
| First Super Admin | ✅ created |
| `DATABASE_URL` · `DIRECT_URL` · `SESSION_SECRET` · `CRON_SECRET` · `SUPABASE_URL` · `SUPABASE_BUCKET` · `APP_URL` | ✅ set on Production |
| `SUPABASE_SERVICE_ROLE_KEY` | ⛔ **the only thing missing** |
| Storage bucket `hrm-documents` | ⛔ create it, PUBLIC OFF |
| First deploy | ⛔ blocked on the key |

`lib/storage.ts` throws at import time if storage is unconfigured on Vercel, so the build will fail until the key is set. That guard is deliberate and must not be relaxed: without it, uploads would silently fall back to local disk on a serverless filesystem, and every scanned NID would disappear at the next deploy.

```bash
printf '%s' 'YOUR_SERVICE_ROLE_KEY' | npx vercel env add SUPABASE_SERVICE_ROLE_KEY production --scope fcsl --force
npx vercel deploy --prod --scope fcsl --yes
```

## A gotcha worth remembering

**Supabase's direct host has no IPv4.** `db.<ref>.supabase.co` resolves to nothing on a v4-only network — `prisma migrate deploy` reports *"Can't reach database server"*, which reads like the database is down rather than like a missing add-on.

Both URLs therefore go through the pooler, and that is not a workaround:

- `DATABASE_URL` → **6543**, transaction pooler, `pgbouncer=true&connection_limit=5` — for the app
- `DIRECT_URL` → **5432**, *session* pooler — for migrations, which need a connection held for the whole session

Username is `postgres.<project-ref>`, not `postgres`. The host is `aws-0-ap-south-1.pooler.supabase.com`; `aws-1-` also resolves but rejects the credentials, so picking the wrong one fails at authentication rather than at DNS.

---|---|
| GitHub `sadmanfcsl/FCSL-HRM-Application` | ✅ pushed, private |
| Vercel `fcsl-hrm-application` (team `fcsl`) | ✅ created, Git-linked, region `bom1` |
| `SESSION_SECRET` · `CRON_SECRET` · `SUPABASE_URL` · `SUPABASE_BUCKET` · `APP_URL` | ✅ set on Production |
| Supabase project `FCSL-HRM-Application` | ✅ exists, healthy, empty |
| `DATABASE_URL` · `DIRECT_URL` · `SUPABASE_SERVICE_ROLE_KEY` | ⛔ need the database password and the service_role key |
| Migrations · seed · first deploy | ⛔ blocked on the above |

Everything still outstanding is one command:

```bash
SUPABASE_DB_PASSWORD='…' SUPABASE_SERVICE_ROLE_KEY='…' bash scripts/finish-deploy.sh
```

It connects, migrates, **proves the audit log refuses UPDATE, DELETE and TRUNCATE against the real database**, seeds the first Super Admin, hands the two secrets to Vercel, and deploys. It refuses to start if either secret is missing, and stops loudly if the append-only trigger is not in place.

The rest of this document is the reference for what that script does and why, and for the parts still done by hand.

---

## 0 · What you need in front of you

| Thing | Where it comes from |
|---|---|
| Supabase **database password** | Supabase → Project Settings → Database → *Reset database password* if you no longer have it |
| Supabase **service_role key** | Project Settings → API. **Not** the publishable key — uploads are written server-side |
| A GitHub login that can push to `sadmanfcsl/FCSL-HRM-Application` | — |
| A Vercel login | — |

The publishable key (`sb_publishable_…`) is **not used by this application**. Nothing here talks to Supabase from the browser: files go through `app/api/download`, which re-checks permission on every read and records the view. A publishable key would let a signed-in browser reach storage directly and neither of those would happen.

---

## 1 · GitHub

The remote is already configured:

```bash
git remote -v
```

This machine is authenticated to GitHub as **`sadman-0519`**, which cannot see `sadmanfcsl/FCSL-HRM-Application`. Pick one:

**Either** sign in as the account that owns the repo:

```bash
gh auth login
```

**Or** add `sadman-0519` as a collaborator on the repo in GitHub's settings.

Then:

```bash
git push -u origin master
```

---

## 2 · Supabase

### 2.1 The storage bucket

In the Supabase dashboard → Storage → **New bucket**:

- Name: `hrm-documents` — this is what `lib/storage.ts` defaults to, so naming it this means one less environment variable to get wrong
- **Public: OFF.** This matters more than any other setting on this page. The bucket holds scanned NIDs and bank details; a public bucket makes every one of them reachable by URL to anybody who has the URL, for ever, with no sign-in and no audit line.

### 2.2 Migrations

`prisma migrate deploy` needs the direct connection (port 5432), not the pooler. From this machine:

```bash
DATABASE_URL='postgresql://postgres:YOUR-PASSWORD@db.deczituflljxeohekaov.supabase.co:5432/postgres' \
DIRECT_URL='postgresql://postgres:YOUR-PASSWORD@db.deczituflljxeohekaov.supabase.co:5432/postgres' \
npx prisma migrate deploy
```

If the password contains `@ : / ? # [ ] %`, percent-encode it or the URL will be parsed wrongly.

Confirm all three migrations applied — the schema, the append-only trigger, and the reminder state:

```bash
DATABASE_URL='…' DIRECT_URL='…' npx prisma migrate status
```

### 2.3 The seed, and the first Super Admin

```bash
DATABASE_URL='…' DIRECT_URL='…' \
ADMIN_EMAIL='sadmanaiagent@gmail.com' \
ADMIN_NAME='Sadman' \
ADMIN_PASSWORD='…the one from the handover…' \
npx tsx prisma/seed.ts
```

This creates the leave types at Labour Act 2006 minimums, the Friday+Saturday weekly-off rule, the settings defaults, the placeholder org lists — and the one Super Admin account. That account is created **outside the normal process**, and the seed writes that fact permanently into the audit log, which is what §3 requires.

The seed is idempotent. Running it twice does not create a second Super Admin; it prints `• … already exists — left untouched`.

### 2.4 Prove the log cannot be edited

Do this once, against production, before anybody uses the system. It is the claim everything else rests on.

In Supabase → SQL Editor:

```sql
UPDATE "AuditEvent" SET action = 'x';
```

It must fail with `AuditEvent is append-only: UPDATE is not permitted`. Try `DELETE FROM "AuditEvent";` and `TRUNCATE "AuditEvent";` too. All three must be refused.

---

## 3 · Vercel

Import `sadmanfcsl/FCSL-HRM-Application` from the Vercel dashboard, or:

```bash
npx vercel login
npx vercel link --project fcsl-hrm-application
```

### 3.1 Environment variables

Set these for **Production** (and Preview, if you want previews to work). `DATABASE_URL` and `DIRECT_URL` must be present at **build** time, because the build runs the migrations.

| Variable | Value |
|---|---|
| `DATABASE_URL` | The **pooler**: `postgresql://postgres.deczituflljxeohekaov:PASSWORD@aws-0-<region>.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=5` |
| `DIRECT_URL` | The **direct** connection on 5432, as in §2.2 |
| `SESSION_SECRET` | From the handover. Changing it later signs everybody out |
| `SUPABASE_URL` | `https://deczituflljxeohekaov.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Project Settings → API → `service_role`. Server-side only — never `NEXT_PUBLIC_` anything |
| `SUPABASE_BUCKET` | Only if you named the bucket something other than `hrm-documents` |
| `APP_URL` | The production URL. Used to build links in emails |
| `CRON_SECRET` | From the handover. **Leave it unset and the scheduled jobs do not run at all** — `/api/cron` answers 404 to everybody, including Vercel. That is deliberate |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Only needed if you seed from Vercel rather than from a laptop. Better not to set them there at all |
| `SMTP_HOST` etc. | Optional. With `SMTP_HOST` empty the system works fully and simply sends no email |

**`DATABASE_URL` must be the pooler and `DIRECT_URL` must not.** Pointing `DATABASE_URL` at 5432 exhausts the connection limit under load; this has taken the sister project down once already.

### 3.2 Region

`vercel.json` pins `sin1` (Singapore) to sit next to the database. Nothing to do.

### 3.3 The scheduled jobs

`vercel.json` declares one cron at `0 2 * * *` — **02:00 UTC, which is 08:00 in Dhaka**, because §8 asks for a *morning* summary. One entry rather than six: `runJobs` already runs them in order with the digest last, so a single schedule gets the ordering for free and does not spend the cron allowance that Vercel's cheaper plans meter.

Cron is a **Pro** feature. On Hobby the app works completely; the certificate warnings, attendance chasing, escalations and the morning digest simply never fire, and the bell still fills up correctly because those notifications are written by the actions themselves.

After the first deploy, prove the endpoint is shut:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://YOUR-APP.vercel.app/api/cron
```

Must be `404`. Then, with the secret:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://YOUR-APP.vercel.app/api/cron?job=digest
```

---

## 4 · First sign-in

1. Open the production URL and sign in as the Super Admin.
2. **Change the password immediately** — the seed password has been written down and shared, which makes it a handover credential, not a password.
3. `/admin/audit` → filter to **Exports and system**. The first line should be *"First Super Admin created at installation"*. If it is not there, the seed did not run against this database.
4. Create the HR Head from `/hr/accounts/new`. Their temporary password is displayed **once** and is dictated to them by a person — it is never emailed. It expires in seven days and forces a change on first use.
5. The HR Head then sets up branches, the year's public holidays, and the real departments, designations and grades in `/hr/settings`.
6. Import the 412 staff from `/hr/import` — dry-run first, which writes nothing and reports every bad row. Afterwards the ID counter continues from the highest imported number.

---

## 5 · Rolling back

Migrations are forward-only and `prisma migrate reset` **drops every table**, so it is not a rollback — it is a rebuild. If a deploy is bad, roll back the Vercel deployment; the database schema is additive and older code runs against it.

The one thing that cannot be undone is the document purge, which deletes files by design. It only ever touches an exit whose `documentsPurgeAfter` has passed, and it keeps every document row so the file's existence and its history stay readable.
