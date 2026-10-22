import { issueVerifiedRefereeSession } from "@/lib/session-issuance";
import "server-only";

import { createHmac, randomBytes } from "node:crypto";
import { cookies } from "next/headers";

import { prisma } from "@/lib/prisma";
import { selfRefereeSelect } from "@/lib/referee-dto";
import { authenticateRefereeCredentials } from "@/lib/referee-credentials";
import { isSessionFresh } from "@/lib/referee-security";

const sessionCookieName = "nuaa_referee_member";
const sessionDurationMs = 12 * 60 * 60 * 1000;

function getSessionSecret() {
  const secret = process.env.REFEREE_MEMBER_SESSION_SECRET;
  return secret && secret.length >= 32 ? secret : null;
}

function hashToken(token: string, secret: string) {
  return createHmac("sha256", secret).update(token).digest("hex");
}

export function getRefereeMemberConfigurationIssue() {
  if (!getSessionSecret()) return "裁判员会话认证尚未配置。";
  return null;
}

export async function createRefereeMemberSession(studentId: string, password: string) {
  const secret = getSessionSecret();
  if (!secret) return null;

  const referee = await authenticateRefereeCredentials(studentId, password);
  if (!referee) return null;

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + sessionDurationMs);
  if (!(await issueVerifiedRefereeSession({ account: referee, tokenHash: hashToken(token, secret), expiresAt }))) return null;

  (await cookies()).set(sessionCookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    expires: expiresAt,
    path: "/",
  });
  return referee;
}

export async function getRefereeMemberSession() {
  const secret = getSessionSecret();
  const token = (await cookies()).get(sessionCookieName)?.value;
  if (!secret || !token) return null;

  const session = await prisma.refereeSession.findUnique({
    where: { tokenHash: hashToken(token, secret) },
    include: {
      referee: { select: selfRefereeSelect },
    },
  });
  if (!session || !isSessionFresh(session.expiresAt) || session.referee.status !== "ACTIVE") {
    if (session) await prisma.refereeSession.delete({ where: { id: session.id } });
    return null;
  }
  return session;
}

export async function destroyRefereeMemberSession() {
  const secret = getSessionSecret();
  const cookieStore = await cookies();
  const token = cookieStore.get(sessionCookieName)?.value;
  if (secret && token) {
    await prisma.refereeSession.deleteMany({
      where: { tokenHash: hashToken(token, secret) },
    });
  }
  cookieStore.delete(sessionCookieName);
}
