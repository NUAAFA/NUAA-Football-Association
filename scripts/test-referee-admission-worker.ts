import { randomBytes } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { createClient } from "@libsql/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "../src/generated/prisma-v29/client";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function applyMigrations(url: string) {
  const client = createClient({ url });
  const entries = await readdir(path.resolve("prisma/migrations"), { withFileTypes: true });
  for (const entry of entries.filter((item) => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const sql = await readFile(path.resolve("prisma/migrations", entry.name, "migration.sql"), "utf8");
    await client.executeMultiple(sql);
  }
  client.close();
}

async function main() {
  const databasePath = process.env.REFEREE_ADMISSION_TEST_DATABASE_PATH;
  if (!databasePath) throw new Error("REFEREE_ADMISSION_TEST_DATABASE_PATH is required.");
  const url = `file:${databasePath.replaceAll("\\", "/")}`;
  process.env.DATABASE_URL = url;
  process.env.REFEREE_ADMIN_SESSION_SECRET = randomBytes(32).toString("base64url");
  process.env.REFEREE_MEMBER_SESSION_SECRET = randomBytes(32).toString("base64url");

  await applyMigrations(url);

  const verifier = new PrismaClient({ adapter: new PrismaLibSql({ url }) });
  const route = await import("../src/app/api/referees/admission-applications/route");
  const endpoint = "http://localhost/api/referees/admission-applications";

  const postJson = (body: unknown, origin = "http://localhost") => route.POST(new Request(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify(body),
  }));
  const postRaw = (body: string) => route.POST(new Request(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost" },
    body,
  }));

  try {
    const before = {
      admissions: await verifier.refereeAdmissionApplication.count(),
      matchApplications: await verifier.refereeApplication.count(),
      appointments: await verifier.refereeAppointment.count(),
      referees: await verifier.referee.count(),
    };

    const assertAccepted = async (
      input: Record<string, unknown>,
      expected: { phone: string | null; qq: string | null },
      message: string,
    ) => {
      const response = await postJson(input);
      const body = await response.json() as {
        ok?: boolean;
        applicationId?: string;
        status?: string;
      };
      assert(response.status === 201 && body.ok, `${message}未成功提交。`);
      assert(body.status === "PENDING", `${message}未返回 PENDING 状态。`);
      assert(body.applicationId === undefined, `${message}泄露了内部申请 ID。`);
      const persisted = await verifier.refereeAdmissionApplication.findFirst({
        where: { studentId: String(input.studentId).trim().toUpperCase() }, orderBy: { createdAt: "desc" },
      });
      assert(persisted, `${message}未持久化。`);
      assert(persisted.status === "PENDING", `${message}未以 PENDING 状态持久化。`);
      assert(
        persisted.phone === expected.phone && persisted.qq === expected.qq,
        `${message}的联系方式未正确持久化。`,
      );
      return persisted;
    };
    let rejectedStudentSequence = 0;
    const assertRejected = async (input: unknown, message: string, preserveMissingStudentId = false) => {
      const count = await verifier.refereeAdmissionApplication.count();
      rejectedStudentSequence += 1;
      const bodyInput = !preserveMissingStudentId && input && typeof input === "object" && !Array.isArray(input) && !("studentId" in input)
        ? { ...input, studentId: `16R2${String(rejectedStudentSequence).padStart(4, "0")}` }
        : input;
      const response = await postJson(bodyInput);
      const body = await response.json() as { error?: string };
      assert(response.status === 400, `${message}未返回 400。`);
      assert(typeof body.error === "string" && body.error.length > 0, `${message}未返回可读错误。`);
      assert(
        await verifier.refereeAdmissionApplication.count() === count,
        `${message}仍写入了数据库。`,
      );
    };

    const phoneOnly = await assertAccepted(
      {
        name: "  新裁判申请人  ",
        studentId: "  16260001  ",
        phone: "  13800000000  ",
        qq: "",
        note: "  希望参加协会裁判培训  ",
      },
      { phone: "13800000000", qq: null },
      "合法手机号申请",
    );
    assert(
      phoneOnly.name === "新裁判申请人" &&
        phoneOnly.studentId === "16260001" &&
        phoneOnly.note === "希望参加协会裁判培训",
      "准入申请未按既有文本规则规范化保存。",
    );

    await assertAccepted(
      { name: "QQ申请人", studentId: "16260002", phone: "", qq: "12345678" },
      { phone: null, qq: "12345678" },
      "仅 QQ 申请",
    );
    await assertAccepted(
      { name: "QQ五位边界", studentId: "16260003", qq: "12345" },
      { phone: null, qq: "12345" },
      "五位 QQ 申请",
    );
    await assertAccepted(
      { name: "QQ十二位边界", studentId: "16260004", qq: "123456789012" },
      { phone: null, qq: "123456789012" },
      "十二位 QQ 申请",
    );
    await assertAccepted(
      { name: "双联系方式申请", studentId: "16260005", phone: "18912345678", qq: "12345678" },
      { phone: "18912345678", qq: "12345678" },
      "双联系方式申请",
    );
    assert(
      await verifier.refereeAdmissionApplication.count() === before.admissions + 5,
      "有效场景没有且仅创建五条准入申请。",
    );

    await assertRejected({ name: "缺少学号", phone: "13800000000" }, "缺少学号", true);
    await assertRejected({ name: "手机号十位", phone: "1380000000" }, "十位手机号");
    await assertRejected({ name: "手机号十二位", phone: "138000000000" }, "十二位手机号");
    await assertRejected({ name: "手机号含字母", phone: "13800abc000" }, "含字母手机号");
    await assertRejected({ name: "手机号含区号", phone: "+8613800000000" }, "含 +86 手机号");
    await assertRejected({ name: "QQ四位", qq: "1234" }, "四位 QQ");
    await assertRejected({ name: "QQ十三位", qq: "1234567890123" }, "十三位 QQ");
    await assertRejected({ name: "QQ含字母", qq: "12abc34" }, "含字母 QQ");
    await assertRejected({ name: "无联系方式申请人" }, "无联系方式申请");
    await assertRejected(
      { name: "合法手机非法QQ", phone: "13800000000", qq: "abcde" },
      "合法手机号与非法 QQ 组合",
    );
    await assertRejected(
      { name: "非法手机合法QQ", phone: "abc", qq: "12345678" },
      "非法手机号与合法 QQ 组合",
    );
    await assertRejected([], "非对象 body");
    await assertRejected({ name: 123, phone: "13800000000" }, "字段类型错误");
    await assertRejected({ name: "超".repeat(49), phone: "13800000000" }, "字段超长");

    const malformedCount = await verifier.refereeAdmissionApplication.count();
    const malformedResponse = await postRaw('{"name":');
    const malformedBody = await malformedResponse.json() as { error?: string };
    assert(malformedResponse.status === 400, "Malformed JSON 未返回 400。");
    assert(malformedBody.error === "请求内容格式不正确。", "Malformed JSON 未返回固定错误。");
    assert(Object.keys(malformedBody).length === 1, "Malformed JSON response 泄露了额外字段。");
    assert(
      await verifier.refereeAdmissionApplication.count() === malformedCount,
      "Malformed JSON 仍写入了数据库。",
    );

    const originCount = await verifier.refereeAdmissionApplication.count();
    const badOriginResponse = await postJson(
      { name: "外部来源", studentId: "16260006", phone: "13800000001" },
      "https://evil.example",
    );
    assert(badOriginResponse.status === 403, "准入申请接口未拒绝非法 Origin。");
    assert(
      await verifier.refereeAdmissionApplication.count() === originCount,
      "非法 Origin 仍写入了准入申请。",
    );

    assert(
      await verifier.refereeApplication.count() === before.matchApplications,
      "准入提交错误创建或修改了比赛执裁申请。",
    );
    assert(
      await verifier.refereeAppointment.count() === before.appointments,
      "准入提交错误创建或修改了裁判选派。",
    );
    assert(
      await verifier.referee.count() === before.referees,
      "准入提交错误创建或启用了 Referee 账号。",
    );

    await verifier.$executeRawUnsafe('DROP TABLE "RefereeAdmissionApplication"');
    const originalConsoleError = console.error;
    let internalErrorLogged = false;
    console.error = () => {
      internalErrorLogged = true;
    };
    const internalResponse = await (async () => {
      try {
        return await postJson({ name: "内部错误测试", studentId: "16260007", phone: "13800000000" });
      } finally {
        console.error = originalConsoleError;
      }
    })();
    const internalBody = await internalResponse.json() as { error?: string };
    assert(internalResponse.status === 500, "Persistence failure 未返回 500。");
    assert(internalErrorLogged, "Persistence failure 未按现有约定记录到服务端。");
    assert(
      internalBody.error === "申请提交失败，请稍后重试。" && Object.keys(internalBody).length === 1,
      "Persistence failure 未返回固定安全错误。",
    );
    const serializedInternalBody = JSON.stringify(internalBody);
    for (const forbidden of ["Prisma", "SQLite", "stack", databasePath]) {
      assert(!serializedInternalBody.includes(forbidden), `500 response 泄露内部信息：${forbidden}`);
    }

    console.log("Referee admission application validation and error-boundary tests passed.");
  } finally {
    await verifier.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Referee admission test failed.");
  process.exit(1);
});
