# FCSL HR Management System

[![Next.js](https://img.shields.io/badge/Next.js-16.4-black?logo=next.js)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19.1-blue?logo=react)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Prisma](https://img.shields.io/badge/Prisma-6.12-2D3748?logo=prisma)](https://www.prisma.io/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4.1-38B2AC?logo=tailwind-css)](https://tailwindcss.com/)
[![Vitest](https://img.shields.io/badge/Vitest-5.0-6E9F18?logo=vitest)](https://vitest.dev/)

An enterprise-grade Human Resource Management system engineered for **First Capital Securities Limited (FCSL)**, a stock brokerage in Bangladesh regulated by the Bangladesh Securities and Exchange Commission (**BSEC**).

This system manages the end-to-end employee lifecycle, compliance paper trails, hierarchical leave approval chains, branch attendance sheets, and permanent audit logging.

---

## 📑 Table of Contents

- [Core Principles & Architectural Rules](#-core-principles--architectural-rules)
- [The Five User Roles](#-the-five-user-roles)
- [System Features](#-system-features)
  - [The Locked Door (Onboarding Gate)](#the-locked-door-onboarding-gate)
  - [Three-Tier Leave Approval Chain](#three-tier-leave-approval-chain)
  - [Private Document Storage & Auto-Compression](#private-document-storage--auto-compression)
  - [Immutable Permanent Audit Trail](#immutable-permanent-audit-trail)
  - [Branch Attendance & Monthly Reports](#branch-attendance--monthly-reports)
  - [BSEC Associate (RM) Certificate Tracking](#bsec-associate-rm-certificate-tracking)
- [Technology Stack](#-technology-stack)
- [Project Directory Structure](#-project-directory-structure)
- [Getting Started](#-getting-started)
  - [Prerequisites](#prerequisites)
  - [Environment Setup](#environment-setup)
  - [Database Migration & Seeding](#database-migration--seeding)
  - [Running the Application](#running-the-application)
- [Testing & Quality Assurance](#-testing--quality-assurance)
- [Production Deployment (Vercel & Supabase)](#-production-deployment-vercel--supabase)

---

## 🏛 Core Principles & Architectural Rules

1. **Centralized Authorization**: Permissions are checked exclusively through `lib/permissions.ts` using capabilities (e.g., `can(viewer, "leave.approve")`), never by inline role string comparisons.
2. **Deny by Default**: Any capability not explicitly granted is refused.
3. **Database-Validated Sessions**: Role and permissions are loaded from the database on every request, never trusted from cookies. Cookies store `{ userId, sid }` only.
4. **Strict Asia/Dhaka Timezone**: All calendar calculations, attendance deadlines, and timestamps use `Asia/Dhaka` via `lib/dates.ts`.
5. **No Destructive Deletes**: Employees who leave are marked with a departure date and status `LEFT`; their historical records remain intact for regulatory compliance. Wrong documents are superseded, never removed.
6. **Immutable Audit Trail**: Every critical action and its audit row are committed in a single atomic transaction. In production, SQL triggers reject `UPDATE`, `DELETE`, or `TRUNCATE` operations on audit tables.

---

## 👥 The Five User Roles

| Role | Operational Scope & Landing Page |
|---|---|
| **`SUPER_ADMIN`** | Landing: `/admin/approvals`. Final approval authority on all leave requests and requisitions across the company, user account management, permanent audit logs (`/admin/audit`), and monthly executive absence reports (`/admin/month`). |
| **`HR_HEAD`** | Landing: `/hr/joiners`. Document approvals, leave balance adjustments, holiday calendar, branch management, trading terminals, compliance show-causes, and department configurations. |
| **`HR_EXECUTIVE`** | Landing: `/hr/joiners`. Account creation, joiner onboarding checks, leaver clearance processing, bulk employee imports. |
| **`MANAGER`** | Landing: `/team/approvals`. First-step leave approver for direct reports, branch monthly attendance submission, and requisition drafting. |
| **`EMPLOYEE`** | Landing: `/me/profile`. Personal profile, document uploads, leave requests, attendance history, emergency contact proposals, and calendar notes. *(Includes Associates / BSEC Authorised Representatives)*. |

> **Note on Associates**: In code, BSEC-licensed Authorised Representatives are stored as `Employee.staffType = "RM"`. On screens, they are presented as **Associates** with automatic 4-month certificate renewal tracking.

---

## 🚀 System Features

### The Locked Door (Onboarding Gate)
When an account is created, the user is placed at **Stage 1 (`DRAFT`)**. Every page behind the dashboard checks onboarding status. The employee can access only the document upload screen until HR accepts their required documents.

### Three-Tier Leave Approval Chain
Every leave application progresses through a strict sequential hierarchy:
```
Executive / Associate ──► Manager ──► HR Head ──► Super Admin (Final Grant)
Manager / HR Executive ─────────────► HR Head ──► Super Admin (Final Grant)
HR Head ────────────────────────────────────────► Super Admin (Final Grant)
```
* **One step at a time**: Applications sit in only one approver inbox at a time.
* **Denials stop the chain**: If any level denies a request, the request terminates immediately with a mandatory reason.
* **Paid vs. Unpaid Grant**: The Super Admin decides at the final step whether the absence is granted with pay (deducting from entitlement) or without pay.

### Private Document Storage & Auto-Compression
* **Private & Protected**: Files are stored under private UUID keys with no public URLs. Document reads route through `/api/download`, checking authorization and recording an audit trail.
* **Automatic Client Image Compression**: High-resolution smartphone scans of National ID (NID) and certificates (6–10 MB) are automatically compressed on upload to ~300 KB via Sharp, preserving quality while minimizing storage costs.
* **Dual Driver**: Local disk storage (`storage/`) in development; private Supabase S3 bucket (`hrm-documents`) in production.

### Immutable Permanent Audit Trail
Tracks sign-ins, document acceptances, leave decisions, role promotions, and profile changes with IP addresses and actor snapshots.

### Branch Attendance & Monthly Reports
Branch managers submit attendance sheets monthly. HR reviews, verifies discrepancies, and publishes the closed sheets.

### BSEC Associate (RM) Certificate Tracking
Monitors Authorised Representative regulatory licenses, triggering visual countdown indicators 4 months prior to expiry without impeding daily operations.

---

## 🛠 Technology Stack

* **Framework**: [Next.js 16](https://nextjs.org/) (App Router, Turbopack, React Server Components & Server Actions)
* **UI & Styling**: [React 19](https://react.dev/), [Tailwind CSS v4](https://tailwindcss.com/)
* **Language**: [TypeScript 5.8](https://www.typescriptlang.org/) (Strict mode)
* **Database & ORM**: PostgreSQL 17, [Prisma ORM 6.12](https://www.prisma.io/)
* **Security & Auth**: HS256 JWT sessions via [jose](https://github.com/panva/jose), bcryptjs password hashing, HTTP-only SameSite cookies
* **Image Processing**: [Sharp](https://sharp.pixelplumbing.com/)
* **Testing**: [Vitest 5.0](https://vitest.dev/)

---

## 📂 Project Directory Structure

```text
├── app/
│   ├── actions/            # Server Actions (auth, leave, attendance, etc.)
│   ├── admin/              # Super Admin screens (approvals, month, audit, accounts)
│   ├── api/                # Route handlers (upload, download, export, cron)
│   ├── hr/                 # HR Head & Executive screens (joiners, employees, exits)
│   ├── me/                 # Employee self-service screens (profile, documents, leave)
│   ├── team/               # Manager team screens (approvals, roster, attendance)
│   ├── signin/             # Authentication landing page
│   └── set-password/       # Password setup & reset screen
├── components/
│   ├── approvals/          # Leave & requisition decision inboxes
│   ├── auth/               # SignInForm and SetPasswordForm
│   ├── hr/                 # Onboarding review, account forms, employee filters
│   ├── ui/                 # Reusable design system components (Card, Table, Field, PasswordInput)
│   └── icons.tsx           # Custom hand-crafted stroke SVG icon set
├── lib/
│   ├── auth.ts             # Session verification and request memoization
│   ├── db.ts               # Prisma client singleton
│   ├── dates.ts            # Asia/Dhaka date arithmetic
│   ├── permissions.ts      # Role capability matrix and visible query scoping
│   ├── storage.ts          # Storage driver (local folder & Supabase S3)
│   ├── leave-service.ts    # FIFO entitlement deduction & balance computation
│   └── audit.ts            # Audit logging utilities
├── prisma/
│   ├── schema.prisma       # Database schema models
│   ├── seed.ts             # Initial setup seeder
│   └── migrations/         # Version-controlled SQL migrations
└── docs/                   # System breakdown specifications and deployment guides
```

---

## 🚀 Getting Started

### Prerequisites
* **Node.js**: v20.x or higher
* **PostgreSQL**: v16 or v17 (Local instance or Supabase project)
* **npm** or **pnpm**

### Environment Setup
Copy the example environment configuration:
```bash
cp .env.example .env
```

Configure the following essential variables in `.env`:
```env
# Database Connections (Transaction pooler for app, direct/session pooler for migrations)
DATABASE_URL="postgresql://postgres:password@localhost:5432/fcsl_hrm?schema=public"
DIRECT_URL="postgresql://postgres:password@localhost:5432/fcsl_hrm?schema=public"

# App & Security
SESSION_SECRET="your-secure-random-64-character-string"
APP_URL="http://localhost:3000"

# Initial Bootstrap Super Admin (Created during seed)
ADMIN_EMAIL="admin@fcslbd.com"
ADMIN_PASSWORD="StrongInitialPassword123!"
ADMIN_NAME="Administrator"

# Storage (Leave empty for local disk storage in development)
SUPABASE_URL=""
SUPABASE_SERVICE_ROLE_KEY=""
SUPABASE_BUCKET="hrm-documents"
```

### Database Migration & Seeding
Run migrations and load base company lookups (branches, designations, grades, default leave rules):
```bash
npm run db:migrate
npm run db:seed
```

### Running the Application
Start the development server with Turbopack:
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 🧪 Testing & Quality Assurance

Run the Vitest unit test suite (evaluates arithmetic, permissions, CSV generation, leave calculations, and image scaling):
```bash
npm test
```

Perform static type checking:
```bash
npm run typecheck
```

Run end-to-end regression verification scripts:
```bash
npm run qa:e2e
npm run qa:chain
npm run qa:regressions
```

---

## 🚢 Production Deployment (Vercel & Supabase)

1. **Vercel Region**: Configured to `bom1` (**Mumbai, India**) in `vercel.json` for proximity to Bangladesh.
2. **Database Alignment**: Ensure your production Supabase database is created in **Mumbai (`ap-south-1`)** or **Singapore (`ap-southeast-1`)** to maintain sub-15ms database query latency.
3. **Connection Pooling**:
   * Use the **Supabase Transaction Pooler** (port `6543`, `?pgbouncer=true`) for `DATABASE_URL`.
   * Use the **Session Pooler** (port `5432`) for `DIRECT_URL`.
4. **Storage Bucket**:
   * In Supabase Storage, create a bucket named `hrm-documents`.
   * Leave **Public access OFF** to ensure all employee files remain private and audited.
5. **Scheduled Jobs**:
   * Daily digests and certificate warnings run automatically via Vercel Cron at 02:00 UTC (08:00 AM Asia/Dhaka) hitting `/api/cron`.

---

## 📄 License

Proprietary software developed for **First Capital Securities Limited**. All rights reserved.
