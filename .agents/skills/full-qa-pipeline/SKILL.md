---
name: full-qa-pipeline
description: >-
  Orchestrates a comprehensive end-to-end Quality Assurance pipeline including linting, unit/component/E2E testing, browser UI/UX verification, accessibility, security audits, load testing (500 employees), and production builds. Acts as a passive auditor without modifying code.
---

# Full QA Pipeline

## Overview
This skill executes a complete Quality Assurance pipeline for the application. It acts as a strict auditor: it runs checks, identifies failures, rates them (Minor, Major, Urgent), and compiles a final QA REPORT. It **must not** stop the pipeline on errors and **must not** attempt to fix the errors unless explicitly given permission after the report.

Special focus is given to Technical Functionalities, File Management, Data Load Capacity, and Storage Load Capacity (simulating constraints for 500 employees).

## Dependencies
- `chrome-devtools`: Required to open the application in a browser to perform visual UI/UX QA, Responsive QA, and E2E testing.
- `a11y-debugging`: Required to audit accessibility compliance during the browser testing phase.
- `debug-optimize-lcp`: Required for performance QA and Core Web Vitals checks.

## Quick Start
"Run the full QA pipeline"

## Workflow
---
name: typescript-qa
description: Performs comprehensive QA for TypeScript, React, and Next.js applications including type safety, linting, unit tests, component tests, API tests, E2E browser testing, UI/UX, responsive design, accessibility, security, performance, regression testing, and production build validation.
---

# TypeScript / React / Next.js QA Skill

## Role

Act as a senior QA engineer, software test engineer, frontend engineer, security reviewer, and release engineer.

The goal is not simply to find errors.

The goal is to determine whether the application is:

- Functionally correct
- Type-safe
- Stable
- Secure
- Responsive
- Accessible
- Performant
- Production-ready
- Maintainable

Never assume that code is correct simply because it compiles.

---

# QA PRINCIPLES

Always:

1. Inspect the existing project before changing anything.
2. Understand the architecture.
3. Understand package.json scripts.
4. Inspect TypeScript configuration.
5. Inspect routing.
6. Inspect API integrations.
7. Inspect authentication and authorization.
8. Inspect state management.
9. Inspect forms and validation.
10. Inspect loading and error states.
11. Inspect responsive behavior.
12. Inspect accessibility.
13. Inspect performance.
14. Run automated tests.
15. Perform browser-based testing where appropriate.
16. Never hide or ignore failing tests.
17. Never modify tests simply to make them pass unless the test itself is demonstrably incorrect.
18. Do not make unrelated refactors during QA.
19. Separate defects from improvement suggestions.
20. Produce a structured QA report.

---

# PHASE 1 — PROJECT DISCOVERY

Before testing:

- Inspect package.json
- Inspect tsconfig.json
- Inspect eslint configuration
- Inspect framework configuration
- Inspect environment configuration
- Inspect src/app or src/pages
- Inspect API routes
- Inspect components
- Inspect hooks
- Inspect services
- Inspect utilities
- Inspect tests
- Inspect authentication
- Inspect middleware
- Inspect database/API integrations

Identify:

- Framework
- TypeScript version
- React version
- Next.js version
- Test framework
- E2E framework
- State management
- Styling system
- API architecture

Do not modify code during this phase.

Produce a short architecture summary.

---

# PHASE 2 — STATIC QUALITY CHECK

Run available project commands.

Prefer existing scripts from package.json.

Check:

- TypeScript compilation
- ESLint
- formatting
- unused variables
- unused imports
- unreachable code
- unsafe any
- incorrect type assertions
- missing return types where important
- nullable values
- undefined values
- promise handling
- async/await errors
- incorrect React hooks
- dependency issues

If no type-check script exists, use an appropriate TypeScript command based on the project configuration.

Do not assume the command.

Inspect package.json first.

---

# PHASE 3 — UNIT TEST QA

Identify critical business logic.

Prioritize:

- calculations
- validation
- formatting
- data transformation
- authentication helpers
- authorization helpers
- API utilities
- financial calculations
- state transitions
- utility functions

Create or improve tests where necessary.

Tests must cover:

### Happy path

Normal expected input.

### Boundary conditions

Minimum values.

Maximum values.

Empty values.

Large values.

Zero values.

### Invalid input

Wrong types.

Malformed values.

Missing fields.

Unexpected values.

### Error handling

Network errors.

API errors.

Timeouts.

Rejected promises.

---

# PHASE 4 — REACT COMPONENT QA

Inspect important components.

Test:

- rendering
- props
- state changes
- user interactions
- buttons
- forms
- modals
- dropdowns
- tables
- pagination
- filtering
- sorting
- loading states
- empty states
- error states

Verify:

- buttons are actually clickable
- forms validate correctly
- disabled states work
- loading indicators appear
- errors are visible
- state updates correctly

---

# PHASE 5 — API QA

For every important API:

Check:

- HTTP method
- request body
- query parameters
- headers
- authentication
- authorization
- response structure
- status codes
- validation
- error responses
- timeout behavior

Test:

200
201
400
401
403
404
409
422
429
500

where applicable.

Never expose:

- API keys
- secrets
- passwords
- tokens
- private credentials

in frontend code.

---

# PHASE 6 — E2E BROWSER QA

Use Playwright or the project's existing E2E framework.

Identify critical user journeys.

Examples:

1. Open website
2. Navigate pages
3. Login
4. Search
5. Filter
6. Open details
7. Submit form
8. Add item
9. Update item
10. Logout

Test the complete workflow rather than isolated components.

Verify:

- visible content
- navigation
- URL changes
- buttons
- forms
- validation
- API interactions
- loading states
- error states
- redirects

Take screenshots when useful.

---

# PHASE 7 — RESPONSIVE QA

Test at minimum:

Mobile:

375x812

390x844

Tablet:

768x1024

Desktop:

1366x768

1920x1080

Check:

- horizontal overflow
- broken layouts
- overlapping elements
- unreadable text
- broken navigation
- mobile menu
- table overflow
- modal overflow
- button sizing
- image scaling
- spacing
- typography

---

# PHASE 8 — ACCESSIBILITY QA

Check:

- semantic HTML
- keyboard navigation
- focus states
- labels
- form accessibility
- alt text
- ARIA usage
- color contrast
- heading hierarchy
- button accessibility
- link accessibility

Ensure interactive elements can be used without a mouse.

---

# PHASE 9 — SECURITY QA

Look for:

- XSS
- unsafe HTML rendering
- insecure authentication
- exposed secrets
- client-side authorization
- insecure API routes
- missing validation
- unsafe redirects
- token exposure
- sensitive data in localStorage
- excessive error information
- missing rate limiting where appropriate

Never attempt destructive security testing.

Report security concerns with severity.

---

# PHASE 10 — PERFORMANCE QA

Inspect:

- bundle size
- unnecessary renders
- large dependencies
- image optimization
- lazy loading
- code splitting
- API waterfalls
- excessive client-side JavaScript
- unnecessary requests
- caching opportunities

For Next.js applications inspect:

- Server Components
- Client Components
- dynamic imports
- image optimization
- metadata
- caching
- loading.tsx
- error.tsx

---

# PHASE 11 — ERROR STATE QA

Every important user action should have:

Loading state

Success state

Empty state

Error state

Retry mechanism where appropriate

Test network failures and unexpected API responses.

---

# PHASE 12 — REGRESSION QA

After fixing defects:

1. Re-run the failing test.
2. Re-run related tests.
3. Re-run the full test suite.
4. Run TypeScript checks.
5. Run ESLint.
6. Run production build.
7. Re-test critical browser workflows.

Do not consider a bug fixed until the original failure has been reproduced successfully and verified as resolved.

---

# PHASE 13 — PRODUCTION BUILD

Run the project's production build.

Verify:

- TypeScript passes
- lint passes
- tests pass
- build passes
- no unexpected warnings
- no missing environment variables
- no broken imports
- no production-only errors

---

# PHASE 14 - SEVERITY

Classify defects:

CRITICAL
Application cannot operate or serious security/data-loss issue.

HIGH
Major functionality is broken.

MEDIUM
Important functionality is degraded but workaround exists.

LOW
Minor defect or UI issue.

INFO
Improvement or recommendation.

---

# QA REPORT

Always produce:

## Executive Summary

Overall status:

PASS / PASS WITH ISSUES / FAIL

## Test Environment

Framework:

TypeScript:

Browser:

Viewport:

Environment:

## Automated Tests

TypeScript:
PASS/FAIL

ESLint:
PASS/FAIL

Unit:
PASS/FAIL

Component:
PASS/FAIL

API:
PASS/FAIL

E2E:
PASS/FAIL

Build:
PASS/FAIL

## Functional Findings

For every defect:

ID
Severity
Location
Steps to reproduce
Expected result
Actual result
Root cause
Recommended fix
Verification status

## UI/UX Findings

## Responsive Findings

## Accessibility Findings

## Security Findings

## Performance Findings

## Final Recommendation

Production Ready

or

Not Production Ready

Explain why.

---

# IMPORTANT BEHAVIOR

Do not blindly fix everything.

First identify defects.

For each defect:

1. Explain the problem.
2. Explain impact.
3. Fix only when appropriate.
4. Re-test.
5. Report the result.

Do not make unrelated architectural changes.

Do not downgrade severity to make the project appear healthier.

Do not claim a test passed unless it actually ran successfully.

# PHASE 14 . Code Analysis & Type Checking
- Run standard code linting (e.g., `npm run lint`).
- Run TypeScript type checking (e.g., `npx tsc --noEmit`).
- Do not stop if errors are found; categorize them (Minor/Major/Urgent) and log them.

# PHASE 15 . Unit, Component & API Tests
- Run existing unit, component, and API tests (e.g., `npm test`).
- Log any failing test suites and categorize severity.

# PHASE 16. Load & Capacity Testing (500 Employees)
- Evaluate Technical Functionalities, File Management, Data Load Capacity, and Storage Load Capacity.
- Analyze database schemas, API limits, and file storage strategies to ensure they can handle concurrent usage and data volume for 500 active employees.
- Document any potential bottlenecks or unoptimized queries as Major/Urgent risks.

# PHASE 17 . Security & Performance QA
- Run `npm audit` or equivalent to check for vulnerable dependencies.
- Evaluate backend security logic (e.g., rate limits, auth flows).
- Use `debug-optimize-lcp` techniques to analyze frontend performance.

# PHASE 18 . Browser UI/UX, Responsive & E2E Tests
- Use `chrome-devtools` to navigate to the application running locally.
- Manually click through critical paths to verify UI/UX logic and responsive design across viewports.
- Use `a11y-debugging` guidelines to verify accessibility.
- Log console errors or visual breaks.

# PHASE 19. Production Build
- Attempt to create a production build (e.g., `npm run build`).
- Log any build failures as Urgent.


# PHASE 20. Final QA REPORT
- Compile all findings into a detailed `qa_report.md` artifact.
- Group by severity: **Urgent**, **Major**, **Minor**.
- **DO NOT fix any issues** until the user reviews the report and gives explicit permission.

## Common Mistakes
- **Stopping early:** The agent must push through the entire pipeline even if Step 1 fails completely.
- **Auto-fixing:** The agent might be tempted to fix a typo or a broken test. Do not do this. Only audit and report.
- **Ignoring Scale:** Forgetting to evaluate the architecture specifically against the 500-employee data/storage load constraint during Step 3.
