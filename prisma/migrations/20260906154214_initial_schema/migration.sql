-- CreateEnum
CREATE TYPE "Role" AS ENUM ('SUPER_ADMIN', 'HR_HEAD', 'HR_EXECUTIVE', 'MANAGER', 'EMPLOYEE');

-- CreateEnum
CREATE TYPE "StaffType" AS ENUM ('STAFF', 'RM');

-- CreateEnum
CREATE TYPE "OnboardingStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'SENT_BACK', 'APPROVED');

-- CreateEnum
CREATE TYPE "EmployeeStatus" AS ENUM ('ACTIVE', 'LEFT');

-- CreateEnum
CREATE TYPE "AssignmentReason" AS ENUM ('JOINING', 'TRANSFER', 'PROMOTION', 'MANAGER_CHANGE', 'IMPORT', 'CORRECTION');

-- CreateEnum
CREATE TYPE "ContactStatus" AS ENUM ('CURRENT', 'PENDING', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "CorrectionStatus" AS ENUM ('OPEN', 'RESOLVED', 'DECLINED');

-- CreateEnum
CREATE TYPE "DocumentKind" AS ENUM ('CV', 'NID', 'PHOTOGRAPH', 'EDUCATION_CERTIFICATE', 'EXPERIENCE_LETTER', 'RELEASE_LETTER', 'APPOINTMENT_LETTER', 'JOINING_LETTER', 'RM_CERTIFICATE', 'BANK_DETAILS', 'TRAINING_CERTIFICATE', 'CONFIRMATION_LETTER', 'CLEARANCE_DOCUMENT', 'EXIT_RELEASE_LETTER', 'SHOWCAUSE_LETTER', 'SHOWCAUSE_REPLY', 'LEAVE_ATTACHMENT', 'REQUISITION_BILL', 'OTHER');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "CertificateStatus" AS ENUM ('ACTIVE', 'SUPERSEDED', 'SURRENDERED');

-- CreateEnum
CREATE TYPE "TerminalStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'SURRENDERED');

-- CreateEnum
CREATE TYPE "CalendarScope" AS ENUM ('COMPANY', 'BRANCH', 'EMPLOYEE');

-- CreateEnum
CREATE TYPE "OverBalancePolicy" AS ENUM ('REFUSE', 'WARN');

-- CreateEnum
CREATE TYPE "EntitlementSource" AS ENUM ('GRANT', 'CARRY_FORWARD', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "LeaveRequestStatus" AS ENUM ('PENDING', 'GRANTED', 'DENIED', 'WITHDRAWN', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LeaveDayKind" AS ENUM ('WORKING', 'WEEKLY_OFF', 'HOLIDAY');

-- CreateEnum
CREATE TYPE "ApprovalDecision" AS ENUM ('GRANTED', 'DENIED');

-- CreateEnum
CREATE TYPE "SheetStatus" AS ENUM ('OPEN', 'SUBMITTED', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "AttendanceMark" AS ENUM ('PRESENT', 'ABSENT', 'LATE', 'ON_LEAVE', 'PUBLIC_HOLIDAY', 'WEEKLY_OFF', 'OFFICIAL_DUTY');

-- CreateEnum
CREATE TYPE "RequisitionType" AS ENUM ('OFFICE_SUPPLIES', 'IT_EQUIPMENT', 'MONEY_EXPENSE', 'NEW_STAFF');

-- CreateEnum
CREATE TYPE "RequisitionStatus" AS ENUM ('PENDING', 'APPROVED', 'DENIED', 'WITHDRAWN', 'FULFILLED');

-- CreateEnum
CREATE TYPE "ShowCauseOutcome" AS ENUM ('NO_ACTION', 'WARNING', 'ESCALATED');

-- CreateEnum
CREATE TYPE "ExitReason" AS ENUM ('RESIGNATION', 'END_OF_CONTRACT', 'TERMINATION', 'RETIREMENT');

-- CreateEnum
CREATE TYPE "ClearanceArea" AS ENUM ('IT', 'ACCOUNTS', 'ADMIN', 'HR', 'CLIENT_HANDOVER');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'EMPLOYEE',
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT true,
    "tempPasswordExpiresAt" TIMESTAMPTZ(3),
    "disabledAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdById" TEXT,
    "createdByName" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userAgent" TEXT NOT NULL DEFAULT '',
    "ip" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoginAttempt" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Employee" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "employeeId" TEXT,
    "idLetter" TEXT,
    "idNumber" INTEGER,
    "idYear" INTEGER,
    "staffType" "StaffType" NOT NULL DEFAULT 'STAFF',
    "onboardingStatus" "OnboardingStatus" NOT NULL DEFAULT 'DRAFT',
    "status" "EmployeeStatus" NOT NULL DEFAULT 'ACTIVE',
    "fullName" TEXT NOT NULL,
    "fatherName" TEXT NOT NULL DEFAULT '',
    "motherName" TEXT NOT NULL DEFAULT '',
    "dateOfBirth" DATE,
    "gender" TEXT NOT NULL DEFAULT '',
    "nationality" TEXT NOT NULL DEFAULT '',
    "religion" TEXT NOT NULL DEFAULT '',
    "maritalStatus" TEXT NOT NULL DEFAULT '',
    "nidNumber" TEXT NOT NULL DEFAULT '',
    "mobile" TEXT NOT NULL DEFAULT '',
    "personalEmail" TEXT NOT NULL DEFAULT '',
    "presentAddress" TEXT NOT NULL DEFAULT '',
    "permanentAddress" TEXT NOT NULL DEFAULT '',
    "photoKey" TEXT,
    "branchId" TEXT,
    "departmentId" TEXT,
    "designationId" TEXT,
    "gradeId" TEXT,
    "managerId" TEXT,
    "joiningDate" DATE,
    "confirmationDate" DATE,
    "lastWorkingDay" DATE,
    "submittedAt" TIMESTAMPTZ(3),
    "approvedAt" TIMESTAMPTZ(3),
    "approvedById" TEXT,
    "approvedByName" TEXT NOT NULL DEFAULT '',
    "sendBackReason" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeBankDetail" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "accountName" TEXT NOT NULL DEFAULT '',
    "accountNumber" TEXT NOT NULL DEFAULT '',
    "bankName" TEXT NOT NULL DEFAULT '',
    "branchName" TEXT NOT NULL DEFAULT '',
    "routingNumber" TEXT NOT NULL DEFAULT '',
    "updatedById" TEXT,
    "updatedByName" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "EmployeeBankDetail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeAssignment" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "branchId" TEXT,
    "departmentId" TEXT,
    "designationId" TEXT,
    "gradeId" TEXT,
    "managerId" TEXT,
    "reason" "AssignmentReason" NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "recordedById" TEXT,
    "recordedByName" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeeAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmergencyContact" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "slot" INTEGER NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "relationship" TEXT NOT NULL DEFAULT '',
    "mobile" TEXT NOT NULL DEFAULT '',
    "address" TEXT NOT NULL DEFAULT '',
    "status" "ContactStatus" NOT NULL DEFAULT 'CURRENT',
    "supersedesId" TEXT,
    "proposedById" TEXT,
    "proposedByName" TEXT NOT NULL DEFAULT '',
    "proposedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedById" TEXT,
    "approvedByName" TEXT NOT NULL DEFAULT '',
    "approvedAt" TIMESTAMPTZ(3),
    "rejectionReason" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "EmergencyContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CorrectionRequest" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "field" TEXT NOT NULL DEFAULT '',
    "message" TEXT NOT NULL,
    "status" "CorrectionStatus" NOT NULL DEFAULT 'OPEN',
    "response" TEXT NOT NULL DEFAULT '',
    "raisedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "handledById" TEXT,
    "handledByName" TEXT NOT NULL DEFAULT '',
    "handledAt" TIMESTAMPTZ(3),

    CONSTRAINT "CorrectionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeDocument" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "kind" "DocumentKind" NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "storageKey" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'PENDING',
    "rejectionReason" TEXT NOT NULL DEFAULT '',
    "issueDate" DATE,
    "expiryDate" DATE,
    "uploadedById" TEXT,
    "uploadedByName" TEXT NOT NULL DEFAULT '',
    "uploadedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedById" TEXT,
    "reviewedByName" TEXT NOT NULL DEFAULT '',
    "reviewedAt" TIMESTAMPTZ(3),
    "supersedesId" TEXT,
    "supersededAt" TIMESTAMPTZ(3),
    "supersedeReason" TEXT NOT NULL DEFAULT '',
    "purgedAt" TIMESTAMPTZ(3),

    CONSTRAINT "EmployeeDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Note" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Branch" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "address" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "openedOn" DATE,
    "closedOn" DATE,
    "branchManagerId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Branch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Department" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "retiredAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Designation" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "retiredAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Designation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Grade" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rank" INTEGER NOT NULL DEFAULT 0,
    "retiredAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Grade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeIdSequence" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "letter" TEXT NOT NULL DEFAULT 'A',
    "nextNumber" INTEGER NOT NULL DEFAULT 413,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "EmployeeIdSequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RmCertificate" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "certificateNumber" TEXT NOT NULL,
    "issueDate" DATE NOT NULL,
    "expiryDate" DATE NOT NULL,
    "documentId" TEXT,
    "status" "CertificateStatus" NOT NULL DEFAULT 'ACTIVE',
    "surrenderedOn" DATE,
    "recordedById" TEXT,
    "recordedByName" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RmCertificate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradingTerminal" (
    "id" TEXT NOT NULL,
    "terminalId" TEXT NOT NULL,
    "exchange" TEXT NOT NULL,
    "branchId" TEXT,
    "status" "TerminalStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "TradingTerminal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TerminalAssignment" (
    "id" TEXT NOT NULL,
    "terminalId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "assignedOn" DATE NOT NULL,
    "releasedOn" DATE,
    "note" TEXT NOT NULL DEFAULT '',
    "assignedById" TEXT,
    "assignedByName" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TerminalAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Holiday" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "halfDay" BOOLEAN NOT NULL DEFAULT false,
    "year" INTEGER NOT NULL,
    "createdById" TEXT,
    "createdByName" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Holiday_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeeklyOffRule" (
    "id" TEXT NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "days" INTEGER[],
    "createdById" TEXT,
    "createdByName" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WeeklyOffRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarEvent" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "scope" "CalendarScope" NOT NULL,
    "branchId" TEXT,
    "employeeId" TEXT,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "createdById" TEXT,
    "createdByName" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CalendarEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveType" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "retiredAt" TIMESTAMPTZ(3),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeaveType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveTypeRule" (
    "id" TEXT NOT NULL,
    "leaveTypeId" TEXT NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "daysPerYear" DECIMAL(6,2) NOT NULL,
    "carryForward" BOOLEAN NOT NULL DEFAULT false,
    "carryForwardCap" DECIMAL(6,2),
    "overBalance" "OverBalancePolicy" NOT NULL DEFAULT 'REFUSE',
    "attachmentRequiredAfterDays" INTEGER,
    "createdById" TEXT,
    "createdByName" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeaveTypeRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveEntitlement" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "leaveTypeId" TEXT NOT NULL,
    "fromDate" DATE NOT NULL,
    "toDate" DATE NOT NULL,
    "days" DECIMAL(8,2) NOT NULL,
    "source" "EntitlementSource" NOT NULL DEFAULT 'GRANT',
    "note" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT,
    "createdByName" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeaveEntitlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveRequest" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "leaveTypeId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "appliedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lateReason" TEXT NOT NULL DEFAULT '',
    "attachmentId" TEXT,
    "status" "LeaveRequestStatus" NOT NULL DEFAULT 'PENDING',
    "currentStep" INTEGER NOT NULL DEFAULT 0,
    "currentApproverRole" "Role",
    "decidedAt" TIMESTAMPTZ(3),

    CONSTRAINT "LeaveRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveDay" (
    "id" TEXT NOT NULL,
    "leaveRequestId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "leaveTypeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "dayKind" "LeaveDayKind" NOT NULL,
    "lengthDays" DECIMAL(4,2) NOT NULL,

    CONSTRAINT "LeaveDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveDayEntitlement" (
    "id" TEXT NOT NULL,
    "leaveDayId" TEXT NOT NULL,
    "entitlementId" TEXT NOT NULL,
    "lengthDays" DECIMAL(4,2) NOT NULL,

    CONSTRAINT "LeaveDayEntitlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveApproval" (
    "id" TEXT NOT NULL,
    "leaveRequestId" TEXT NOT NULL,
    "step" INTEGER NOT NULL,
    "approverRole" "Role" NOT NULL,
    "approverId" TEXT,
    "approverName" TEXT NOT NULL DEFAULT '',
    "decision" "ApprovalDecision" NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "decidedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeaveApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceSheet" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "status" "SheetStatus" NOT NULL DEFAULT 'OPEN',
    "submittedById" TEXT,
    "submittedByName" TEXT NOT NULL DEFAULT '',
    "submittedAt" TIMESTAMPTZ(3),
    "publishedById" TEXT,
    "publishedByName" TEXT NOT NULL DEFAULT '',
    "publishedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendanceSheet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceEntry" (
    "id" TEXT NOT NULL,
    "sheetId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "mark" "AttendanceMark" NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "AttendanceEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceCorrection" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "previousMark" "AttendanceMark" NOT NULL,
    "newMark" "AttendanceMark" NOT NULL,
    "reason" TEXT NOT NULL,
    "correctedById" TEXT,
    "correctedByName" TEXT NOT NULL DEFAULT '',
    "correctedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendanceCorrection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Requisition" (
    "id" TEXT NOT NULL,
    "raisedById" TEXT NOT NULL,
    "raisedByName" TEXT NOT NULL DEFAULT '',
    "type" "RequisitionType" NOT NULL,
    "details" JSONB NOT NULL,
    "amount" DECIMAL(14,2),
    "status" "RequisitionStatus" NOT NULL DEFAULT 'PENDING',
    "currentStep" INTEGER NOT NULL DEFAULT 0,
    "currentApproverRole" "Role",
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMPTZ(3),
    "fulfilledAt" TIMESTAMPTZ(3),
    "fulfilmentNote" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "Requisition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequisitionApproval" (
    "id" TEXT NOT NULL,
    "requisitionId" TEXT NOT NULL,
    "step" INTEGER NOT NULL,
    "approverRole" "Role" NOT NULL,
    "approverId" TEXT,
    "approverName" TEXT NOT NULL DEFAULT '',
    "decision" "ApprovalDecision" NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "decidedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RequisitionApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShowCauseTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "retiredAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShowCauseTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShowCause" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "issuedById" TEXT,
    "issuedByName" TEXT NOT NULL DEFAULT '',
    "issuedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedAt" TIMESTAMPTZ(3),
    "replyBody" TEXT NOT NULL DEFAULT '',
    "replyDocumentId" TEXT,
    "repliedAt" TIMESTAMPTZ(3),
    "outcome" "ShowCauseOutcome",
    "outcomeNote" TEXT NOT NULL DEFAULT '',
    "closedById" TEXT,
    "closedByName" TEXT NOT NULL DEFAULT '',
    "closedAt" TIMESTAMPTZ(3),
    "visibleToManager" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ShowCause_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Exit" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "reason" "ExitReason" NOT NULL,
    "reasonNote" TEXT NOT NULL DEFAULT '',
    "lastWorkingDay" DATE NOT NULL,
    "releaseLetterDocumentId" TEXT,
    "recordedById" TEXT,
    "recordedByName" TEXT NOT NULL DEFAULT '',
    "recordedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ(3),
    "completedById" TEXT,
    "completedByName" TEXT NOT NULL DEFAULT '',
    "documentsPurgeAfter" DATE NOT NULL,
    "documentsPurgedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Exit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClearanceItem" (
    "id" TEXT NOT NULL,
    "exitId" TEXT NOT NULL,
    "area" "ClearanceArea" NOT NULL,
    "label" TEXT NOT NULL,
    "clearedById" TEXT,
    "clearedByName" TEXT NOT NULL DEFAULT '',
    "clearedAt" TIMESTAMPTZ(3),
    "note" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "ClearanceItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT NOT NULL DEFAULT '',
    "actorRole" TEXT NOT NULL DEFAULT '',
    "targetType" TEXT,
    "targetId" TEXT,
    "targetLabel" TEXT NOT NULL DEFAULT '',
    "detail" JSONB,
    "ip" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "link" TEXT NOT NULL DEFAULT '',
    "readAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "digestedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedById" TEXT,
    "updatedByName" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_createdAt_idx" ON "User"("role", "createdAt");

-- CreateIndex
CREATE INDEX "User_disabledAt_idx" ON "User"("disabledAt");

-- CreateIndex
CREATE INDEX "Session_userId_createdAt_idx" ON "Session"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "LoginAttempt_key_createdAt_idx" ON "LoginAttempt"("key", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_userId_key" ON "Employee"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_employeeId_key" ON "Employee"("employeeId");

-- CreateIndex
CREATE INDEX "Employee_status_onboardingStatus_idx" ON "Employee"("status", "onboardingStatus");

-- CreateIndex
CREATE INDEX "Employee_branchId_status_idx" ON "Employee"("branchId", "status");

-- CreateIndex
CREATE INDEX "Employee_departmentId_status_idx" ON "Employee"("departmentId", "status");

-- CreateIndex
CREATE INDEX "Employee_managerId_status_idx" ON "Employee"("managerId", "status");

-- CreateIndex
CREATE INDEX "Employee_staffType_status_idx" ON "Employee"("staffType", "status");

-- CreateIndex
CREATE INDEX "Employee_onboardingStatus_submittedAt_idx" ON "Employee"("onboardingStatus", "submittedAt");

-- CreateIndex
CREATE INDEX "Employee_fullName_idx" ON "Employee"("fullName");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeBankDetail_employeeId_key" ON "EmployeeBankDetail"("employeeId");

-- CreateIndex
CREATE INDEX "EmployeeAssignment_employeeId_effectiveFrom_idx" ON "EmployeeAssignment"("employeeId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "EmployeeAssignment_managerId_effectiveFrom_effectiveTo_idx" ON "EmployeeAssignment"("managerId", "effectiveFrom", "effectiveTo");

-- CreateIndex
CREATE INDEX "EmployeeAssignment_branchId_effectiveFrom_idx" ON "EmployeeAssignment"("branchId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "EmergencyContact_employeeId_slot_status_idx" ON "EmergencyContact"("employeeId", "slot", "status");

-- CreateIndex
CREATE INDEX "EmergencyContact_status_proposedAt_idx" ON "EmergencyContact"("status", "proposedAt");

-- CreateIndex
CREATE INDEX "CorrectionRequest_status_raisedAt_idx" ON "CorrectionRequest"("status", "raisedAt");

-- CreateIndex
CREATE INDEX "CorrectionRequest_employeeId_raisedAt_idx" ON "CorrectionRequest"("employeeId", "raisedAt");

-- CreateIndex
CREATE INDEX "EmployeeDocument_employeeId_kind_status_idx" ON "EmployeeDocument"("employeeId", "kind", "status");

-- CreateIndex
CREATE INDEX "EmployeeDocument_status_uploadedAt_idx" ON "EmployeeDocument"("status", "uploadedAt");

-- CreateIndex
CREATE INDEX "EmployeeDocument_expiryDate_idx" ON "EmployeeDocument"("expiryDate");

-- CreateIndex
CREATE INDEX "Note_userId_updatedAt_idx" ON "Note"("userId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Branch_code_key" ON "Branch"("code");

-- CreateIndex
CREATE INDEX "Branch_closedOn_idx" ON "Branch"("closedOn");

-- CreateIndex
CREATE UNIQUE INDEX "Department_name_key" ON "Department"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Designation_name_key" ON "Designation"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Grade_name_key" ON "Grade"("name");

-- CreateIndex
CREATE INDEX "RmCertificate_status_expiryDate_idx" ON "RmCertificate"("status", "expiryDate");

-- CreateIndex
CREATE INDEX "RmCertificate_employeeId_status_idx" ON "RmCertificate"("employeeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TradingTerminal_terminalId_key" ON "TradingTerminal"("terminalId");

-- CreateIndex
CREATE INDEX "TradingTerminal_status_idx" ON "TradingTerminal"("status");

-- CreateIndex
CREATE INDEX "TerminalAssignment_employeeId_releasedOn_idx" ON "TerminalAssignment"("employeeId", "releasedOn");

-- CreateIndex
CREATE INDEX "TerminalAssignment_terminalId_releasedOn_idx" ON "TerminalAssignment"("terminalId", "releasedOn");

-- CreateIndex
CREATE UNIQUE INDEX "Holiday_date_key" ON "Holiday"("date");

-- CreateIndex
CREATE INDEX "Holiday_year_idx" ON "Holiday"("year");

-- CreateIndex
CREATE INDEX "WeeklyOffRule_effectiveFrom_idx" ON "WeeklyOffRule"("effectiveFrom");

-- CreateIndex
CREATE INDEX "CalendarEvent_startsAt_idx" ON "CalendarEvent"("startsAt");

-- CreateIndex
CREATE INDEX "CalendarEvent_scope_startsAt_idx" ON "CalendarEvent"("scope", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "LeaveType_code_key" ON "LeaveType"("code");

-- CreateIndex
CREATE INDEX "LeaveTypeRule_effectiveFrom_idx" ON "LeaveTypeRule"("effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "LeaveTypeRule_leaveTypeId_effectiveFrom_key" ON "LeaveTypeRule"("leaveTypeId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "LeaveEntitlement_employeeId_leaveTypeId_fromDate_idx" ON "LeaveEntitlement"("employeeId", "leaveTypeId", "fromDate");

-- CreateIndex
CREATE INDEX "LeaveRequest_employeeId_appliedAt_idx" ON "LeaveRequest"("employeeId", "appliedAt");

-- CreateIndex
CREATE INDEX "LeaveRequest_status_currentApproverRole_appliedAt_idx" ON "LeaveRequest"("status", "currentApproverRole", "appliedAt");

-- CreateIndex
CREATE INDEX "LeaveRequest_currentApproverRole_status_idx" ON "LeaveRequest"("currentApproverRole", "status");

-- CreateIndex
CREATE INDEX "LeaveDay_employeeId_date_idx" ON "LeaveDay"("employeeId", "date");

-- CreateIndex
CREATE INDEX "LeaveDay_leaveRequestId_dayKind_idx" ON "LeaveDay"("leaveRequestId", "dayKind");

-- CreateIndex
CREATE INDEX "LeaveDay_date_idx" ON "LeaveDay"("date");

-- CreateIndex
CREATE INDEX "LeaveDayEntitlement_entitlementId_idx" ON "LeaveDayEntitlement"("entitlementId");

-- CreateIndex
CREATE UNIQUE INDEX "LeaveDayEntitlement_leaveDayId_entitlementId_key" ON "LeaveDayEntitlement"("leaveDayId", "entitlementId");

-- CreateIndex
CREATE INDEX "LeaveApproval_approverId_decidedAt_idx" ON "LeaveApproval"("approverId", "decidedAt");

-- CreateIndex
CREATE UNIQUE INDEX "LeaveApproval_leaveRequestId_step_key" ON "LeaveApproval"("leaveRequestId", "step");

-- CreateIndex
CREATE INDEX "AttendanceSheet_status_year_month_idx" ON "AttendanceSheet"("status", "year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceSheet_branchId_year_month_key" ON "AttendanceSheet"("branchId", "year", "month");

-- CreateIndex
CREATE INDEX "AttendanceEntry_employeeId_date_idx" ON "AttendanceEntry"("employeeId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceEntry_sheetId_employeeId_date_key" ON "AttendanceEntry"("sheetId", "employeeId", "date");

-- CreateIndex
CREATE INDEX "AttendanceCorrection_entryId_correctedAt_idx" ON "AttendanceCorrection"("entryId", "correctedAt");

-- CreateIndex
CREATE INDEX "Requisition_status_currentApproverRole_createdAt_idx" ON "Requisition"("status", "currentApproverRole", "createdAt");

-- CreateIndex
CREATE INDEX "Requisition_raisedById_createdAt_idx" ON "Requisition"("raisedById", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RequisitionApproval_requisitionId_step_key" ON "RequisitionApproval"("requisitionId", "step");

-- CreateIndex
CREATE UNIQUE INDEX "ShowCauseTemplate_name_key" ON "ShowCauseTemplate"("name");

-- CreateIndex
CREATE INDEX "ShowCause_employeeId_issuedAt_idx" ON "ShowCause"("employeeId", "issuedAt");

-- CreateIndex
CREATE INDEX "ShowCause_closedAt_idx" ON "ShowCause"("closedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Exit_employeeId_key" ON "Exit"("employeeId");

-- CreateIndex
CREATE INDEX "Exit_completedAt_lastWorkingDay_idx" ON "Exit"("completedAt", "lastWorkingDay");

-- CreateIndex
CREATE INDEX "Exit_documentsPurgeAfter_documentsPurgedAt_idx" ON "Exit"("documentsPurgeAfter", "documentsPurgedAt");

-- CreateIndex
CREATE INDEX "ClearanceItem_exitId_area_idx" ON "ClearanceItem"("exitId", "area");

-- CreateIndex
CREATE INDEX "AuditEvent_createdAt_idx" ON "AuditEvent"("createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_actorId_createdAt_idx" ON "AuditEvent"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_targetType_targetId_createdAt_idx" ON "AuditEvent"("targetType", "targetId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_action_createdAt_idx" ON "AuditEvent"("action", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_designationId_fkey" FOREIGN KEY ("designationId") REFERENCES "Designation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_gradeId_fkey" FOREIGN KEY ("gradeId") REFERENCES "Grade"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeBankDetail" ADD CONSTRAINT "EmployeeBankDetail_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeAssignment" ADD CONSTRAINT "EmployeeAssignment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeAssignment" ADD CONSTRAINT "EmployeeAssignment_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeAssignment" ADD CONSTRAINT "EmployeeAssignment_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeAssignment" ADD CONSTRAINT "EmployeeAssignment_designationId_fkey" FOREIGN KEY ("designationId") REFERENCES "Designation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeAssignment" ADD CONSTRAINT "EmployeeAssignment_gradeId_fkey" FOREIGN KEY ("gradeId") REFERENCES "Grade"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeAssignment" ADD CONSTRAINT "EmployeeAssignment_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmergencyContact" ADD CONSTRAINT "EmergencyContact_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmergencyContact" ADD CONSTRAINT "EmergencyContact_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "EmergencyContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorrectionRequest" ADD CONSTRAINT "CorrectionRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeDocument" ADD CONSTRAINT "EmployeeDocument_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeDocument" ADD CONSTRAINT "EmployeeDocument_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "EmployeeDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Branch" ADD CONSTRAINT "Branch_branchManagerId_fkey" FOREIGN KEY ("branchManagerId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RmCertificate" ADD CONSTRAINT "RmCertificate_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RmCertificate" ADD CONSTRAINT "RmCertificate_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "EmployeeDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradingTerminal" ADD CONSTRAINT "TradingTerminal_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TerminalAssignment" ADD CONSTRAINT "TerminalAssignment_terminalId_fkey" FOREIGN KEY ("terminalId") REFERENCES "TradingTerminal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TerminalAssignment" ADD CONSTRAINT "TerminalAssignment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveTypeRule" ADD CONSTRAINT "LeaveTypeRule_leaveTypeId_fkey" FOREIGN KEY ("leaveTypeId") REFERENCES "LeaveType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveEntitlement" ADD CONSTRAINT "LeaveEntitlement_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveEntitlement" ADD CONSTRAINT "LeaveEntitlement_leaveTypeId_fkey" FOREIGN KEY ("leaveTypeId") REFERENCES "LeaveType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_leaveTypeId_fkey" FOREIGN KEY ("leaveTypeId") REFERENCES "LeaveType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveDay" ADD CONSTRAINT "LeaveDay_leaveRequestId_fkey" FOREIGN KEY ("leaveRequestId") REFERENCES "LeaveRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveDay" ADD CONSTRAINT "LeaveDay_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveDay" ADD CONSTRAINT "LeaveDay_leaveTypeId_fkey" FOREIGN KEY ("leaveTypeId") REFERENCES "LeaveType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveDayEntitlement" ADD CONSTRAINT "LeaveDayEntitlement_leaveDayId_fkey" FOREIGN KEY ("leaveDayId") REFERENCES "LeaveDay"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveDayEntitlement" ADD CONSTRAINT "LeaveDayEntitlement_entitlementId_fkey" FOREIGN KEY ("entitlementId") REFERENCES "LeaveEntitlement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveApproval" ADD CONSTRAINT "LeaveApproval_leaveRequestId_fkey" FOREIGN KEY ("leaveRequestId") REFERENCES "LeaveRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceSheet" ADD CONSTRAINT "AttendanceSheet_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceEntry" ADD CONSTRAINT "AttendanceEntry_sheetId_fkey" FOREIGN KEY ("sheetId") REFERENCES "AttendanceSheet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceEntry" ADD CONSTRAINT "AttendanceEntry_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceCorrection" ADD CONSTRAINT "AttendanceCorrection_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "AttendanceEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Requisition" ADD CONSTRAINT "Requisition_raisedById_fkey" FOREIGN KEY ("raisedById") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequisitionApproval" ADD CONSTRAINT "RequisitionApproval_requisitionId_fkey" FOREIGN KEY ("requisitionId") REFERENCES "Requisition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShowCause" ADD CONSTRAINT "ShowCause_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Exit" ADD CONSTRAINT "Exit_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClearanceItem" ADD CONSTRAINT "ClearanceItem_exitId_fkey" FOREIGN KEY ("exitId") REFERENCES "Exit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
