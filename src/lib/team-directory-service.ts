import { prisma } from "@/lib/prisma";
import { sortTeamDirectory, teamDirectoryUnitSelect } from "@/lib/team-directory-order";

export function formatTeamDirectoryTitle(name: string, year: number | null) {
  const cleanName = name.trim();
  const prefix = year && !new RegExp(`(^|\\D)${year}(\\D|$)`, "u").test(cleanName) ? `${year} ` : "";
  return `${prefix}${cleanName}组队目录`;
}

/** Only fields intentionally approved for the public directory leave this service. */
export async function getPublicTeamDirectory() {
  const settings = await prisma.teamDirectorySettings.findUnique({
    where: { id: "current" },
    select: {
      directoryPublished: true,
      contactName: true,
      contactTitle: true,
      contactQQ: true,
      contactEmail: true,
      activeCompetition: {
        select: {
          id: true,
          name: true,
          year: true,
          slug: true,
          publicPublished: true,
          isTestData: true,
          teams: {
            where: { directoryIsPublic: true },
            select: {
              id: true,
              name: true,
              unitAffiliations: { select: { unit: { select: teamDirectoryUnitSelect } } },
              publicStatus: true,
              publicContactName: true,
              publicContactRole: true,
              publicContactQQ: true,
              publicContactEmail: true,
              publicDirectoryNote: true,
            },
          },
        },
      },
    },
  });
  const active = settings?.directoryPublished && !settings.activeCompetition?.isTestData
    ? settings.activeCompetition
    : null;
  return {
    contact: {
      name: settings?.contactName ?? null,
      title: settings?.contactTitle ?? null,
      qq: settings?.contactQQ ?? null,
      email: settings?.contactEmail ?? null,
    },
    competition: active ? {
      title: formatTeamDirectoryTitle(active.name, active.year),
      name: active.name,
      href: active.publicPublished ? `/competitions/${active.slug}` : null,
    } : null,
    teams: sortTeamDirectory(active?.teams ?? []).map(({ unitAffiliations, ...team }) => {
      void unitAffiliations;
      return team;
    }),
  };
}
