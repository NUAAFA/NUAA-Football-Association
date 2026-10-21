# NUAAFA V2.10.x 后台综合优化实施报告

任务：`NUAAFA-V2.10X-ADMIN-UX-REFEREE-ROUND-BEIJING-GRADE-20261019`  
日期：2026-10-20（Europe/London）  
范围：全部六项功能已实际开发，并完成纯虚构数据库隔离验收；生产发布仍需另行批准。

## 1. 准确基线与工作区

- 正式 V2.10 源码基线：`704bf0af9e9b7f538cfbf6d3a76ec5f4148190e8`。
- 用户指定的既有正式构建摘要：`1f76db416149e206613394728983af6ad55da1cefeed0010eade56e2821a593b`；本轮没有重新部署该构建，也没有将本地构建冒充正式工件。
- 隔离工作树：`/Users/xianghanwang/.codex/worktrees/v210x-admin-optimization/NUAAFA`。
- 分支：`codex/v2.10x-admin-optimization`；应用与测试源码冻结提交：`73da7dd7aa60b3eb027fbaf3e124f8e6bc070515`。
- 初检时远端 main 为 `529a8600feb86fe331a9852e6b08d9cefb18a9a9`。开发期间其他流程合并了 PR #10，将 main 对齐为 `0761f3753fde9fcab124001964bb9310c2921a8c`。已验证此提交与 704 的 tree 均为 `fb24d93bf55de73784154afd79d59c7d360349a4`。本轮没有执行这次合并，也没有改写 main；新 PR 以已对齐的 main 为目标。
- 原工作树与 V2.10 集成工作树保留；没有复制生产数据库、生产媒体、`.env` 或正式账号凭据进入测试环境。

## 2. 实际实现

| 功能 | 实现与主要文件 |
|---|---|
| A 精简裁判名录 | `admin-referee-query.ts` 在 SQLite 内完成组合条件、年级派生筛选、分类计数与分页；每页20人，稳定编号/id排序，五个主要视觉列。学号仅用于授权服务端搜索和推导，在返回列表视图前移除。保留组织统一排序。 |
| B 选派结构导航 | `admin-match-query.ts` + `admin-matches-page.tsx`，直接读取 Competition/Stage/Group/Round；状态按钮、阶段、轮次、小组、搜索、日期与分页保存在URL。 |
| C 比赛结构导航 | 与B共用同一查询和页面组件，仅模式、状态与操作不同。默认选择实际进行中赛事；“全部赛事”需明确选择。比赛详情关联同一选派实体。 |
| D 赛后实际执裁 | `completed-officials-service.ts`、专用 `/completed-officials` POST、`admin-completed-officials.tsx`。独立补录/更正事务，复用原唯一 appointment、岗位、版本和审计。 |
| E 北京时间 | `beijing-datetime.ts` 作为严格边界解析器；`readDate`、显式ISO导入、编辑回填、排期、可执裁日历/筛选复用。业务时间显示和输入明确北京含义。 |
| F 自动年级 | `referee-grade.ts`、`referee-grade-service.ts`、专用 `/accounts/[id]/grade` PATCH、`admin-grade-control.tsx`。自动/人工/待确认明确分开，查询时计算，列表、个人档案、导出和归属建议共用推导规则。 |

完整改动文件及SHA-256见 [源码指纹](evidence/source-freeze.json)。新增CI仅做构建、隔离测试、审计和证据保存，没有生产发布任务。

### 名录与导航规则

分类计数允许交叉。“可正式选派”要求账号启用、资格为 ELIGIBLE 且至少有培养中/READY岗位；“培养中”要求培训中或存在培养中岗位；待启用、停用/归档另计。账号、培养和资格没有被合并或联动修改。

逻辑轮次限定同一阶段，用规范名称及 sortOrder 识别不同小组的同轮ID；同组同名重复或混合阶段级轮次不盲合并，保留独立ID。A/B组不同数据库roundId可在同一“第一轮”下同时查询；不跨阶段或赛事合并。同名但排序不同的轮次保守分开，需人工核对结构，未自动改写任何旧归属。

旧文字阶段、空roundId和待排期场次均有明确入口。未完整选派的聚合先在SQLite计算，再与完整结构条件匹配，最后分页；大集合按400个ID分批匹配，用单个JSON参数在数据库内取当前页，避免旧250上限及SQLite参数上限。名录的派生年级过滤、计数和LIMIT均在SQL内执行，传给最终Prisma详情查询的ID最多20个。

### 赛后补录与更正

服务端要求过去真实已完赛、双方比分存在、已确认赛果及有效版本、真实赛事/球队关联和岗位模板；未登录/分权/Origin/输入/业务错误分别有401/403/400/409路径。`competitions:write`不能取得裁判补录写权限。新增补录和年级模式动作要求具有持久ID的可审计管理员账号；旧环境式legacy身份的既有登录/角色不改，新动作拒绝未实名关联身份，避免伪造操作者。

- 同时检查 `expectedAppointmentRevision` 与 `expectedResultVersion`。唯一matchId、条件更新、SQLite事务和版本唯一约束共同防止重复计数、重复提交与并发覆盖。
- 未选派/草稿/撤回可经专用流程记录；已完成只能专用更正；已有PUBLISHED保持原完成路径。原赛前保存/发布限制保留。
- 允许部分岗位；未分配岗位明确为“实际执裁人员未记录”。不存在的裁判、重复人员、重复/超额/不适用slot拒绝。
- 当前停用、资格或能力变化不直接否定历史事实；必须核实依据。组织、不可用、重叠及不完整时间区间提示入快照和审计；历史重叠须最高管理员核实。历史检测不因缺场地而跳过。
- 来源 `POST_MATCH_ENTRY`、真实操作时间、管理员、原因、前后快照、核实依据及所有历史版本留痕。不倒填publishedAt；已有真实publishedAt作为原事实保留，来源显示另行区分。
- 补录事务不写Match、报名、裁判确认、通知、球队或积分。测试逐项比较整条Match行（含更新时间、比分/点球/时间/赛果版本/归属），全部相等。
- 更正前版本保持；现有已完成统计只计一次，更换裁判后更新归属统计，不叠加第二份执裁记录。

### 全部公开读取路径

公开历史、直接打印和公开赛事详情共用来源准入。赛后记录默认私有，单独勾选后显示“赛后执裁记录”和实际录入时间；不会冒充旧赛前公告。未知来源拒绝公开。内部原因、核实依据、学生学号、联系方式和后台快照不进入公开DTO。缺场地历史的列表与打印一致；部分岗位打印明确未记录。

### 北京时间与年级边界

无时区墙钟输入按Asia/Shanghai；带明确offset的ISO按绝对时间。`2026-10-27T15:00`固定为`2026-10-27T07:00:00Z`，编辑仍15:00；`2026-02-30`、25:00和不合法offset拒绝，不自动进位。日期筛选用北京自然日；没有批量平移历史时间。

仅接受保守的九位ASCII数字标准学号；第3/4位年份取2000+YY，范围2000至查询时北京年份+1，避免世纪和未来号码猜测。`CG0123010189`、缺号、非标准/超范围号待核实。现有前两位学院映射、登录编号规则不变。

所有历史档案默认UNVERIFIED，原grade原样保留。管理员先看识别预览，再明确启用AUTO。每年北京9月1日00:00查询时升年级；超过四年标学籍待核实，不自动毕业/停用。MANUAL支持特殊学籍，原因必填。修改学号使自动模式回到待确认，保留审计。自动推导不修改组织、关系行、角色、能力或历史执裁；大二→大三仅影响建议。无年度批量写库定时任务。页面北京午夜与回到可见状态触发刷新；服务端年份边界与客户端刷新证据分别验证。

## 3. 数据库与兼容性

需要新增迁移 `20261020120000_admin_history_grade`：8个追加字段、2个索引，没有新建平行业务表，没有改动17项历史SQL。Referee增加gradeMode/enrollmentYear/gradeReason；appointment增加来源、录入时间/人和独立公开开关；version增加来源。旧行分别默认UNVERIFIED/PRE_MATCH，原grade、公示时间、账号及历史版本不改。

隔离旧库升级对38张业务表及迁移账本共39张表的全部旧列逐值比较；17项旧迁移原字节和checksum相等。fresh、旧库upgrade、重复deploy、完整性/外键检查、手工事务末端失败、真实Prisma失败迁移、保留失败库后恢复到新clone并重新应用正确迁移均通过。`EXPLAIN QUERY PLAN`使用新结构索引；跨组全局时间排序仍可能使用临时排序树，保留准确顺序，不宣称所有条件都常数时间。任意关键字/派生年级需要扫描匹配集合，1000人/600场夹具已通过。

**重要兼容边界：追加字段对旧数据兼容，不代表新事实可由旧应用安全读取。旧704不知道赛后来源和私有开关；出现新补录后，禁止“只回退代码并继续读新数据库”。必须依发布回退方案保全窗口写入，并在批准维护窗口成套恢复可信Bf数据/媒体，或另行批准兼容读取补丁。**

## 4. 实际验收证据

| 项目 | 最终结果与证据 |
|---|---|
| 锁定依赖安装 | `npm ci --no-audit --no-fund` exit0，未升级依赖。 |
| 类型、lint、构建、Unicode | PASS。本地与Ubuntu24.04/Node22.23.2 CI均通过；lint仅保留基线combined-backup.ts未用rm的1项warning，无新增错误。 |
| 新专项3个Node TZ | London / UTC / Shanghai各exit0；[专项日志](evidence/special-london.log)、[UTC](evidence/special-utc.log)、[上海](evidence/special-shanghai.log)。 |
| 原有适用回归 | 39/39套exit0，见[命令与退出码](evidence/regressions/results.json)。包括登录、资格、选派、比分、导入、历史迁移、目录、权限、HTTP和安全等。 |
| 原有真实HTTP | 2/2套exit0，见[HTTP结果](evidence/http-regressions/results.json)。补齐独立fixture、legacy测试凭据和数据库内容源后复验，没有降低旧断言。 |
| 真实浏览器 | Chrome 155.0.8059.85，39项PASS、pageErrors为空；[浏览器矩阵](evidence/browser/results.json)。中英UTC三种浏览器时区/locale，实际点击保存、导入预览/提交、补录/更正。 |
| 响应式与可访问性 | 1440/1024/768/390各检查名录、选派、比赛和执裁历史；无整页横向溢出。窄屏表格内部横滑，提供提示、region标签和键盘焦点；不是宣称所有列同时塞入390px。URL刷新/前进后退与焦点测试通过。 |
| 北京午夜刷新 | 浏览器模拟北京8/31→9/1，确认RSC刷新及visibility恢复刷新请求；服务端按asOf的真实年级变化另由纯函数/独立非空组织关系探针证明。没有宣称测试改变了真实服务器时钟。 |
| 数据迁移 | [迁移结果](evidence/migration.log)，含真实Prisma失败恢复。 |
| 依赖安全审计 | full与production均0漏洞；[全量](evidence/audit-full.json)、[生产依赖](evidence/audit-production.json)。 |
| 源码候选Linux CI | head73da7dd关联的[PR run 39423814132](https://github.com/NUAAFA/NUAA-Football-Association/actions/runs/39423814132)整体SUCCESS，security/application及所有步骤通过，重跑了三时区、39套原回归、2套HTTP、迁移及Chromium浏览器矩阵。PR事件实际checkout测试合并提交5c05c358，独立审核已核实其与head无文件差异；[远端元数据](evidence/ci-source73.json)。最终交付文档提交的CI另以PR Checks核实。 |
| 独立审核 | 独立GPT-6 Astra · Extra High给出 **PASS WITH NOTES**，无未解决P0/P1/P2；IA-01–IA-07全部完成修复或落实持续发布门禁，详见[独立报告](NUAAFA_V2.10x_Admin_Optimization_Independent_Audit.md)。审核者独立执行专项/迁移/事务/公开路径/年级关系探针，并单独复核执行者浏览器及远端CI证据。 |

浏览器在隔离loopback生产模式服务器运行。由于受信任Origin固定正式域名，UI写请求在测试层转为预设可信Origin；HTTP API测试显式带可信Origin与仅测试会话Cookie。另有无会话401、错误角色403、恶意Origin403、无效内容400和业务409负例。这证明隔离真实浏览器与服务端门禁，不等同于在正式HTTPS站点进行生产验收。

[25项需求验收矩阵](Acceptance_Matrix.md)逐项列明证据与范围。全部数据为脚本生成的虚构赛事/球队/裁判/账号；截图、普通工作区和CI没有生产数据库或真实凭据。曾遇到的夹具、选择器、参数上限及独立审计问题已修复并复验；未将失败当通过。

## 5. UI前后截图

- 之前：[原九列名录](evidence/browser/before-roster-1440.png)、[原250上限选派](evidence/browser/before-appointments-1440.png)。在保留的704本地工作树构建上读取虚构库，DOM核对9列/250提示；仅作UI对比，不是正式构建认证。
- 之后：[五列名录1440](evidence/browser/roster-1440.png)、[名录390](evidence/browser/roster-390.png)、[轮次选派1440](evidence/browser/appointments-1440.png)、[轮次选派390](evidence/browser/appointments-390.png)。
- 工作流：[赛后记录](evidence/browser/backfill-london.png)、[人工年级](evidence/browser/grade-manual.png)、[英国浏览器导入](evidence/browser/import-london.png)、[中国浏览器导入](evidence/browser/import-china.png)。

## 6. PR、CI与发布边界

实际PR：[NUAAFA/NUAA-Football-Association #11](https://github.com/NUAAFA/NUAA-Football-Association/pull/11)。最终交付HEAD与Linux检查以[该PR的Checks](https://github.com/NUAAFA/NUAA-Football-Association/pull/11/checks)为准。源码冻结提交是73da7dd；随后交付提交包含本报告、独立报告及纯虚构验收证据，应用源码未因报告提交改变。尚未产生经既有Sealed信任链认证的正式Linux发布归档；不能用Mac build或截图替代发布工件认证。

已完成开发、隔离验收与候选PR的Linux CI。正式生产迁移、发布、重启、main合并、权限修改、生产恢复和IPv6均未执行。只读公开IPv4首页及健康端点均返回200，见[可用性记录](evidence/public-readonly-availability.log)；未访问生产数据库或私有业务数据，因此本轮“ZERO VERIFIED”限定虚构兼容性与不变性测试，不把历史生产数量当当前核验结果。发布前仍须批准精确候选、工件、备份/快照、维护窗口和回退范围。

```text
REFEREE ROSTER UX: PASS WITH NOTES
COMPETITION PROJECT NAVIGATION: PASS
APPOINTMENT ROUND-GROUP NAV: PASS
MATCH ROUND-GROUP NAV: PASS
COMPLETED-MATCH OFFICIAL BACKFILL: PASS
HISTORICAL REVISION / AUDIT: PASS
REFEREE STATISTICS / PUBLIC PRIVACY: PASS
BEIJING TIME INPUT-DISPLAY: PASS
CROSS-TIMEZONE DST REGRESSIONS: PASS
AUTO GRADE FROM STUDENT ID: PASS
NONSTANDARD-ID / MANUAL OVERRIDE: PASS
GRADE-AFFILIATION SIDE-EFFECT: NONE VERIFIED
MATCH RESULT / ADMIN DATA LOSS: ZERO VERIFIED (isolated fixtures only)
SCHEMA MIGRATION REQUIRED: YES
ISOLATED DATA UPGRADE/RESTORE: PASS
AUTOMATED / BROWSER TESTS: PASS
INDEPENDENT ASTRA REVIEW: PASS WITH NOTES
PR: https://github.com/NUAAFA/NUAA-Football-Association/pull/11
PRODUCTION MIGRATION: NOT RUN
PRODUCTION DEPLOYMENT: NOT RUN
```
