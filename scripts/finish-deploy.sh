#!/usr/bin/env bash
#
# The last mile of the deployment — the two steps that need secrets only you
# can read out of the Supabase dashboard.
#
# Run it from the project root:
#
#   SUPABASE_DB_PASSWORD='…' \
#   SUPABASE_SERVICE_ROLE_KEY='…' \
#   bash scripts/finish-deploy.sh
#
# WHERE THE TWO VALUES COME FROM
#
#   SUPABASE_DB_PASSWORD      Supabase → Project Settings → Database.
#                             If you no longer have it, "Reset database
#                             password" there and use the new one.
#
#   SUPABASE_SERVICE_ROLE_KEY Supabase → Project Settings → API → service_role.
#                             NOT the publishable key. Nothing in this system
#                             talks to Supabase from a browser: every file read
#                             goes through app/api/download, which re-checks
#                             permission and writes a "document.viewed" line
#                             naming who looked at whose NID. A publishable key
#                             would let a signed-in browser reach storage
#                             directly and neither of those would happen.
#
# OPTIONAL
#
#   POOLER_HOST   Defaults to aws-0-ap-south-1.pooler.supabase.com, which is
#                 the one this project answers on. Supabase has shipped both
#                 aws-0- and aws-1- prefixes and BOTH resolve, so the wrong one
#                 fails at authentication rather than at DNS.
#
#   ADMIN_PASSWORD  The first Super Admin's password. Defaults to the one in
#                   the handover. Change it at first sign-in either way — a
#                   password that has been written down and sent to somebody is
#                   a handover credential, not a password.

set -euo pipefail

PROJECT_REF="deczituflljxeohekaov"
VERCEL_SCOPE="fcsl"
POOLER_HOST="${POOLER_HOST:-aws-0-ap-south-1.pooler.supabase.com}"
ADMIN_EMAIL="${ADMIN_EMAIL:-sadmanaiagent@gmail.com}"
ADMIN_NAME="${ADMIN_NAME:-Sadman}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-jHASEmRhBjz9Ss29bBXc}"

die() { printf '\n\033[31m✗ %s\033[0m\n\n' "$1" >&2; exit 1; }
step() { printf '\n\033[1m%s\033[0m\n' "$1"; }
ok() { printf '  \033[32m✓\033[0m %s\n' "$1"; }

[ -n "${SUPABASE_DB_PASSWORD:-}" ] || die "SUPABASE_DB_PASSWORD is not set. See the header of this file."
[ -n "${SUPABASE_SERVICE_ROLE_KEY:-}" ] || die "SUPABASE_SERVICE_ROLE_KEY is not set. See the header of this file."

# The password goes into a URL, so anything with a reserved character in it has
# to be percent-encoded or the URL parses wrongly and the failure is a confusing
# "authentication failed" rather than "your password has an @ in it".
ENCODED=$(python3 -c 'import sys,urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$SUPABASE_DB_PASSWORD")

# Both go through the pooler, and that is not a shortcut.
#
# Supabase's true direct host, db.<ref>.supabase.co, is IPv6-only unless the
# IPv4 add-on is bought — it has no A record at all, so on most networks it
# fails as "Can't reach database server", which reads like the database is
# down rather than like a missing feature. The SESSION pooler on 5432 is the
# supported substitute: it holds a connection for the whole session, which is
# what `prisma migrate` needs and what the transaction pooler cannot give.
#
# So: 6543 (transaction) for the application, 5432 (session) for migrations.
DIRECT="postgresql://postgres.${PROJECT_REF}:${ENCODED}@${POOLER_HOST}:5432/postgres"
POOLED="postgresql://postgres.${PROJECT_REF}:${ENCODED}@${POOLER_HOST}:6543/postgres?pgbouncer=true&connection_limit=5"

# ---------------------------------------------------------------------------
step "1 · Checking the database answers before changing anything"
DATABASE_URL="$DIRECT" DIRECT_URL="$DIRECT" npx prisma migrate status >/dev/null 2>&1 || true
if ! DATABASE_URL="$DIRECT" DIRECT_URL="$DIRECT" \
     npx prisma db execute --schema prisma/schema.prisma --stdin <<<'SELECT 1;' >/dev/null 2>&1; then
  die "Could not connect with that password. Check it, or reset it in Supabase → Project Settings → Database."
fi
ok "connected to $PROJECT_REF"

# ---------------------------------------------------------------------------
step "2 · Applying the migrations"
DATABASE_URL="$DIRECT" DIRECT_URL="$DIRECT" npx prisma migrate deploy
ok "schema, append-only trigger and reminder state applied"

# ---------------------------------------------------------------------------
step "3 · Proving the permanent record cannot be edited"
# This is the claim the whole system's credibility rests on, and it is checked
# against the REAL database rather than assumed from the migration having run.
if DATABASE_URL="$DIRECT" DIRECT_URL="$DIRECT" \
   npx prisma db execute --schema prisma/schema.prisma --stdin <<<'UPDATE "AuditEvent" SET action = '"'"'x'"'"';' >/dev/null 2>&1; then
  die "UPDATE on AuditEvent SUCCEEDED. The append-only trigger is not installed. Stop and investigate."
fi
ok "UPDATE is refused"
if DATABASE_URL="$DIRECT" DIRECT_URL="$DIRECT" \
   npx prisma db execute --schema prisma/schema.prisma --stdin <<<'DELETE FROM "AuditEvent";' >/dev/null 2>&1; then
  die "DELETE on AuditEvent SUCCEEDED. Stop and investigate."
fi
ok "DELETE is refused"
if DATABASE_URL="$DIRECT" DIRECT_URL="$DIRECT" \
   npx prisma db execute --schema prisma/schema.prisma --stdin <<<'TRUNCATE "AuditEvent";' >/dev/null 2>&1; then
  die "TRUNCATE on AuditEvent SUCCEEDED. Stop and investigate."
fi
ok "TRUNCATE is refused"

# ---------------------------------------------------------------------------
step "4 · Seeding, and creating the first Super Admin"
# Idempotent. Running it twice does not make a second Super Admin.
DATABASE_URL="$DIRECT" DIRECT_URL="$DIRECT" \
ADMIN_EMAIL="$ADMIN_EMAIL" ADMIN_NAME="$ADMIN_NAME" ADMIN_PASSWORD="$ADMIN_PASSWORD" \
npx tsx prisma/seed.ts

# ---------------------------------------------------------------------------
step "5 · Handing the secrets to Vercel"
set_env() {
  printf '%s' "$2" | npx vercel env add "$1" production --scope "$VERCEL_SCOPE" --force >/dev/null 2>&1 \
    && ok "$1"
}
# DATABASE_URL is the POOLER and DIRECT_URL is not. Pointing DATABASE_URL at
# 5432 exhausts the connection limit under serverless load; it has taken the
# sister project down once already.
set_env DATABASE_URL "$POOLED"
set_env DIRECT_URL "$DIRECT"
set_env SUPABASE_SERVICE_ROLE_KEY "$SUPABASE_SERVICE_ROLE_KEY"

# ---------------------------------------------------------------------------
step "6 · Deploying"
npx vercel deploy --prod --scope "$VERCEL_SCOPE" --yes

cat <<'DONE'

Done. Three things to do by hand, in this order:

  1. Supabase → Storage → New bucket → name it  hrm-documents  and leave
     PUBLIC OFF. The bucket holds scanned NIDs and bank details; public
     means reachable by URL for ever, with no sign-in and no audit line.

  2. Sign in as the Super Admin and change the password immediately.

  3. /admin/audit → filter to "Exports and system". The first line should
     read "First Super Admin created at installation". If it is not there,
     the seed did not run against this database.

DONE
