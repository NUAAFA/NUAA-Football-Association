import type { UnifiedAdminRole } from "@/generated/prisma-v29/client";

import {
  hasUnifiedAdminPermission,
  type UnifiedAdminPermission,
} from "@/lib/unified-admin-rbac";
import {
  getSafeUnifiedAdminNext,
  mapLegacyAdminPathToUnified,
} from "@/lib/unified-admin-legacy-routes";

export { getSafeUnifiedAdminNext } from "@/lib/unified-admin-legacy-routes";

function splitPathSuffix(value: string) {
  const suffixIndex = value.search(/[?#]/);
  return suffixIndex === -1
    ? { pathname: value, suffix: "" }
    : { pathname: value.slice(0, suffixIndex), suffix: value.slice(suffixIndex) };
}

export function getUnifiedAdminRoutePermission(pathname: string): UnifiedAdminPermission | null {
  if (pathname === "/admin") return "dashboard:read";
  if (pathname === "/admin/login") return null;
  if (pathname.startsWith("/admin/content/")) return pathname.endsWith("/preview") ? "content:read" : "content:write";
  if (pathname === "/admin/media" || pathname.startsWith("/admin/media/")) return "media:read";
  if (pathname === "/admin/resources") return "content:read";
  if (pathname.startsWith("/admin/resources/")) return "content:write";
  if (pathname === "/admin/competitions/import" || pathname.startsWith("/admin/competitions/import/")) return "competitions:write";
  if (pathname === "/admin/competitions/new" || /\/admin\/competitions\/[^/]+\/edit$/.test(pathname)) return "competitions:write";
  if (pathname === "/admin/matches/new" || /\/admin\/matches\/[^/]+\/edit$/.test(pathname)) return "competitions:write";
  if (pathname === "/admin/referees/new") return "referees:write";
  if (
    pathname === "/admin/competitions" || pathname.startsWith("/admin/competitions/") ||
    pathname === "/admin/matches" || pathname.startsWith("/admin/matches/") ||
    pathname === "/admin/organizations" || pathname.startsWith("/admin/organizations/")
  ) return "competitions:read";
  if (
    pathname === "/admin/referees" || pathname.startsWith("/admin/referees/") ||
    pathname === "/admin/appointments" || pathname.startsWith("/admin/appointments/") ||
    pathname === "/admin/conflicts" || pathname.startsWith("/admin/conflicts/") ||
    pathname === "/admin/statistics" || pathname.startsWith("/admin/statistics/")
  ) return "referees:read";
  if (pathname === "/admin/system" || pathname.startsWith("/admin/system/")) return "system:read";
  return null;
}

export function canAccessUnifiedAdminRoute(roles: readonly UnifiedAdminRole[], value: string) {
  const safe = getSafeUnifiedAdminNext(value);
  if (!safe) return false;
  const permission = getUnifiedAdminRoutePermission(splitPathSuffix(safe).pathname);
  return permission !== null && hasUnifiedAdminPermission(roles, permission);
}

export function getUnifiedAdminDefaultLanding(roles: readonly UnifiedAdminRole[]) {
  if (roles.includes("SUPER_ADMIN") || roles.length > 1) return "/admin";
  if (roles.includes("CONTENT_EDITOR")) return "/admin/content/news";
  if (roles.includes("COMPETITION_ADMIN")) return "/admin/competitions";
  if (roles.includes("REFEREE_ADMIN")) return "/admin/referees";
  return "/admin/login";
}

export function resolveAuthorizedLegacyAdminDestination(
  value: string,
  roles: readonly UnifiedAdminRole[],
) {
  const { pathname, suffix } = splitPathSuffix(value);
  if (pathname === "/referees/admin" || pathname === "/referees/admin/") {
    return getUnifiedAdminDefaultLanding(roles);
  }

  const canReadCompetitions = hasUnifiedAdminPermission(roles, "competitions:read");
  const canReadReferees = hasUnifiedAdminPermission(roles, "referees:read");
  if (pathname === "/referees/admin/matches") {
    if (canReadCompetitions) return `/admin/matches${suffix}`;
    if (canReadReferees) return `/admin/appointments${suffix}`;
    return null;
  }

  const matchDetail = pathname.match(/^\/referees\/admin\/matches\/(?!competitions$)([^/]+)$/);
  if (matchDetail) {
    const id = encodeURIComponent(decodeURIComponent(matchDetail[1]));
    if (canReadCompetitions) return `/admin/matches/${id}${suffix}`;
    if (canReadReferees) return `/admin/appointments/${id}${suffix}`;
    return null;
  }

  const mapped = mapLegacyAdminPathToUnified(value);
  return mapped && canAccessUnifiedAdminRoute(roles, mapped) ? mapped : null;
}

export function getAuthorizedUnifiedAdminReturnTo(
  value: string | string[] | undefined,
  roles: readonly UnifiedAdminRole[],
) {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (candidate?.startsWith("/referees/admin")) {
    return resolveAuthorizedLegacyAdminDestination(candidate, roles)
      ?? getUnifiedAdminDefaultLanding(roles);
  }
  const safe = getSafeUnifiedAdminNext(value);
  return safe && canAccessUnifiedAdminRoute(roles, safe)
    ? safe
    : getUnifiedAdminDefaultLanding(roles);
}
