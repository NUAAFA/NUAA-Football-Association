import { randomBytes } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { createClient } from "@libsql/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "../src/generated/prisma-v29/client";
import type { RefereeCapabilityStatus } from "../src/lib/referee-profile-options";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function applyMigrations(url: string) {
  const client = createClient({ url });
  const entries = await readdir(path.resolve("prisma/migrations"), { withFileTypes: true });
  for (const entry of entries.filter((item) => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    await client.executeMultiple(await readFile(path.resolve("prisma/migrations", entry.name, "migration.sql"), "utf8"));
  }
  client.close();
}

async function main() {
  const databasePath = process.env.REFEREE_FIX3_TEST_DATABASE_PATH;
  if (!databasePath) throw new Error("REFEREE_FIX3_TEST_DATABASE_PATH is required.");
  const url = `file:${databasePath.replaceAll("\\", "/")}`;
  process.env.DATABASE_URL = url;
  process.env.REFEREE_ADMIN_SESSION_SECRET = randomBytes(32).toString("base64url");
  process.env.REFEREE_MEMBER_SESSION_SECRET = randomBytes(32).toString("base64url");
  process.env.NUAAFA_ISOLATED_SECURITY_TEST = "1";
  await applyMigrations(url);

  const verifier = new PrismaClient({ adapter: new PrismaLibSql({ url }) });
  const service = await import("../src/lib/referee-service");
  const r1 = await import("../src/lib/referee-r1-service");
  const conflicts = await import("../src/lib/referee-conflicts");
  const roles = await import("../src/lib/referee-roles");
  const dto = await import("../src/lib/referee-dto");
  const profile = await import("../src/lib/referee-profile-options");
  const capabilities = await import("./security-r4a-test-capabilities");
  const { prisma } = await import("../src/lib/prisma");
  const actor = { id: null, role: "SUPER_ADMIN" as const };
  const refereeAuthorization = capabilities.issueTestAdminServiceAuthorization(
    "referees:write",
    capabilities.testUnifiedAdminActor({ isLegacy: true }),
  );

  try {
    const expectedColleges = [
      "航空学院", "能源与动力学院", "自动化学院", "电子信息工程学院", "机电学院",
      "材料科学与技术学院", "民航学院", "数学学院", "经济与管理学院", "人文与社会科学学院",
      "艺术学院", "外国语学院", "航天学院", "计算机科学与技术学院/软件学院", "马克思主义学院",
      "长空学院", "国际教育学院", "通用航空与飞行学院", "物理学院", "集成电路学院",
      "人工智能学院", "伦敦国际学院", "继续教育学院",
    ].sort();
    const actualColleges = (await verifier.affiliationUnit.findMany({
      where: { type: "COLLEGE" },
      select: { name: true },
    })).map((item) => item.name).sort();
    assert(actualColleges.join("|") === expectedColleges.join("|"), "23 个学院权威名单不正确。");
    assert(!actualColleges.includes("牧星学院") && !actualColleges.includes("国家卓越工程师学院"), "学院名单仍含明确排除项。");

    const expectedRelations: Record<string, string[]> = {
      致慧书院: ["民航学院", "自动化学院", "通用航空与飞行学院"],
      致元书院: ["材料科学与技术学院", "数学学院", "计算机科学与技术学院/软件学院", "人工智能学院"],
      致微书院: ["电子信息工程学院", "物理学院", "集成电路学院"],
      致和书院: ["经济与管理学院", "人文与社会科学学院", "艺术学院", "外国语学院"],
    };
    assert(await verifier.affiliationUnit.count({ where: { type: "SHUYUAN" } }) === 4, "四个书院未完整初始化。");
    for (const [parentName, expectedChildren] of Object.entries(expectedRelations)) {
      const actualChildren = (await verifier.affiliationUnitRelation.findMany({
        where: { parentUnit: { name: parentName } },
        select: { childUnit: { select: { name: true } } },
      })).map((item) => item.childUnit.name).sort();
      assert(actualChildren.join("|") === [...expectedChildren].sort().join("|"), `${parentName}组成关系不正确。`);
    }

    const prefixCases = [
      ["0100000000", "航空学院"], ["0700000000", "民航学院"],
      ["1000000000", "人文与社会科学学院"], ["2400000000", "人工智能学院"],
      ["CG00000000", "继续教育学院"], ["cg00000000", "继续教育学院"],
      ["CZ00000000", "继续教育学院"],
    ] as const;
    for (const [studentId, collegeName] of prefixCases) {
      assert((await r1.inferCollegeSuggestion(studentId))?.college.name === collegeName, `${studentId.slice(0, 2)} 学号前缀建议错误。`);
    }

    const aiCollege = await verifier.college.findUniqueOrThrow({ where: { name: "人工智能学院" } });
    const physicsCollege = await verifier.college.findUniqueOrThrow({ where: { name: "物理学院" } });
    const zhiyuan = await verifier.affiliationUnit.findUniqueOrThrow({ where: { name: "致元书院" } });
    const zhiwei = await verifier.affiliationUnit.findUniqueOrThrow({ where: { name: "致微书院" } });
    const directReferee = await service.createRefereeAccount({
      publicCode: "FIX3-GRADE", name: "年级归属测试裁判", initialPassword: "Fix3-Test-Password-2026", status: "ACTIVE",
      elevenASide: true, futsal: false, trainingStatus: "IN_TRAINING", assignmentEligibility: "ELIGIBLE", publicDirectoryEnabled: true,
      publicBio: "公开简介", internalNote: "内部备注", phone: "13800000000", studentId: "2400000000",
      collegeId: aiCollege.id, grade: "大一", currentAffiliationUnitId: zhiyuan.id,
      capabilities: [{ format: "ELEVEN_A_SIDE", positionKey: "REFEREE", status: "READY" }],
    }, refereeAuthorization);
    const baseUpdate = {
      gradeChangeReason: "虚构人工学籍核实",
      publicCode: directReferee.publicCode, name: directReferee.name, status: "ACTIVE" as const,
      elevenASide: true, futsal: false, trainingStatus: "IN_TRAINING" as const, assignmentEligibility: "ELIGIBLE" as const,
      publicDirectoryEnabled: true, publicBio: "公开简介", internalNote: "内部备注",
      phone: "13800000000", studentId: "2400000000", collegeId: aiCollege.id,
      currentAffiliationUnitId: zhiyuan.id,
      capabilities: [{ format: "ELEVEN_A_SIDE" as const, positionKey: "REFEREE" as const, status: "READY" as const }],
    };
    for (const grade of profile.refereeGrades) {
      await service.updateRefereeAccount(directReferee.id, { ...baseUpdate, grade }, refereeAuthorization);
      const saved = await verifier.referee.findUniqueOrThrow({ where: { id: directReferee.id } });
      assert(saved.grade === grade, `${grade}不能保存。`);
      assert(saved.currentAffiliationUnitId === zhiyuan.id, `${grade}保存时错误覆盖了人工确认的当前组织归属。`);
      if (grade === "已毕业") assert(saved.status === "ACTIVE", "已毕业被错误自动停用。");
    }
    await service.updateRefereeAccount(directReferee.id, {
      ...baseUpdate, grade: "大四", currentAffiliationUnitId: aiCollege.id,
    }, refereeAuthorization);
    const affiliationHistory = await verifier.refereeAffiliation.findMany({ where: { refereeId: directReferee.id } });
    assert(
      (await verifier.referee.findUniqueOrThrow({ where: { id: directReferee.id } })).collegeId === aiCollege.id &&
      new Set(affiliationHistory.map((item) => item.unitId)).has(zhiyuan.id) &&
      new Set(affiliationHistory.map((item) => item.unitId)).has(aiCollege.id),
      "学院背景或历史直接归属未被保留。",
    );

    const competition = await verifier.competition.create({
      data: { slug: "fix3-competition", name: "Fix3 组织赛事", campus: "天目湖校区", format: "ELEVEN_A_SIDE", status: "ONGOING" },
    });
    const away = await verifier.team.create({ data: { competitionId: competition.id, name: "自由客队", teamType: "FREEFORM" } });
    async function organizationWarning(collegeId: string, unitId: string, unitName: string, code: string) {
      const referee = await service.createRefereeAccount({
        publicCode: code, name: code, initialPassword: "Fix3-Test-Password-2026", status: "ACTIVE",
        elevenASide: true, futsal: false, trainingStatus: "QUALIFIED", assignmentEligibility: "ELIGIBLE", publicDirectoryEnabled: false,
        collegeId, capabilities: [{ format: "ELEVEN_A_SIDE", positionKey: "REFEREE", status: "READY" }],
      }, refereeAuthorization);
      const team = await verifier.team.create({ data: { competitionId: competition.id, name: unitName, teamType: "ORGANIZATION" } });
      await r1.setTeamUnitAffiliations(team.id, [unitId], "ORGANIZATION", actor);
      const match = await verifier.match.create({ data: {
        slug: `fix3-${code.toLowerCase()}`, competitionId: competition.id, stage: "组织回避", kickoff: new Date("2032-01-01T10:00:00+08:00"),
        endAt: new Date("2032-01-01T12:00:00+08:00"), venue: "测试场地", homeTeamId: team.id, awayTeamId: away.id, status: "SCHEDULED",
      } });
      return conflicts.detectAppointmentWarnings(match.id, [{ key: "REFEREE", refereeId: referee.id }], verifier);
    }
    assert((await organizationWarning(aiCollege.id, zhiyuan.id, "致元书院", "FIX3-AI")).some((item) => item.code === "COLLEGE_CONFLICT" && item.message.includes("人工智能学院") && item.message.includes("组成单位")), "人工智能学院对致元书院未产生组成单位提醒。");
    assert((await organizationWarning(physicsCollege.id, zhiwei.id, "致微书院", "FIX3-PHYSICS")).some((item) => item.code === "COLLEGE_CONFLICT" && item.message.includes("物理学院") && item.message.includes("组成单位")), "物理学院对致微书院未产生组成单位提醒。");

    const initialStates: Record<string, RefereeCapabilityStatus> = {};
    for (const format of ["ELEVEN_A_SIDE", "FUTSAL"] as const) {
      for (const item of roles.getPositionTemplate(format)) initialStates[`${format}:${item.key}`] = "READY";
    }
    const elevenTraining = profile.applyCapabilityBatch(initialStates, "ELEVEN_A_SIDE", roles.getPositionTemplate("ELEVEN_A_SIDE").map((item) => item.key), "TRAINING");
    assert(Object.entries(elevenTraining).filter(([key]) => key.startsWith("ELEVEN_A_SIDE:")).every(([, value]) => value === "TRAINING"), "十一人制批量设置未覆盖本制式。");
    assert(Object.entries(elevenTraining).filter(([key]) => key.startsWith("FUTSAL:")).every(([, value]) => value === "READY"), "十一人制批量设置错误影响五人制。");
    const bothTraining = profile.applyCapabilityBatch(elevenTraining, "FUTSAL", roles.getPositionTemplate("FUTSAL").map((item) => item.key), "TRAINING");
    const individuallyOverridden: Record<string, RefereeCapabilityStatus> = { ...bothTraining, "ELEVEN_A_SIDE:REFEREE": "READY" };
    assert(individuallyOverridden["ELEVEN_A_SIDE:REFEREE"] === "READY" && individuallyOverridden["ELEVEN_A_SIDE:ASSISTANT_REFEREE_1"] === "TRAINING", "批量设置后不能单项覆盖。");

    const capabilityReferee = await service.createRefereeAccount({
      publicCode: "FIX3-CAP", name: "批量能力测试", initialPassword: "Fix3-Test-Password-2026", status: "ACTIVE",
      elevenASide: true, futsal: true, trainingStatus: "IN_TRAINING", assignmentEligibility: "ELIGIBLE", publicDirectoryEnabled: false,
      capabilities: Object.entries(initialStates).map(([identity, status]) => {
        const [format, positionKey] = identity.split(":");
        return { format: format as "ELEVEN_A_SIDE" | "FUTSAL", positionKey: positionKey as never, status };
      }),
    }, refereeAuthorization);
    assert((await verifier.refereePositionCapability.count({ where: { refereeId: capabilityReferee.id, status: "READY" } })) === 10, "表单批量选择在保存前错误写入数据库。");
    await service.updateRefereeAccount(capabilityReferee.id, {
      publicCode: capabilityReferee.publicCode, name: capabilityReferee.name, status: "ACTIVE",
      elevenASide: true, futsal: true, trainingStatus: "IN_TRAINING", assignmentEligibility: "ELIGIBLE", publicDirectoryEnabled: false,
      capabilities: Object.entries(individuallyOverridden).map(([identity, status]) => {
        const [format, positionKey] = identity.split(":");
        return { format: format as "ELEVEN_A_SIDE" | "FUTSAL", positionKey: positionKey as never, status };
      }),
    }, refereeAuthorization);
    const refreshedCapabilities = await verifier.refereePositionCapability.findMany({ where: { refereeId: capabilityReferee.id } });
    assert(refreshedCapabilities.find((item) => item.format === "ELEVEN_A_SIDE" && item.positionKey === "REFEREE")?.status === "READY" && refreshedCapabilities.filter((item) => item.status === "TRAINING").length === 9, "岗位培养状态保存刷新后不正确。");

    const publicRecord = await verifier.referee.findUniqueOrThrow({ where: { id: directReferee.id }, select: dto.publicDirectoryRefereeSelect });
    const publicJson = JSON.stringify(publicRecord);
    for (const secret of ["2400000000", "13800000000", "内部备注", "致元书院", "人工智能学院"]) {
      assert(!publicJson.includes(secret), "Public DTO 或预览允许字段泄露了内部资料。");
    }

    const formSource = await readFile(path.resolve("src/components/referees/admin/admin-referee-forms.tsx"), "utf8");
    const cssSource = await readFile(path.resolve("src/styles/referee-admin.css"), "utf8");
    assert(cssSource.includes(".admin-profile-grid input, .admin-profile-grid select { height: 42px") && cssSource.includes(".admin-profile-grid label > span") && cssSource.includes("font-size: 11px"), "基本资料控件高度或 label 层级未按紧凑布局实现。");
    assert(formSource.includes('role="switch"') && formSource.includes('rows={5}') && cssSource.includes(".admin-public-settings textarea { min-height: 116px"), "公开展示 Switch 或简介尺寸未正确实现。");
    assert(formSource.includes('["security", "账号与安全"]') && formSource.includes('if (value !== "security") setPasswordMessage("")') && formSource.includes("admin-form-savebar"), "账号安全分区、跨 Tab 提示清理或保存栏未实现。");
    const publicPreviewStart = formSource.indexOf("admin-public-preview");
    const publicPreviewSource = formSource.slice(publicPreviewStart, formSource.indexOf("</aside>", publicPreviewStart));
    assert(!/studentId|phone|qq|internalNote|password/i.test(publicPreviewSource), "Public Preview 引用了敏感字段。");

    console.log(JSON.stringify({
      authoritativeCollegeNames: true, excludedCollegesAbsent: true, fourShuyuanRelations: true,
      allConfirmedPrefixes: true, lowercasePrefixInference: true, allGradesPersist: true,
      graduateRemainsActive: true, singleCurrentAffiliation: true, affiliationHistoryPreserved: true,
      aiToZhiyuanConflict: true, physicsToZhiweiConflict: true, formatScopedCapabilityBatch: true,
      individualCapabilityOverride: true, capabilityFormStateNotPersistedBeforeSave: true,
      capabilityStatePersistsAfterSave: true, compactProfileUi: true, publicSwitchAndBio: true,
      publicPreviewBoundary: true, accountSecurityTab: true, passwordMessageScoped: true, saveBar: true,
    }, null, 2));
  } finally {
    await verifier.$disconnect();
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : "Referee Fix #3 test failed.");
  process.exit(1);
});
