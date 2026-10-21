import { getEffectiveRefereeGrade } from "@/lib/referee-grade";
import { NextResponse } from "next/server";

import { authorizeLegacyAdminRequest } from "@/lib/legacy-admin-authorization";
import { prisma } from "@/lib/prisma";
import { formatRefereeDateTime } from "@/lib/referee-presenters";
import { csvDocument } from "@/lib/csv-export";
import { refereeApiErrorResponse } from "@/lib/referee-api";

function csvResponse(filename: string, rows: unknown[][]) {
  const body = csvDocument(rows);
  return new NextResponse(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}

export async function GET(
  request: Request,
  context: { params: Promise<{ kind: string }> },
) {
  try {
    const authorization = await authorizeLegacyAdminRequest(request, "referees:read", { mutation: false });
    if (!authorization.ok) return authorization.response;
    const { kind } = await context.params;
    const url = new URL(request.url);

    if (kind === "referees") {
      const referees = await prisma.referee.findMany({
      select: {
        grade: true, gradeMode: true, studentId: true, enrollmentYear: true,
        publicCode: true,
        name: true,
        status: true,
        elevenASide: true,
        futsal: true,
        trainingStatus: true,
        publicDirectoryEnabled: true,
      },
      orderBy: { publicCode: "asc" },
    });
      return csvResponse("referees.csv", [
      ["裁判员编号", "姓名", "账号状态", "十一人制", "五人制", "培训状态", "公开名录授权", "当前年级", "年级来源"],
      ...referees.map((item) => [
        item.publicCode,
        item.name,
        item.status,
        item.elevenASide ? "是" : "否",
        item.futsal ? "是" : "否",
        item.trainingStatus,
        item.publicDirectoryEnabled ? "是" : "否",
        getEffectiveRefereeGrade(new Date(), item).grade ?? "学籍待核实", getEffectiveRefereeGrade(new Date(), item).source,
      ]),
      ]);
    }

    const matchId = url.searchParams.get("matchId");
    if (!matchId) {
      return NextResponse.json({ error: "请指定比赛。" }, { status: 400 });
    }
    if (kind === "applications") {
      const applications = await prisma.refereeApplication.findMany({
      where: { matchId },
      select: {
        status: true,
        preferredPositions: true,
        note: true,
        createdAt: true,
        referee: { select: { publicCode: true, name: true } },
      },
      orderBy: { createdAt: "asc" },
    });
      return csvResponse("match-applications.csv", [
      ["裁判员编号", "姓名", "报名状态", "意向岗位", "说明", "提交时间"],
      ...applications.map((item) => [
        item.referee.publicCode,
        item.referee.name,
        item.status,
        item.preferredPositions,
        item.note,
        formatRefereeDateTime(item.createdAt),
      ]),
      ]);
    }
    if (kind === "appointments") {
      const appointment = await prisma.refereeAppointment.findUnique({
      where: { matchId },
      select: {
        status: true,
        match: {
          select: {
            competition: { select: { name: true } },
            homeTeam: { select: { name: true } },
            awayTeam: { select: { name: true } },
          },
        },
        positions: {
          select: {
            label: true,
            slot: true,
            referee: { select: { publicCode: true, name: true } },
          },
          orderBy: [{ sortOrder: "asc" }, { slot: "asc" }],
        },
      },
    });
      if (!appointment) {
        return NextResponse.json({ error: "选派记录不存在。" }, { status: 404 });
      }
      return csvResponse("match-appointment.csv", [
        ["赛事", "比赛", "岗位", "岗位序号", "裁判员编号", "姓名", "状态"],
        ...appointment.positions.map((position) => [
          appointment.match.competition.name,
          `${appointment.match.homeTeam.name} vs ${appointment.match.awayTeam.name}`,
          position.label,
          position.slot,
          position.referee?.publicCode,
          position.referee?.name,
          appointment.status,
        ]),
      ]);
    }
    return NextResponse.json({ error: "导出类型不存在。" }, { status: 404 });
  } catch (error) {
    return refereeApiErrorResponse(error, "导出失败，请稍后重试。");
  }
}
