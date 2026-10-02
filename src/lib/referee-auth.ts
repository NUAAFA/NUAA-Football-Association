import { createHmac, randomBytes } from "node:crypto";
import { cookies } from "next/headers";

import { prisma } from "@/lib/prisma";
import {
  authenticateAdminCredentials,
  verifyAdminCredentials,
} from "@/lib/referee-credentials";
import { isSessionFresh } from "@/lib/referee-security";
import { SITE_ORIGIN } from "@/lib/site-metadata";
import { getSafeUnifiedAdminNext } from "@/lib/unified-admin-legacy-routes";

export const adminSessionCookieName = "nuaa_referee_admin";
const sessionDurationMs = 12 * 60 * 60 * 1000;

function getSessionSecret() {
  const secret = process.env.REFEREE_ADMIN_SESSION_SECRET;
  return secret && secret.length >= 32 ? secret : null;
}

function hashToken(token: string, secret: string) {
  return createHmac("sha256", secret).update(token).digest("hex");
}

export function getAdminConfigurationIssue() {
  if (!getSessionSecret()) return "管理员会话认证尚未配置。";
  return null;
}

export function getSafeAdminReturnTo(value: string | string[] | undefined) {
  return getSafeUnifiedAdminNext(value) ?? "/admin";
}

export async function createAdminSession(username: string, password: string) {
  const secret = getSessionSecret();
  if (!secret) return null;
  const hasUsername = Boolean(username.trim());
  const account = hasUsername ? await authenticateAdminCredentials(username, password) : null;
  const legacyAuthenticated = !hasUsername && await verifyAdminCredentials(password);
  if (!account && !legacyAuthenticated) return null;

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + sessionDurationMs);
  await prisma.$transaction(async (tx) => {
    await tx.adminSession.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    await tx.adminSession.create({
      data: {
        tokenHash: hashToken(token, secret),
        expiresAt,
        adminAccountId: account?.id ?? null,
      },
    });
    if (account) {
      await tx.adminAccount.update({
        where: { id: account.id },
        data: { lastLoginAt: new Date() },
      });
    }
  });

  (await cookies()).set(adminSessionCookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    expires: expiresAt,
    path: "/",
  });
  return {
    explicitRoles: account?.unifiedRoles.map(({ role }) => role) ?? [],
    username: account?.username,
    legacyRole: account?.role,
    isLegacy: !account,
    mustChangePassword: account?.mustChangePassword ?? false,
  };
}

export async function getAdminSessionByToken(token: string | null | undefined) {
  const secret = getSessionSecret();
  if (!secret || !token) return null;
  const session = await prisma.adminSession.findUnique({
    where: { tokenHash: hashToken(token, secret) },
    include: {
      adminAccount: {
        select: {
          id: true,
          username: true,
          displayName: true,
          role: true,
          isActive: true,
          mustChangePassword: true,
        },
      },
    },
  });
  if (
    !session ||
    !isSessionFresh(session.expiresAt) ||
    (session.adminAccount && !session.adminAccount.isActive)
  ) {
    if (session) await prisma.adminSession.delete({ where: { id: session.id } });
    return null;
  }
  return session;
}

export async function getAdminSession() {
  return getAdminSessionByToken((await cookies()).get(adminSessionCookieName)?.value);
}

export function getAdminActor(session: Awaited<ReturnType<typeof getAdminSession>>) {
  if (!session) return null;
  const role = session.adminAccount?.role ?? "SUPER_ADMIN";
  return {
    id: session.adminAccount?.id ?? null,
    role,
    displayName: session.adminAccount?.displayName ?? "Legacy 管理员",
    isLegacy: !session.adminAccount,
  };
}

export async function destroyAdminSession() {
  const secret = getSessionSecret();
  const cookieStore = await cookies();
  const token = cookieStore.get(adminSessionCookieName)?.value;
  if (secret && token) {
    await prisma.adminSession.deleteMany({
      where: { tokenHash: hashToken(token, secret) },
    });
  }
  cookieStore.delete(adminSessionCookieName);
}

function isLocalDevelopmentUrl(value: URL) {
  return value.protocol === "http:"
    && (value.hostname === "localhost" || value.hostname === "127.0.0.1");
}

export function isSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) {
    if (process.env.NODE_ENV === "production") return false;
    try {
      return isLocalDevelopmentUrl(new URL(request.url));
    } catch {
      return false;
    }
  }

  try {
    const parsedOrigin = new URL(origin);
    if (
      parsedOrigin.origin === "null" ||
      parsedOrigin.username ||
      parsedOrigin.password ||
      parsedOrigin.pathname !== "/" ||
      parsedOrigin.search ||
      parsedOrigin.hash
    ) {
      return false;
    }

    const normalizedOrigin = parsedOrigin.origin;
    if (process.env.NODE_ENV === "production") {
      return normalizedOrigin === new URL(SITE_ORIGIN).origin;
    }

    // Development and test traffic is limited to the local loopback hosts,
    // while allowing the browser-facing and internal dev-server ports to differ.
    return isLocalDevelopmentUrl(parsedOrigin)
      && isLocalDevelopmentUrl(new URL(request.url));
  } catch {
    return false;
  }
}
