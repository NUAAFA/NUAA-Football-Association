import { randomBytes } from "node:crypto";

import type {
  CompetitionFormat,
  CompetitionStatus,
} from "@/generated/prisma-v29/client";
import type { CompetitionMutationInput } from "@/lib/referee-competition-input";
import { prisma } from "@/lib/prisma";
import {
  requireAdminServiceAuthorization,
  type AdminServiceAuthorization,
} from "@/lib/privileged-service-authorization";
import type { AdminActor } from "@/lib/referee-service";
import { RefereeServiceError } from "@/lib/referee-service-error";

type CompetitionInput = {
  slug?: string;
  name: string;
  year?: number | null;
  campus?: string;
  format: CompetitionFormat;
  playingFormat?: string;
  status: CompetitionStatus;
} & Partial<Omit<CompetitionMutationInput, "name" | "year" | "campus" | "format" | "playingFormat" | "status">>;

const publicProfileFields = [
  "name",
  "year",
  "campus",
  "format",
  "playingFormat",
  "status",
  "shortName",
  "semesterLabel",
  "teamFormation",
  "publicPublished",
  "homepageFeatured",
  "publicOrder",
  "registrationStartAt",
  "registrationEndAt",
  "matchStartAt",
  "matchEndAt",
  "venue",
  "host",
  "organizer",
  "summary",
  "notice",
  "registrationUrl",
] as const;

const homepagePublishedError = "只有已公开发布的赛事才能在首页赛事预告中展示。";

function manualCompetitionSlug(year?: number | null) {
  return `manual-${year ?? "competition"}-${randomBytes(6).toString("hex")}`;
}

function isUniqueConstraintError(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

function dateValue(value: unknown) {
  return value instanceof Date ? value.getTime() : value;
}

function changedFields(existing: Record<string, unknown>, updated: Record<string, unknown>) {
  return publicProfileFields.filter((field) => dateValue(existing[field]) !== dateValue(updated[field]));
}

function resolvePlayingFormat(format: CompetitionFormat, value?: string | null, existing?: string | null) {
  const playingFormat = value?.trim() || existing?.trim();
  if (playingFormat) {
    if (playingFormat.length > 40) throw new RefereeServiceError("比赛制式不能超过 40 个字符。");
    return playingFormat;
  }
  if (format === "ELEVEN_A_SIDE") return "十一人制";
  if (format === "FUTSAL") return "五人制";
  throw new RefereeServiceError("自定义赛事必须填写实际比赛制式。");
}

async function assertHomepageFeatureAllowed(
  input: { publicPublished: boolean; homepageFeatured: boolean },
) {
  if (!input.homepageFeatured) return;
  if (!input.publicPublished) {
    throw new RefereeServiceError(homepagePublishedError, 409);
  }

}

export async function createCompetition(input: CompetitionInput, actor: AdminActor) {
  const slug = input.slug ?? manualCompetitionSlug(input.year);
  try {
    return await prisma.$transaction(async (tx) => {
      const publicPublished = input.publicPublished ?? false;
      const homepageFeatured = input.homepageFeatured ?? false;
      const playingFormat = resolvePlayingFormat(input.format, input.playingFormat);
      await assertHomepageFeatureAllowed({ publicPublished, homepageFeatured });
      const competition = await tx.competition.create({
        data: {
          slug,
          name: input.name,
          shortName: input.shortName ?? null,
          year: input.year ?? null,
          campus: input.campus ?? "天目湖校区",
          format: input.format,
          playingFormat,
          status: input.status,
          semesterLabel: input.semesterLabel ?? null,
          teamFormation: input.teamFormation ?? null,
          publicPublished,
          homepageFeatured,
          publicOrder: input.publicOrder ?? 0,
          registrationStartAt: input.registrationStartAt ?? null,
          registrationEndAt: input.registrationEndAt ?? null,
          matchStartAt: input.matchStartAt ?? null,
          matchEndAt: input.matchEndAt ?? null,
          venue: input.venue ?? null,
          host: input.host ?? null,
          organizer: input.organizer ?? null,
          summary: input.summary ?? null,
          notice: input.notice ?? null,
          registrationUrl: input.registrationUrl ?? null,
          source: "MANUAL",
        },
      });
      await tx.auditLog.create({
        data: {
          actorType: "ADMIN",
          actorId: actor.id,
          action: "COMPETITION_CREATED",
          entityType: "Competition",
          entityId: competition.id,
          summary: `创建赛事 ${competition.name}`,
          metadata: JSON.stringify({
            slug: competition.slug,
            source: competition.source,
            status: competition.status,
            publicPublished: competition.publicPublished,
            homepageFeatured: competition.homepageFeatured,
            changedFields: ["slug", ...publicProfileFields],
          }),
        },
      });
      return competition;
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new RefereeServiceError("赛事 Slug 已存在，请使用另一个稳定标识。", 409);
    }
    throw error;
  }
}

export async function updateCompetition(id: string, input: CompetitionInput, actor: AdminActor) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.competition.findUnique({
      where: { id },
      include: { _count: { select: { matches: true } } },
    });
    if (!existing) throw new RefereeServiceError("赛事不存在。", 404);
    if (existing.format !== input.format && existing._count.matches > 0) {
      throw new RefereeServiceError("已有比赛的赛事不能直接更改比赛制式。", 409);
    }
    const publicPublished = input.publicPublished ?? existing.publicPublished;
    const homepageFeatured = input.homepageFeatured ?? existing.homepageFeatured;
    const playingFormat = resolvePlayingFormat(input.format, input.playingFormat, existing.playingFormat);
    await assertHomepageFeatureAllowed(
      { publicPublished, homepageFeatured },
    );
    const data = {
      name: input.name,
      shortName: input.shortName === undefined ? existing.shortName : input.shortName,
      year: input.year === undefined ? existing.year : input.year,
      campus: input.campus ?? existing.campus,
      format: input.format,
      playingFormat,
      status: input.status,
      semesterLabel: input.semesterLabel === undefined ? existing.semesterLabel : input.semesterLabel,
      teamFormation: input.teamFormation === undefined ? existing.teamFormation : input.teamFormation,
      publicPublished,
      homepageFeatured,
      publicOrder: input.publicOrder ?? existing.publicOrder,
      registrationStartAt: input.registrationStartAt === undefined ? existing.registrationStartAt : input.registrationStartAt,
      registrationEndAt: input.registrationEndAt === undefined ? existing.registrationEndAt : input.registrationEndAt,
      matchStartAt: input.matchStartAt === undefined ? existing.matchStartAt : input.matchStartAt,
      matchEndAt: input.matchEndAt === undefined ? existing.matchEndAt : input.matchEndAt,
      venue: input.venue === undefined ? existing.venue : input.venue,
      host: input.host === undefined ? existing.host : input.host,
      organizer: input.organizer === undefined ? existing.organizer : input.organizer,
      summary: input.summary === undefined ? existing.summary : input.summary,
      notice: input.notice === undefined ? existing.notice : input.notice,
      registrationUrl: input.registrationUrl === undefined ? existing.registrationUrl : input.registrationUrl,
    };
    const fields = changedFields(existing, data);
    const competition = await tx.competition.update({ where: { id }, data });
    await tx.auditLog.create({
      data: {
        actorType: "ADMIN",
        actorId: actor.id,
        action: "COMPETITION_UPDATED",
        entityType: "Competition",
        entityId: competition.id,
        summary: `更新赛事 ${competition.name}`,
        metadata: JSON.stringify({
          changedFields: fields,
          ...(existing.status !== competition.status
            ? { statusChange: { from: existing.status, to: competition.status } }
            : {}),
          ...(existing.publicPublished !== competition.publicPublished
            ? { publicPublishedChange: { from: existing.publicPublished, to: competition.publicPublished } }
            : {}),
          ...(existing.homepageFeatured !== competition.homepageFeatured
            ? { homepageFeaturedChange: { from: existing.homepageFeatured, to: competition.homepageFeatured } }
            : {}),
        }),
      },
    });
    return competition;
  });
}

export async function deleteCompetitionSafely(
  id: string,
  confirmationName: string,
  authorization: AdminServiceAuthorization<"competitions:write">,
) {
  const actor = requireAdminServiceAuthorization(authorization, "competitions:write");
  return prisma.$transaction(async (tx) => {
    const competition = await tx.competition.findUnique({
      where: { id },
      select: {
        id: true,
        slug: true,
        name: true,
        status: true,
        source: true,
        externalCompetitionId: true,
        publicPublished: true,
        homepageFeatured: true,
        _count: { select: { teams: true, matches: true, disciplineDetails: true } },
      },
    });
    if (!competition) throw new RefereeServiceError("赛事不存在。", 404);
    if (confirmationName.trim() !== competition.name) {
      throw new RefereeServiceError("赛事名称确认不一致，已取消删除。", 409);
    }

    const reasons = [
      competition._count.teams ? `${competition._count.teams} 支参赛球队` : "",
      competition._count.matches ? `${competition._count.matches} 场比赛` : "",
      competition._count.disciplineDetails ? `${competition._count.disciplineDetails} 条赛事纪律资料` : "",
      competition.publicPublished ? "已公开发布" : "",
      competition.homepageFeatured ? "已进入首页展示" : "",
      competition.source !== "MANUAL" || competition.externalCompetitionId ? "已关联外部数据来源" : "",
    ].filter(Boolean);
    if (reasons.length) {
      throw new RefereeServiceError(
        `赛事“${competition.name}”已有受保护业务记录（${reasons.join("、")}），不能删除。请先核对并保留正式历史。`,
        409,
      );
    }

    await tx.competition.delete({ where: { id: competition.id } });
    await tx.auditLog.create({
      data: {
        actorType: "ADMIN",
        actorId: actor.id,
        action: "COMPETITION_DELETED",
        entityType: "Competition",
        entityId: competition.id,
        summary: `删除赛事 ${competition.name}`,
        metadata: JSON.stringify({
          deletedAt: new Date().toISOString(),
          competitionName: competition.name,
          slug: competition.slug,
          status: competition.status,
          source: competition.source,
        }),
      },
    });
    return { id: competition.id, name: competition.name, slug: competition.slug };
  });
}
