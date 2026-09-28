# OPS-R3.1 统一人工验收准备复核

HUMAN ACCEPTANCE: PENDING

PRODUCTION RELEASE: NOT PERFORMED

2026-09-28 本轮只复核交付、修复旧完成历史可见性并准备隔离人工验收。未重新开发任务书，未新增权限、业务自动化或 migration；未 push、merge、部署或操作生产库。人工验收清单没有勾选。

## 版本与证据

审查基线 `4f594af0dc4f8d8d7e7eff96b0d702d81962e446`；开始分支 `codex/ops-r3-1`、HEAD `b5fe6e6084aa7d5ecd7e5007941564da0e5d10b4`、git status 干净。

历史窄修复提交 `a1e36283381177a7fb97335d214ea1ecf2b851d0`；最后页面修正提交 `abe10bf25c36a98ba0ae4d11026ec22f25ceaa73`。最终交付 HEAD 与提交后的 git status 在证据包根目录 `final-version.json` 中明确记录，正文和截图的对应关系见 [version-and-validation.json](version-and-validation.json)。最终交付提交只整理文档/证据、去除 CSV BOM 并包含 Next dev 自动更新的 AGENTS 说明块，产品代码与最后验证提交相同。

原 `docs/ops-r3-1/evidence` 的构建、31 项既有脚本、HTTP、迁移和五种宽度截图保留为原实施阶段证据，存入 b5fe6e6。它们生成于提交之前，未内嵌完整代码版本/原 BUILD_ID，不能据此宣称逐字对应最终 HEAD，也不能称为本轮重跑。新构建、独立类型检查、最终历史专项与四张新截图明确对应 abe10bf；R1/flow/OPS 综合隔离回归在 a1e3628 运行，之后唯一产品变化是管理员历史提示文字位置，已补跑受影响页面 lint、构建、类型检查与实际页面专项。

## 旧记录专项结果

持久隔离 fixture 中新增两条明确命名的合成旧档案：一条原比赛 COMPLETED，一条原比赛仍 SCHEDULED；原选派均 COMPLETED、双方比分 null、resultVersion 0、resultConfirmedAt null。每条保留两个原选派版本；没有通过赛果确认 API 创建新确认。

|检查位置|修复前实际结果|最终实际结果|
|---|---|---|
|管理员裁判历史|两记录存在，但未区分完赛事实|两记录存在，均明确待核|
|裁判个人历史|仅 1 条；比赛状态仍 SCHEDULED 的旧完成选派被过滤|2 条全部保留，均标注旧完成记录与待核原因|
|执裁统计（该赛事/裁判、全部时间）|已核实场次 0，旧记录无入口|已核实场次仍 0，另列 2 条待核旧档案|

[修复前原始结果](evidence/legacy-history-before.json)、[最终原始结果](evidence/legacy-history-after.json)、[实际命令输出](evidence/legacy-history-after.log)。专项真实登录并请求管理员、个人、统计页面（HTTP 200），验证两条记录、待核标注、零计数、详情链接可读、无匹配裁判/岗位/日期筛选会排除样例；前后核对状态、空比分、赛果版本/时间、选派版本数和相关审计数量完全相同。没有伪造比分或将原档案冒充新确认赛果。测试读 HTML 时去掉 React 脚本载荷，避免把重复的序列化内容当作第二条页面记录。

截图实际来自同一最终隔离生产构建，均为 505×731 单视口：[管理员历史](evidence/screenshots/legacy-admin-history.png)、[个人历史](evidence/screenshots/legacy-member-history.png)、[统计待核档案](evidence/screenshots/legacy-statistics.png)、[统计零场次](evidence/screenshots/legacy-statistics-counts.png)。[浏览器记录](evidence/browser-legacy-review.json) 仅证明上述页面，不能代替五种宽度的全流程人工签收。

## 实际补测

|准确命令|退出码|
|---|---|
|npm run test:referee-r1|0|
|npm run test:referee-flow|0|
|TZ=Europe/London npx --no-install tsx scripts/test-ops-r3-1.ts|0|
|npm run lint|0|
|npm run check:unicode（去 BOM 后）|0|
|node scripts/start-ops-r3-1-acceptance.mjs --build（最后页面改动后）|0|
|npx --no-install tsc --noEmit（最终构建后）|0|
|npx --no-install eslint 管理员历史页面|0|
|OPS_HISTORY_VERSION=abe10bf... npx --no-install tsx scripts/test-ops-r3-1-legacy-history.ts|0|

确切完整命令、产品版本和日志文件在 version-and-validation.json。写入测试均为独立测试库或安全路径检查后的临时 smoke.db；OPS 集成再次验证旧实体计数保持、完整性/FK、重复迁移 no-op 和完整业务保护。原集成 JSON 被脚本默认路径覆盖后，已将本轮结果移至本目录，并恢复原 b5fe6e6 证据的原字节内容。

最终文档空白检查还发现 Markdown 硬换行尾空格（exit 2），去除后复查；此前失败尝试也保留：首次样例建立的 snapshot 对象不符合 String 类型（exit 1），新测试数组类型检查失败（exit 2），原验收 CSV BOM 导致 Unicode 失败（exit 1）。修正后重跑通过；失败不记 PASS。一次编辑工具 Python 编码错误也未造成文件改动，随后使用 UTF-8 的 Node 完成编辑。截图首次全页拼接重复已舍弃，新证据只保留实际检查过的单视口图。

## 隔离环境与本机账号

已复用现有 `/var/folders/s_/k059lw011992bc1q1dcjscwr0000gn/T/nuaafa-ops-acceptance-e9jmcjt6`，未重建或换用个人 dev.db。现有启动脚本核验真实临时根目录、smoke.db、uploads、environment 中路径一致，并禁用个人 Legacy hash；未更改或绕过脚本检查。

完整人工交互入口 **http://127.0.0.1:3188**，使用 `node scripts/start-ops-r3-1-acceptance.mjs --dev`，当前已启动并保留运行。管理员 `/admin/login`；裁判 `/referees/login`。合成管理员 smoke-super/content/competition/referee/multi 按原角色使用；合成裁判学号 16268888。密码仅从该临时目录的本机 `accounts.json` 获取，0600 文件不入证据包或报告；`environment.json` 同样不打包。不要将密码、Cookie 或配置贴入验收反馈。

**http://127.0.0.1:3187** 同时保留最终生产构建用于读取复核（`node scripts/start-ops-r3-1-acceptance.mjs`）。其既有生产来源校验只接受官网来源，浏览器 localhost 登录/写入被拒绝；HTTP 专项显式发送受支持的来源头。人工交互通过现有 dev 模式的回环来源规则完成，未削弱生产来源校验。合成裁判在 3188 实际登录成功，随后在 3187 读取历史页面取得上述截图。

如服务意外结束，可按上述命令重启；不要默认 npm run dev。若临时 fixture 被系统删除，必须按安全准备流程创建独立临时目录、迁移合成库与上传副本及合成配置，再让现有入口通过严格检查；不能把 metadata 指向 dev.db 或生产库。本次 fixture 仍在，因此没有运行重建。

## 迁移与脱敏交付

[迁移说明](../migration-and-data.md) 保留原第 14 个增量 migration、SQLite 重建/回滚边界和人工修复流程。本次历史可见性修复无需迁移、不回填旧比分、不改 COMPLETED，也不更新原版本/审计。

桌面证据包包含 baseline、版本清单、原实施阶段/本轮测试结果、关键截图、迁移 SQL 和说明、未签收的人工清单。按文件白名单复制，拒绝 accounts.json、environment.json、数据库、环境文件、Cookie、会话密钥和私人内容。只脱敏本机用户名路径与临时目录；原始仓库日志不改写，包内注明原文件 SHA-256、脱敏后 SHA-256 与是否做过路径替换，终端日志的其他字节和结果保持原状。既有测试失败元数据同样保留。证据包不是环境备份，不含可登录凭据或数据库。

按 [human-acceptance.md](../human-acceptance.md) 等待检查人完成全流程，记录问题与最终结论。检查项全部未勾选。真实足球中国文件、生产恢复、生产数据库迁移与发布仍未执行。
