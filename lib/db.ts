import { PrismaClient } from "@prisma/client";

// Next.js reloads modules on every edit in development, and each reload would
// otherwise open a fresh pool until Postgres refuses the connection. Cache the
// client on globalThis, which survives the reload.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
