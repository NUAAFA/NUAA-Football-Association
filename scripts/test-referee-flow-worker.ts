import { createHash, randomBytes } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import { createClient } from "@libsql/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "../src/generated/prisma-v29/client";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function sourceContains(relativePath: string, fragments: string[]) {
  const source = await readFile(path.resolve(relativePath), "utf8");
  for (const fragment of fragments) {
    assert(source.includes(fragment), `${relativePath} 缺少安全检查：${fragment}`);
  }
}

async function applyMigrations(url: string) {
  const client = createClient({ url });
  const entries = await readdir(path.resolve("prisma/migrations"), { withFileTypes: true });
  for (const entry of entries.filter((item) => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const sql = await readFile(
      path.resolve("prisma/migrations", entry.name, "migration.sql"),
      "utf8",
    );
    await client.executeMultiple(sql);
  }
  client.close();
}

async function main() {
  const databasePath = process.env.REFEREE_TEST_DATABASE_PATH;
  if (!databasePath) throw new Error("REFEREE_TEST_DATABASE_PATH is required.");
  const url = `file:${databasePath.replaceAll("\\", "/")}`;
  process.env.DATABASE_URL = url;
  process.env.REFEREE_ADMIN_SESSION_SECRET = randomBytes(32).toString("base64url");
  process.env.REFEREE_MEMBER_SESSION_SECRET = randomBytes(32).toString("base64url");
  process.env.NUAAFA_ISOLATED_SECURITY_TEST = "1";
  await applyMigrations(url);

  const verifier = new PrismaClient({ adapter: new PrismaLibSql({ url }) });
  const service = await import("../src/lib/referee-service");
  const security = await import("../src/lib/referee-security");
  const credentials = await import("../src/lib/referee-credentials");
  const publicQueries = await import("../src/lib/referee-public");
  const capabilities = await import("./security-r4a-test-capabilities");
  const refereeAuthorization = capabilities.issueTestAdminServiceAuthorization(
    "referees:write",
    capabilities.testUnifiedAdminActor({ isLegacy: true }),
  );
  const auth = await import("../src/lib/referee-auth");
  const { prisma } = await import("../src/lib/prisma");

  try {
    const mutableEnvironment = process.env as Record<string, string | undefined>;
    const originalNodeEnvironment = mutableEnvironment.NODE_ENV;
    const originRequest = (url: string, origin?: string) =>
      new Request(url, {
        method: "POST",
        headers: origin === undefined ? undefined : { origin },
      });
    try {
      mutableEnvironment.NODE_ENV = "production";
      assert(
        auth.isSameOrigin(originRequest("https://nuaafa.cn/api/referees/login", "https://nuaafa.cn")),
        "生产环境规范 Origin 被错误拒绝。",
      );
      assert(
        auth.isSameOrigin(originRequest("http://nuaafa.cn/api/referees/login", "https://nuaafa.cn")) &&
          auth.isSameOrigin(
            originRequest("http://127.0.0.1:3000/api/referees/login", "https://nuaafa.cn"),
          ),
        "反向代理内部 HTTP request.url 导致规范 Origin 被错误拒绝。",
      );
      assert(
        !auth.isSameOrigin(originRequest("http://nuaafa.cn/api/referees/login", "http://nuaafa.cn")),
        "生产环境错误接受了 HTTP 官网 Origin。",
      );
      assert(
        !auth.isSameOrigin(
          originRequest("http://127.0.0.1:3000/api/referees/login", "https://www.nuaafa.cn"),
        ),
        "生产环境错误接受了 www Origin。",
      );
      assert(
        !auth.isSameOrigin(
          originRequest("http://127.0.0.1:3000/api/referees/login", "https://evil.example"),
        ),
        "生产环境错误接受了外部 Origin。",
      );
      assert(
        !auth.isSameOrigin(originRequest("http://127.0.0.1:3000/api/referees/login")),
        "生产环境错误接受了缺少 Origin 的写请求。",
      );
      assert(
        !auth.isSameOrigin(
          originRequest("http://127.0.0.1:3000/api/referees/login", "not-a-valid-origin"),
        ),
        "格式错误 Origin 未被拒绝。",
      );

      mutableEnvironment.NODE_ENV = "development";
      assert(
        auth.isSameOrigin(
          originRequest("http://localhost:3000/api/referees/login", "http://localhost:3000"),
        ),
        "开发环境本地同源请求被错误拒绝。",
      );
      assert(
        auth.isSameOrigin(
          originRequest("http://127.0.0.1:3000/api/referees/login", "http://localhost:3100"),
        ) && auth.isSameOrigin(
          originRequest("http://localhost:3100/api/referees/login", "http://127.0.0.1:4173"),
        ),
        "开发环境未支持 localhost / 127.0.0.1 的可变本机端口。",
      );
      assert(
        auth.isSameOrigin(originRequest("http://localhost:3100/api/referees/login")),
        "开发环境本机无 Origin 的工具请求被错误拒绝。",
      );
      assert(
        !auth.isSameOrigin(
          originRequest("http://localhost:3100/api/referees/login", "https://evil.example"),
        ) && !auth.isSameOrigin(
          originRequest("https://evil.example/api/referees/login", "https://evil.example"),
        ) && !auth.isSameOrigin(
          originRequest("http://localhost:3100/api/referees/login", "https://localhost:3100"),
        ),
        "开发环境错误接受了非 HTTP 本机来源或外部来源。",
      );

      mutableEnvironment.NODE_ENV = "test";
      assert(
        auth.isSameOrigin(
          originRequest("http://127.0.0.1:3200/api/referees/login", "http://localhost:5400"),
        ) && !auth.isSameOrigin(
          originRequest("http://127.0.0.1:3200/api/referees/login", "http://external.test:5400"),
        ),
        "测试环境的本机来源策略不正确。",
      );
    } finally {
      if (originalNodeEnvironment === undefined) delete mutableEnvironment.NODE_ENV;
      else mutableEnvironment.NODE_ENV = originalNodeEnvironment;
    }

    const initialPassword = randomBytes(24).toString("base64url");
    const replacementPassword = randomBytes(24).toString("base64url");
    const initialHash = await security.hashPassword(initialPassword);
    const adminPassword = randomBytes(24).toString("base64url");
    process.env.REFEREE_ADMIN_PASSWORD_HASH = await security.hashPassword(adminPassword);
    assert(initialHash !== initialPassword, "密码被明文保存。");
    assert(await security.verifyPassword(initialPassword, initialHash), "scrypt 密码校验失败。");
    assert(!security.isSessionFresh(new Date(Date.now() - 1_000)), "过期 Session 未被识别。");
    assert(security.isSessionFresh(new Date(Date.now() + 1_000)), "有效 Session 被错误拒绝。");
    assert(await credentials.verifyAdminCredentials(adminPassword), "管理员正确密码验证失败。");
    assert(
      !(await credentials.verifyAdminCredentials(randomBytes(24).toString("base64url"))),
      "管理员错误密码未被拒绝。",
    );

    const referees = [];
    for (let index = 1; index <= 6; index += 1) {
      const account = await service.createRefereeAccount({
        publicCode: `TEST-R${String(index).padStart(2, "0")}`,
        name: `自动化测试裁判 ${index}`,
        initialPassword: index === 1 ? initialPassword : randomBytes(24).toString("base64url"),
        status: "ACTIVE",
        assignmentEligibility: "ELIGIBLE",
        elevenASide: true,
        futsal: true,
        trainingStatus: index === 1 ? "QUALIFIED" : "IN_TRAINING",
        publicDirectoryEnabled: index === 1,
        publicBio: index === 1 ? "自动化公开字段验证" : "",
        internalNote: "只允许管理员读取的自动化测试备注",
        certificateNote: "未公开的自动化登记说明",
      }, refereeAuthorization);
      referees.push(account);
    }
    assert(referees[0].mustChangePassword, "新账号未要求首次登录修改密码。");
    await verifier.refereeSession.create({
      data: {
        refereeId: referees[0].id,
        tokenHash: createHash("sha256").update(randomBytes(16)).digest("hex"),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    await service.changeRefereePassword(
      referees[0].id,
      initialPassword,
      replacementPassword,
      capabilities.issueTestRefereeSelfServiceAuthorization(referees[0].id),
    );
    const changedAccount = await verifier.referee.findUniqueOrThrow({
      where: { id: referees[0].id },
    });
    assert(!changedAccount.mustChangePassword, "首次登录改密状态未清除。");
    assert(
      changedAccount.passwordHash &&
        await security.verifyPassword(replacementPassword, changedAccount.passwordHash),
      "新密码未正确保存。",
    );
    assert(
      await credentials.authenticateRefereeCredentials(referees[0].publicCode, replacementPassword),
      "裁判员正确账号密码验证失败。",
    );
    assert(
      !(await credentials.authenticateRefereeCredentials(referees[0].publicCode, initialPassword)),
      "裁判员旧密码未失效。",
    );
    assert(
      await verifier.refereeSession.count({ where: { refereeId: referees[0].id } }) === 0,
      "改密后旧 Session 未失效。",
    );
    await verifier.referee.updateMany({
      where: { id: { in: referees.slice(1).map((item) => item.id) } },
      data: { mustChangePassword: false },
    });

    let duplicateAccountBlocked = false;
    try {
      await service.createRefereeAccount({
        publicCode: referees[0].publicCode,
        name: "重复编号",
        initialPassword: randomBytes(24).toString("base64url"),
        status: "ACTIVE",
        elevenASide: true,
        futsal: false,
        trainingStatus: "PENDING_ASSESSMENT",
        publicDirectoryEnabled: false,
      }, refereeAuthorization);
    } catch (error) {
      duplicateAccountBlocked =
        error instanceof service.RefereeServiceError && error.status === 409;
    }
    assert(duplicateAccountBlocked, "重复裁判员编号未被阻止。");

    const competition = await verifier.competition.create({
      data: {
        slug: "v24-flow-test",
        name: "v2.4 独立测试赛事",
        campus: "本地自动化测试",
        format: "ELEVEN_A_SIDE",
        status: "PREPARING",
        isTestData: true,
      },
    });
    const homeTeam = await verifier.team.create({
      data: { competitionId: competition.id, name: "自动化甲队" },
    });
    const awayTeam = await verifier.team.create({
      data: { competitionId: competition.id, name: "自动化乙队" },
    });
    const kickoff = new Date(Date.now() + 24 * 60 * 60 * 1_000);
    const requirements = {
      REFEREE: 1,
      ASSISTANT_REFEREE_1: 1,
      ASSISTANT_REFEREE_2: 1,
      FOURTH_OFFICIAL: 1,
    } as const;
    const match = await service.createMatch({
      slug: "v24-flow-open",
      competitionId: competition.id,
      stage: "自动化流程",
      kickoff,
      venue: "本地自动化测试场地",
      homeTeamId: homeTeam.id,
      awayTeamId: awayTeam.id,
      status: "SCHEDULED",
      applicationWindowStatus: "OPEN",
      applicationDeadline: new Date(Date.now() + 2 * 60 * 60 * 1_000),
      positionCounts: requirements,
    });
    const expiredMatch = await service.createMatch({
      slug: "v24-flow-expired",
      competitionId: competition.id,
      stage: "截止规则验证",
      kickoff: new Date(kickoff.getTime() + 24 * 60 * 60 * 1_000),
      venue: "本地自动化测试场地",
      homeTeamId: homeTeam.id,
      awayTeamId: awayTeam.id,
      status: "SCHEDULED",
      applicationWindowStatus: "CLOSED",
      applicationDeadline: new Date(Date.now() - 60_000),
      positionCounts: { REFEREE: 1 },
    });
    await verifier.match.update({
      where: { id: expiredMatch.id },
      data: { applicationWindowStatus: "OPEN" },
    });
    const withdrawalMatch = await service.createMatch({
      slug: "v24-flow-withdrawal",
      competitionId: competition.id,
      stage: "撤回规则验证",
      kickoff: new Date(kickoff.getTime() + 48 * 60 * 60 * 1_000),
      venue: "本地自动化测试场地",
      homeTeamId: homeTeam.id,
      awayTeamId: awayTeam.id,
      status: "SCHEDULED",
      applicationWindowStatus: "OPEN",
      applicationDeadline: new Date(Date.now() + 60 * 60 * 1_000),
      positionCounts: { REFEREE: 1 },
    });

    const application = await service.createRefereeApplication({
      matchId: match.id,
      refereeId: referees[0].id,
      preferredPositions: ["REFEREE"],
      note: "自动化闭环测试",
    });
    const persisted = await verifier.refereeApplication.findUnique({
      where: { id: application.id },
    });
    assert(persisted?.note === "自动化闭环测试", "报名未持久化到独立测试数据库。");
    let duplicateBlocked = false;
    try {
      await service.createRefereeApplication({
        matchId: match.id,
        refereeId: referees[0].id,
        preferredPositions: ["REFEREE"],
      });
    } catch (error) {
      duplicateBlocked =
        error instanceof service.RefereeServiceError && error.status === 409;
    }
    assert(duplicateBlocked, "重复报名未被阻止。");
    let deadlineBlocked = false;
    try {
      await service.createRefereeApplication({
        matchId: expiredMatch.id,
        refereeId: referees[1].id,
        preferredPositions: ["REFEREE"],
      });
    } catch (error) {
      deadlineBlocked =
        error instanceof service.RefereeServiceError && error.status === 409;
    }
    assert(deadlineBlocked, "截止后新增报名未被阻止。");
    const withdrawable = await service.createRefereeApplication({
      matchId: withdrawalMatch.id,
      refereeId: referees[1].id,
      preferredPositions: ["REFEREE"],
    });
    await service.withdrawRefereeApplication(withdrawable.id, referees[1].id);
    assert(
      (await verifier.refereeApplication.findUniqueOrThrow({ where: { id: withdrawable.id } })).status === "WITHDRAWN",
      "截止前撤回报名失败。",
    );

    await service.reviewApplication(application.id, "APPROVED", "自动化审核");
    const positions = [
      { key: "REFEREE" as const, slot: 1, refereeId: referees[0].id },
      { key: "ASSISTANT_REFEREE_1" as const, slot: 1, refereeId: referees[1].id },
      { key: "ASSISTANT_REFEREE_2" as const, slot: 1, refereeId: referees[2].id },
      { key: "FOURTH_OFFICIAL" as const, slot: 1, refereeId: referees[3].id },
    ];
    await service.saveAppointmentDraft({
      matchId: match.id,
      publicationNote: "自动化选派",
      positions,
    }, refereeAuthorization);
    const draft = await verifier.refereeAppointment.findUniqueOrThrow({
      where: { matchId: match.id },
      include: { positions: true },
    });
    assert(draft.status === "DRAFT" && draft.positions.length === 4, "选派草稿未正确保存。");
    assert(
      await verifier.refereeAppointment.count({
        where: { matchId: match.id, status: "PUBLISHED" },
      }) === 0,
      "未发布草稿进入公开结果。",
    );
    let overageBlocked = false;
    try {
      await service.saveAppointmentDraft({
        matchId: match.id,
        publicationNote: "",
        positions: [
          { key: "REFEREE", slot: 1, refereeId: referees[0].id },
          { key: "REFEREE", slot: 2, refereeId: referees[1].id },
        ],
      }, refereeAuthorization);
    } catch (error) {
      overageBlocked = error instanceof service.RefereeServiceError;
    }
    assert(overageBlocked, "同一岗位超额选派未被阻止。");

    await service.publishAppointment(match.id, "首次发布", "", refereeAuthorization);
    assert(
      await verifier.refereeAppointment.count({
        where: { matchId: match.id, status: "PUBLISHED" },
      }) === 1,
      "发布后公开查询不可见。",
    );
    assert(
      (await verifier.refereeApplication.findUniqueOrThrow({ where: { id: application.id } })).status === "APPOINTED",
      "入选报名未更新为已选派。",
    );
    await service.withdrawAppointment(match.id, "自动化撤回验证", refereeAuthorization);
    assert(
      await verifier.refereeAppointment.count({
        where: { matchId: match.id, status: "PUBLISHED" },
      }) === 0,
      "撤回后公开查询仍可见。",
    );
    await service.saveAppointmentDraft({
      matchId: match.id,
      publicationNote: "自动化重新发布",
      changeReason: "自动化改派验证",
      positions,
    }, refereeAuthorization);
    await service.publishAppointment(match.id, "自动化重新发布验证", "", refereeAuthorization);
    const republished = await verifier.refereeAppointment.findUniqueOrThrow({
      where: { matchId: match.id },
      include: { versions: true },
    });
    assert(
      republished.status === "PUBLISHED" && republished.versions.length === 3,
      "发布、撤回、重新发布的历史版本未完整保留。",
    );

    const conflictMatch = await service.createMatch({
      slug: "v24-flow-conflict",
      competitionId: competition.id,
      stage: "冲突验证",
      kickoff: new Date(kickoff.getTime() + 60 * 60 * 1_000),
      venue: "本地自动化测试场地",
      homeTeamId: homeTeam.id,
      awayTeamId: awayTeam.id,
      status: "SCHEDULED",
      applicationWindowStatus: "CLOSED",
      positionCounts: { REFEREE: 1 },
    });
    const adjacentResult = await service.saveAppointmentDraft({
      matchId: conflictMatch.id,
      publicationNote: "",
      positions: [{ key: "REFEREE", slot: 1, refereeId: referees[0].id }],
    }, refereeAuthorization);
    assert(
      !adjacentResult.warnings.some((warning) => warning.code === "ADJACENT_MATCH"),
      "缺少计划结束时间时错误推测了比赛间隔。",
    );

    const publicDirectory = await publicQueries.getPublicRefereeDirectory();
    assert(publicDirectory.length === 1, "公开名录授权过滤失败。");
    const publicKeys = Object.keys(publicDirectory[0]);
    for (const forbidden of [
      "studentId",
      "phone",
      "qq",
      "passwordHash",
      "internalNote",
      "certificateNote",
      "failedLoginCount",
      "lockedUntil",
      "lastLoginAt",
    ]) {
      assert(!publicKeys.includes(forbidden), `公开名录泄露字段：${forbidden}`);
    }

    await verifier.refereeSession.create({
      data: {
        refereeId: referees[0].id,
        tokenHash: createHash("sha256").update(randomBytes(16)).digest("hex"),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    await service.updateRefereeAccount(referees[0].id, {
      publicCode: referees[0].publicCode,
      name: referees[0].name,
      status: "INACTIVE",
      assignmentEligibility: "ELIGIBLE",
      elevenASide: true,
      futsal: true,
      trainingStatus: "QUALIFIED",
      publicDirectoryEnabled: false,
      publicBio: "",
      internalNote: "",
    }, refereeAuthorization);
    assert(
      await verifier.refereeSession.count({ where: { refereeId: referees[0].id } }) === 0,
      "账号停用后仍保留有效 Session。",
    );
    assert(
      !(await credentials.authenticateRefereeCredentials(referees[0].publicCode, replacementPassword)),
      "停用账号仍可通过登录验证。",
    );
    let disabledApplicationBlocked = false;
    try {
      await service.createAdminApplicationException({
        matchId: conflictMatch.id,
        refereeId: referees[0].id,
        preferredPositions: ["REFEREE"],
        exceptionReason: "自动化停用账号验证",
      });
    } catch (error) {
      disabledApplicationBlocked = error instanceof service.RefereeServiceError;
    }
    assert(disabledApplicationBlocked, "停用账号仍可参与业务。");

    const loginKey = randomBytes(32).toString("hex");
    for (let count = 0; count < 5; count += 1) {
      await security.recordLoginFailure("referee", loginKey);
    }
    let rateLimited = false;
    try {
      await security.assertLoginAllowed("referee", loginKey);
    } catch {
      rateLimited = true;
    }
    assert(rateLimited, "登录失败频率限制未生效。");
    await security.clearLoginFailures("referee", loginKey);

    await sourceContains("src/app/referees/admin/(dashboard)/layout.tsx", ["getAdminSession", "redirect"]);
    await sourceContains("src/app/referees/workspace/page.tsx", ["getRefereeMemberSession", "redirect"]);
    await sourceContains("src/app/api/referees/admin/exports/[kind]/route.ts", ["authorizeLegacyAdminRequest", '"referees:read"']);
    await sourceContains("src/app/api/referees/admin/logout/route.ts", ["destroyAdminSession"]);
    await sourceContains("src/app/api/referees/logout/route.ts", ["destroyRefereeMemberSession"]);
    await sourceContains("src/app/api/referees/admin/accounts/route.ts", ["authorizeLegacyAdminRequest", '"referees:write"']);
    await sourceContains("src/app/api/referees/applications/route.ts", ["authorizeRefereeMemberBusinessRequest"]);
    await sourceContains("src/lib/referee-member-api.ts", ["getRefereeMemberSession", "mustChangePassword"]);
    await sourceContains("src/app/api/referees/admin/login/route.ts", ["登录信息不正确或后台当前不可用"]);
    await sourceContains("src/app/api/referees/login/route.ts", ["登录信息不正确或账号当前不可用"]);
    await sourceContains("src/lib/referee-auth.ts", ["REFEREE_ADMIN_SESSION_SECRET"]);
    await sourceContains("src/lib/referee-auth.ts", ["SITE_ORIGIN"]);
    await sourceContains("src/lib/referee-member-auth.ts", ["REFEREE_MEMBER_SESSION_SECRET"]);

    const content = await import("../src/data/freshman-cup-2026");
    const association = await import("../src/data/association");
    const platforms = await import("../src/data/platforms");
    const structured = await import("../src/lib/structured-data");
    assert(
      content.freshmanCupPreparationNews.id === "2026-freshman-cup-preparation-started" &&
      content.freshmanCupPreparationNotice.id === "2026-freshman-cup-preparation-notice" &&
      content.freshmanCupPreparationNews.dateLabel === "2026.07.30",
      "新生杯新闻或公告数据不完整。",
    );
    assert(association.currentAssociationTeam.positions.length === 9, "现任工作班子名单数量不正确。");
    assert(
      association.currentAssociationTeam.positions.some(
        (item) => item.role === "主席" && item.name === "胡兵",
      ),
      "现任工作班子名单未正确渲染来源数据。",
    );
    assert(
      platforms.douyinPlatform.qrImage === "/images/media/nuaafa-douyin-qr-cropped.png",
      "抖音二维码配置未指向专用裁剪文件。",
    );
    await stat(path.resolve("public/images/media/nuaafa-douyin-qr-cropped.png"));
    await stat(path.resolve("public/images/media/nuaafa-douyin-qr.jpg"));
    const qrHash = createHash("sha256")
      .update(await readFile(path.resolve("public/images/media/nuaafa-douyin-qr.jpg")))
      .digest("hex")
      .toUpperCase();
    assert(
      qrHash === "BA076FA9B599476D26DE48C5365CB3D39765EE447458047823118836B298640D",
      "抖音二维码文件与用户提供的原图不一致。",
    );
    const jsonLd = structured.newsArticleJsonLd({
      title: content.freshmanCupPreparationNews.title,
      summary: content.freshmanCupPreparationNews.summary,
      path: content.freshmanCupPreparationNews.href,
      publishedAt: content.freshmanCupPreparationNews.publishedAt,
      updatedAt: content.freshmanCupPreparationNews.updatedAt,
      image: content.freshmanCupPreparationNews.image,
    });
    assert(
      jsonLd["@type"] === "NewsArticle" &&
      jsonLd.url === "https://nuaafa.cn/news/2026-freshman-cup-preparation-started",
      "NewsArticle JSON-LD 或 canonical URL 不正确。",
    );
    await sourceContains("src/app/news/[slug]/page.tsx", [
      "alternates: { canonical: canonicalPath }",
      "newsArticleJsonLd",
      "@/components/news/news-article-layout",
      "<NewsArticleLayout",
    ]);
    await sourceContains("src/components/news/news-article-layout.tsx", [
      "@/components/share/share-actions",
      "<ShareActions title={title} text={summary} />",
    ]);

    const auditCount = await verifier.auditLog.count();
    assert(auditCount >= 10, "关键管理员与裁判操作未写入审计日志。");

    console.log(JSON.stringify({
      isolatedDatabase: true,
      passwordHashing: true,
      authBoundaries: true,
      originValidation: true,
      loginSuccessAndFailure: true,
      sessionExpiryRule: true,
      firstLoginPasswordChange: true,
      duplicateAccountBlocked,
      duplicateApplicationBlocked: duplicateBlocked,
      deadlineBlocked,
      withdrawalBeforeDeadline: true,
      draftHidden: true,
      positionOverageBlocked: overageBlocked,
      publishWithdrawRepublish: true,
      versionHistoryRetained: true,
      missingEndNotInferred: true,
      disabledAccountBlocked: disabledApplicationBlocked,
      loginRateLimited: rateLimited,
      csvAuthorizationGuard: true,
      publicDirectoryDoesNotLeak: true,
      contentAndQrVerified: true,
      metadataAndJsonLdVerified: true,
      auditLogCount: auditCount,
    }, null, 2));
  } finally {
    await verifier.$disconnect();
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : "Referee flow test failed.");
  process.exit(1);
});
