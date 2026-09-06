import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import type { Employee, Role, User } from "@prisma/client";
import { prisma } from "./db";
import { can, canSignIn, homePathFor, type Capability, type Viewer } from "./permissions";

/**
 * Sessions.
 *
 * The cookie carries `{ userId, sid }` and nothing else — in particular it
 * does NOT carry the role. A cookie is something the client holds, and an
 * authorisation decision must never be made from a value the holder could
 * influence or that could simply be stale: a person demoted this morning must
 * not keep this morning's powers until their cookie expires.
 *
 * The session is a row, so it can be revoked — on sign-out, when a laptop is
 * lost, and automatically at the end of an exit's last working day.
 */

const COOKIE_NAME = "fcsl_hrm_session";
const SESSION_DAYS = 7;
const TOUCH_AFTER_MS = 5 * 60 * 1000;

function sessionSecret(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    // Fail at module use in production rather than signing with a guessable
    // key. Anyone who knows this value can forge a Super Admin login.
    if (process.env.NODE_ENV === "production") {
      throw new Error("SESSION_SECRET is missing or too short. The app cannot run without it.");
    }
    console.warn("[auth] SESSION_SECRET missing — using an insecure development key.");
    return new TextEncoder().encode("dev-only-insecure-key-do-not-use-in-production");
  }
  return new TextEncoder().encode(secret);
}

type TokenPayload = { userId: string; sid: string };

export async function createSession(userId: string): Promise<void> {
  const requestHeaders = await headers();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 3600 * 1000);

  const session = await prisma.session.create({
    data: {
      userId,
      // Sliced: a hostile user agent string is not going to be the reason a
      // sign-in fails.
      userAgent: (requestHeaders.get("user-agent") ?? "").slice(0, 300),
      ip: callerIp(requestHeaders),
      expiresAt,
    },
  });

  const token = await new SignJWT({ userId, sid: session.id } satisfies TokenPayload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(expiresAt)
    .sign(sessionSecret());

  const jar = await cookies();
  jar.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  if (token) {
    const payload = await verifyToken(token);
    if (payload) {
      // Revoke the row AND clear the cookie. Clearing the cookie alone leaves
      // a session that still works if the token is replayed.
      await prisma.session
        .updateMany({ where: { id: payload.sid, revokedAt: null }, data: { revokedAt: new Date() } })
        .catch(() => {});
    }
  }
  jar.delete(COOKIE_NAME);
}

async function verifyToken(token: string): Promise<TokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, sessionSecret());
    const { userId, sid } = payload as Partial<TokenPayload>;
    return userId && sid ? { userId, sid } : null;
  } catch {
    return null;
  }
}

export type SessionContext = {
  user: User;
  employee: Employee | null;
  viewer: Viewer;
  /** The employee record behind this account, or null for the first Super Admin. */
  employeeId: string | null;
};

/**
 * The one hot path. A single query, and every reason to refuse is checked here
 * rather than scattered across the pages that call it.
 */
export async function getSessionContext(): Promise<SessionContext | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  if (!token) return null;

  const payload = await verifyToken(token);
  if (!payload) return null;

  const session = await prisma.session.findUnique({
    where: { id: payload.sid },
    include: { user: { include: { employee: true } } },
  });

  if (!session) return null;
  if (session.revokedAt) return null;
  if (session.expiresAt <= new Date()) return null;
  // The token says one user and the row says another: a forged or swapped
  // token. Refuse rather than trusting either.
  if (session.userId !== payload.userId) return null;

  const user = session.user;
  if (user.disabledAt) return null;

  const viewer: Viewer = { id: user.id, role: user.role };
  if (!canSignIn(viewer)) return null;

  // Bookkeeping, and never allowed to throw: a failed lastSeenAt write must
  // not sign somebody out.
  if (Date.now() - session.lastSeenAt.getTime() > TOUCH_AFTER_MS) {
    prisma.session
      .update({ where: { id: session.id }, data: { lastSeenAt: new Date() } })
      .catch(() => {});
  }

  const { employee, ...plainUser } = user;
  return { user: plainUser as User, employee, viewer, employeeId: employee?.id ?? null };
}

export async function getCurrentUser(): Promise<SessionContext | null> {
  return getSessionContext();
}

/** Pages redirect. Server actions call `can()` and return a readable message. */
export async function requireUser(): Promise<SessionContext> {
  const context = await getSessionContext();
  if (!context) redirect("/signin");
  return context;
}

/**
 * The locked door (§3).
 *
 * Until HR approves the documents, the ONLY thing a person can reach is the
 * upload screen. This is called by every page behind the door, so the lock is
 * a lock and not a hidden menu item: typing the URL gets you the same answer
 * as not seeing the link.
 */
export async function requireOpenPanel(): Promise<SessionContext> {
  const context = await requireUser();
  if (context.user.mustChangePassword) redirect("/set-password");
  if (context.employee && context.employee.onboardingStatus !== "APPROVED") redirect("/onboarding");
  return context;
}

export async function requireCapability(capability: Capability): Promise<SessionContext> {
  const context = await requireOpenPanel();
  if (!can(context.viewer, capability)) redirect(homePathFor(context.viewer));
  return context;
}

/** The employee's own record, for the /me pages. */
export async function requireEmployee(): Promise<SessionContext & { employee: Employee }> {
  const context = await requireOpenPanel();
  if (!context.employee) redirect(homePathFor(context.viewer));
  return context as SessionContext & { employee: Employee };
}

export function callerIp(requestHeaders: Headers): string {
  const forwarded = requestHeaders.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return requestHeaders.get("x-real-ip")?.trim() || "";
}

/** For audit rows written from a server action. */
export async function currentIp(): Promise<string> {
  return callerIp(await headers());
}

export type { Capability, Role, Viewer };
