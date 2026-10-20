# NUAAFA V2.10.x 后台综合优化 — 独立审核报告

任务：`NUAAFA-V2.10X-ADMIN-UX-REFEREE-ROUND-BEIJING-GRADE-20261019`  
日期：2026-10-20  
独立审核：用户指定的 **GPT-6 Astra · Extra High** 子代理。

**独立审核结论：PASS WITH NOTES。** 最终应用源码为 `73da7dd7aa60b3eb027fbaf3e124f8e6bc070515`，已发现的实现缺陷全部关闭；没有未解决P0/P1/P2。冻结源码对应的Linux PR CI已全部通过，正式发布工件与生产验收未执行；本结论不构成生产发布批准。

审核者未修改实现代码，未连接生产数据库、生产站点或生产主机，未执行部署、合并、权限变更或 IPv6 操作。独立探针仅在新建的完全虚构数据库或其只读备份副本上执行。报告与独立证据由审核者维护，实施者的结果单独标注。

## 1. 依据、身份与证据绑定

- 完整阅读桌面任务书共329行，覆盖A–F六项功能、测试矩阵、历史数据保护和生产边界。
- 准确生产代码基线：`704bf0af9e9b7f538cfbf6d3a76ec5f4148190e8`，没有把移动分支名称作为生产身份。
- 分支：`codex/v2.10x-admin-optimization`；隔离工作树：`/Users/xianghanwang/.codex/worktrees/v210x-admin-optimization/NUAAFA`。
- 首次冻结：`d18425fea7416a805a3965556df989102feb6551`；最终应用冻结：`73da7dd7aa60b3eb027fbaf3e124f8e6bc070515`。独立逐项复核其6文件增量：日期格式及负例、复制/公开时间标签、年级详情四宽验收、CI允许main目标；其余52文件保持不变。
- 审核者对 `evidence/source-freeze.json` 中58文件逐一计算SHA-256，与工作树及 `git show <commit>:<path>` 字节比较；全部一致，集合恰等于相对基线的改动集合。见[独立源码核验](evidence/independent/source-final-verification.json)。执行者aggregate为 `8bbf569b4393a58134af148cdd583eaeb20891df2037843b5134741b51aff299`；审核者不依赖其汇总算法，逐文件独立比对。
- 已读本地Next.js的useRouter / NextResponse文档，结合动态服务端路由审核刷新，未把一个router.refresh调用当成缓存正确性证明。
- 历史生产记录仅用于识别保护边界；旧验收、执行者自述及本地测试都不替代当前生产验证。

## 2. 发现、影响与整改复核

| ID | 严重性 | 触发条件与影响 | 复核状态 |
|---|---|---|---|
| IA-01 | P1 | 初版public-competition-service未读取来源/公开开关，私有赛后记录可由公开赛事详情泄漏姓名岗位，并缺少来源语义。 | **PASS，已修复。** 共享来源准入；独立探针覆盖赛事详情、历史列表、直接打印：private拒绝，显式visible可见且来源为POST_MATCH_ENTRY，未知来源拒绝。浏览器/HTTP证据补充验证。 |
| IA-02 | P1 | 历史补录允许缺场地旧完赛记录，原冲突检查却因空venue提前返回，重叠/组织/岗位检查可能绕过；详情页也误判为待排期。 | **PASS，已修复。** 显式POST_MATCH模式解除历史场地前置，保留赛前模式。独立专项验证无依据409、裁判管理员历史重叠403、最高管理员有依据可记录且保留警告；缺结束时间单独提示无法确认冲突。 |
| IA-03 | P2 | 可执裁日期筛选及日历工具接受JS自动进位，如2月30日变3月2日。 | **PASS，已修复。** 严格日期解析，无效筛选为空并有错误；专项及旧日历回归通过。 |
| IA-04 | 发布回退门禁 | 旧704不了解来源/可见性。产生private POST_MATCH_ENTRY后，只回退代码会将其当正式COMPLETED公开。 | **PASS，门禁落实；旧代码直读新事实库仍禁止。** 已审回退方案第4节：保全窗口写入、维护态成套恢复批准Bf数据库/媒体，或另批兼容读取补丁。追加字段不等于向后语义兼容。 |
| IA-05 | P2 | 缺场地历史在公开列表可见，直接打印仍要求venue非空，导致打印404。 | **PASS，已修复。** POST打印不要求场地，PRE保留旧条件。独立最终探针实际验证可列出/打印；空岗位文案改为“实际执裁人员未记录”。 |
| IA-06 | P2 | 新年级模式动作接受无持久ID的legacy管理员，新增审计身份不充分。 | **PASS，已修复。** 新年级模式和补录要求持久ID；独立探针验证legacy403且无写入。原账号操作的新增审计如实记录displayName/isLegacy/roles，不伪造ID、不改变现有角色。 |
| IA-07 | P2 | admin-match-query.ts:52接受date=2026-10-27T16:00，形成16:00至次日16:00窗口。独立虚构库正常日期601场，带时间仅1场且无错误；日期控件无法表示该URL值。 | **PASS，已修复。** 最终源码限定YYYY-MM-DD，独立专项和额外URL探针确认正常日期仍601场；带时间、带Z和2月30日均0场且有dateError。见[日期探针](evidence/independent/final-date-filter-probe.json)。 |

另提出窄屏表格横滑提示/可聚焦区域及复制场次时间输入的可见北京时间标签。两项均已在最终源码确认，窄屏效果已看实际截图。

曾怀疑只读角色可见年级按钮；核对真实RBAC后，没有“仅裁判读取但无写权限”的现存角色，故撤回为可复现阻塞的判断。增加防御性按钮检查不扩大权限，未为测试新增角色。

## 3. 审核者亲自执行的验证

首次冻结后的退出码和日志摘要见[独立运行记录](evidence/independent/final-run-results.json)。最终73da7dd增量后又独立完整执行UTC专项并直接验证日期URL负例，均exit0，见[最终增量记录](evidence/independent/final-incremental-results.json)及[日志](evidence/independent/final-incremental-admin-utc.log)。迁移、补录事务、公开服务和年级核心文件未在最后增量中改变，前轮独立证据仍适用。本地Node为v24.21.0；不是生产Node22/Ubuntu运行证明。

| 验证 | 实际结果与范围 |
|---|---|
| UTC专项 | **PASS，exit0。** 600场、同逻辑轮300场、不同组roundId、服务端计数/分页；1000人/50页；时间/年级/补录/权限/统计/不变性全通过。[日志](evidence/independent/final-admin-utc.log)。 |
| 追加迁移 | **PASS，exit0。** 17旧SQL字节不变，追加后18项；39表含账本的旧列与旧账本行比较；账号凭据/原年级/公示时间保持；完整性、外键、重复deploy和新路径恢复通过。[日志](evidence/independent/final-migration.log)。 |
| 真实Prisma失败 | **PASS。** 复制迁移到临时目录，末尾注入故障SQL；实际deploy失败并保留未完成账本，旧业务列相等。保全失败库后，从旧克隆恢复新路径并成功应用正确迁移。未原位假标成功。 |
| 私有/公开/未知来源 | **PASS。** 三个公有查询入口均验证，另验证缺场地历史公开/打印一致。[结果](evidence/independent/final-probes.json)。 |
| 五轮同revision并发 | **PASS。** 每轮恰好200与409；没有两次成功或第二份appointment。 |
| 事务末端故障 | **PASS。** 仅测试授权使用不存在管理员ID，使版本写入外键失败；appointment、positions、versions整组回滚。 |
| 赛果版本/历史不变 | **PASS。** 错误resultVersion返回409且无写入；完整Match行及此前版本行在多轮更正后逐项相等。 |
| 组织与年级 | **PASS。** 新建非空书院和RefereeAffiliation，启用AUTO；London进程查询北京2028-08-31 23:59:59→09-01 00:00，显示大二→大三。除明确年级配置字段外完整Referee列相等，归属关系相等，查询无写入。[结果](evidence/independent/final-grade-probes.json)。 |
| legacy新动作 | **PASS。** 无持久ID的新年级操作403，整条档案不变。 |

最终探针来源是审核者新建专项fixture，以SQLite只读连接backup到另一个新建临时目录，未修改来源库。见[上下文](evidence/independent/final-probe-context.json)、[事务/公开探针文本](evidence/independent/final-probe.ts.txt)、[年级探针文本](evidence/independent/final-grade-probe.ts.txt)。直接导入公开服务时只替换Next的server-only模块标记；授权使用既有隔离测试能力工具，没有修改应用鉴权。

保留失败事实：中间首次专项因正在增补的缺场地夹具触发约束而exit1。执行者仅在新建测试库临时卸载/原样恢复相关触发器，以构造API无法新建的旧遗留形态；最终复跑通过。迁移脚本最初只有手工BEGIN故障测试，后补齐真实Prisma失败路径。**未验证原位migrate resolve，不能把新路径恢复证明描述为原位修复证明。**

## 4. 复核执行者的测试与浏览器证据

以下由执行者运行，审核者读脚本、结果、相关日志并抽查截图；未声称亲自执行全部浏览器操作。

| 项目 | 复核结果 |
|---|---|
| 原有适用回归 | [39条命令与退出码](evidence/regressions/results.json)全部exit0，完成于2026-10-20 12:27:28 UTC，在首次冻结版本执行。最终6文件增量另以专项/构建/浏览器验证，不能把旧39套本地日志说成最终SHA上重新执行；后续Linux CI在与最终源码同内容的PR测试合并提交上完整重跑通过（第6节）。覆盖旧裁判流程、登录/强制改密/RBAC、赛果/选派、导入、目录、迁移、安全与静态检查。 |
| 真实HTTP补充 | [2套结果](evidence/http-regressions/results.json)全部exit0，在首次冻结版本执行；复核r1-2与r313日志，包含权限、CSRF、原登录和业务门禁。 |
| 三Node时区专项 | London、UTC、Shanghai通过，见evidence/special-*.log；审核者另跑UTC专项与London年级探针。 |
| 真实浏览器 | [矩阵](evidence/browser/results.json)：Chrome155.0.8059.85，最终39项PASS、pageErrors为空，12:37:26至12:37:40 UTC。三浏览器时区/locale新建/编辑、排期、导入、补录/更正，AUTO↔MANUAL实际保存、特殊学号拒绝、401/403/400/409。 |
| 响应式 | 四宽1440/1024/768/390×五页名录/选派/比赛/历史/年级，共20项文档无横向溢出。审核者实际查看名录390/1024、选派390、比赛768、历史1440/390及最终年级390、人工年级、英国导入、中国补录等代表截图。窄屏表格内部横滑，提示和焦点存在。 |
| 午夜/可见性刷新 | Playwright clock跨北京8/31→9/1，观察RSC请求；visibilitychange再次刷新。仅证明客户端请求，未模拟服务端时钟；年级边界由asOf函数/查询另证。 |
| 构建/静态/依赖 | 复核本地构建完成、静态检查退出码、full/production审计0漏洞。lint有既有combined-backup.ts未用rm警告。未称本地构建为认证Linux归档。 |

浏览器在隔离loopback生产模式服务器运行，UI API在测试层将Origin改为预设可信正式Origin；HTTP请求显式带测试Cookie以适配loopback和安全Cookie。另有无会话、错角色、恶意Origin拒绝断言。**这证明本地真实交互与服务端门禁，不证明正式HTTPS、代理、Cookie域或生产会话已验收。**

无障碍证据限标签、Tab焦点和可聚焦横滑区域；未执行完整屏幕阅读器审计。截图资料均虚构。前后截图的704本地构建只作UI对比，不是旧正式工件认证。

## 5. 实现审核要点与限制

**A–C：** 名录五列，服务端筛选和稳定分页；完整studentId在最终列表视图返回前剔除。状态分类允许交叉，账号/培养/资格不联动修改。比赛与选派共享查询；逻辑轮限定阶段、规范名称、sortOrder，跨组roundId可合并，同组或阶段级歧义保守拆分，不跨阶段归并。默认进行中赛事，有显式全部和未结构化入口，无历史归属重写。

分页前完成过滤、计数，未见250/300截断。未完整队列读取全量候选ID，分400一批匹配后SQL分页20条；600场/1000人是功能证明，不是无限规模压测。新索引被采用，仍有USE TEMP B-TREE FOR ORDER BY；不能宣称排序完全由索引覆盖。

**D：** 新事务要求持久身份、referees:write、过去已完赛确认比分、模板和两种预期版本。原draft/publish SCHEDULED限制及PUBLISHED完成流程保留。只写appointment/positions/version/audit，未见Match、报名、确认、通知、球队或积分写入。空槽位为null，保留旧publishedAt，不倒填；before快照含旧记录/岗位，旧版本不覆盖。历史资格、组织、不可用和重叠都有核实语义。

公开准入统一识别PRE_MATCH与显式可见的COMPLETED POST_MATCH_ENTRY；未知来源拒绝。公开DTO无内部原因/依据/学号/联系方式。内部统计按唯一已完成appointment计一次，更正更新人员归属。

**E–F：** 解析验证真实日历、时分秒、offset和年份；naive北京、offset绝对时刻，编辑北京回填。导入区分Excel Date墙钟/ISO并拒绝数值日期，无历史时间批量平移。自然日URL最后遗漏IA-07已修复并独立验证关闭。

仅九位ASCII标准学号识别，第3/4位2000+YY，特殊/超范围待核实。旧档案UNVERIFIED保留grade，AUTO需明确启用，MANUAL留原因。北京9月1日动态推导，超过四年待核实而不自动毕业。无年级年度批写；组织关系、账号、资格、能力不随推导改动。

**迁移/回退：** 仅追加8字段/2索引，17旧SQL不变，无平行业务表。39表旧列相等为虚构夹具证明，并非每张表都有非空数据，也没有读生产库验证当前行数或特例。已审[实施报告](NUAAFA_V2.10x_Admin_Optimization_Implementation_Report.md)及[发布回退方案](NUAAFA_V2.10x_Production_Change_and_Rollback_Plan.md)。后者保全失败现场与窗口写入，批准Bf成套恢复；可信Linux工件、当时备份/快照、同量级预演和用户授权仍需另办。IA-04旧代码语义不兼容是持续门禁。

## 6. PR、剩余门禁与状态矩阵

独立通过GitHub连接器核实[PR #11](https://github.com/NUAAFA/NUAA-Football-Association/pull/11)：OPEN、Draft、未合并，head为73da7dd7，base为main的0761f375。本地分别解析0761与704的tree，均为fb24d93bf55de73784154afd79d59c7d360349a4，确认基线内容一致。已读CI配置，仅构建、隔离测试、安全审计、证据上传，无部署。

独立重新读取[Linux CI run 39423814132](https://github.com/NUAAFA/NUAA-Football-Association/actions/runs/39423814132)的结构化run/jobs、application日志及artifact元数据，确认**completed / success**，security与application所有步骤success。日志证实Node22.23.2、构建、三TZ专项、真实Prisma失败恢复、39条原回归/静态检查、2套HTTP和浏览器步骤通过。见[独立CI核验](evidence/independent/final-ci-reviewed.json)及[日志摘录](evidence/independent/final-ci-log-excerpt.txt)。之前IN PROGRESS快照保留作过程记录。

准确执行身份：PR head为73da7dd7，CI实际checkout测试合并提交 `5c05c358e93a122e51787238219ebea53ea2cd36`，不是直接checkout head。独立GitHub compare核对73da7dd7到5c05c358的files为空，确认被测文件内容一致。Linux使用Playwright固定Chromium151.0.7922.34，与本地Chrome155证据分别记录。上传的artifact ID为12264344585，摘要 `fc254b27dedd8d8ac212393987c958d0bb45d03eb52f5c2212d8e64c7bc4e5c2`，属于验收证据归档，**不是经过Sealed信任链认证的正式发布归档**。

没有未解决P0/P1/P2，独立审核通过并保留上述范围说明。报告/证据后续提交将改变最终交付HEAD，主执行者仍须核验该准确HEAD关联的PR及CI；不能将本次源码CI自动移用于未来源码变化，更不能推导生产放行。

```text
REFEREE ROSTER UX: PASS WITH NOTES
COMPETITION PROJECT NAVIGATION: PASS
APPOINTMENT ROUND-GROUP NAV: PASS
MATCH ROUND-GROUP NAV: PASS
COMPLETED-MATCH OFFICIAL BACKFILL: PASS
HISTORICAL REVISION / AUDIT: PASS
REFEREE STATISTICS / PUBLIC PRIVACY: PASS
BEIJING TIME INPUT-DISPLAY: PASS
CROSS-TIMEZONE DST REGRESSIONS: PASS (local scope described above)
AUTO GRADE FROM STUDENT ID: PASS
NONSTANDARD-ID / MANUAL OVERRIDE: PASS
GRADE-AFFILIATION SIDE-EFFECT: NONE VERIFIED (synthetic fixtures only)
MATCH RESULT / ADMIN DATA LOSS: ZERO VERIFIED (synthetic fixtures only)
SCHEMA MIGRATION REQUIRED: YES
ISOLATED DATA UPGRADE/RESTORE: PASS
AUTOMATED / BROWSER TESTS: PASS (source/evidence scopes recorded above)
INDEPENDENT ASTRA REVIEW: PASS WITH NOTES
PR: #11 OPEN / DRAFT / NOT MERGED — independently verified
REMOTE LINUX CI: PASS — run 39423814132; tested merge content equals source 73da7dd7
PRODUCTION MIGRATION: NOT RUN
PRODUCTION DEPLOYMENT: NOT RUN
PRODUCTION ROLLBACK: NOT RUN
PR MERGE: NOT RUN
IPV6: OUT OF SCOPE
```
