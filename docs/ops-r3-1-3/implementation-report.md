# NUAAFA OPS-R3.1.3 IMPLEMENTATION REPORT

2026-10-01 · 当前未提交工作区交付 · 技术实施与本地验证完成，统一人工验收待进行。

## A. Current Worktree

- Starting / final branch：`codex/ops-r3-1-1`。
- Starting / final HEAD：`86658c6838dfe93b93147bb0ce34e00acf5ca228`。
- 起始状态包含 42 个已跟踪修改文件和 13 条未跟踪状态记录。目录记录并不等于文件数量；其中 `docs/ops-r3-1-3/` 是本轮为记录证据先创建的目录。
- 继承合法的 OPS-R3.1.2 未提交实现，在现有服务、导入器、分组与排期能力上继续修改。保留 R3.1.2 迁移、脚本和交付资料。
- 已保存起始状态、差异统计、文件状态和已跟踪修改 patch。没有执行 reset、clean、restore、覆盖 checkout、丢弃文件或回退；patch 不冒充未跟踪文件的完整备份。
- 最终 45 个已跟踪文件修改；所有新增文件（含继承的 R3.1.2 未跟踪文件）、迁移和完整状态逐项列在清单中。`docs/ops-r3-1/evidence/ops-integration.json` 是运行旧集成测试重新生成的证据。
- 未暂存、未提交、未推送、未合并；HEAD 未变化。

完整清单：[起始 git status](/Users/xianghanwang/Documents/Codex/NUAAFA/docs/ops-r3-1-3/evidence/starting-status.txt)、[起始 diff stat](/Users/xianghanwang/Documents/Codex/NUAAFA/docs/ops-r3-1-3/evidence/starting-diff-stat.txt)、[起始 name status](/Users/xianghanwang/Documents/Codex/NUAAFA/docs/ops-r3-1-3/evidence/starting-name-status.txt)、[继承修改 patch](/Users/xianghanwang/Documents/Codex/NUAAFA/docs/ops-r3-1-3/evidence/inherited-r3-1-2.patch)、[最终文件清单](/Users/xianghanwang/Documents/Codex/NUAAFA/docs/ops-r3-1-3/evidence/worktree-files.json)、[最终 git status](/Users/xianghanwang/Documents/Codex/NUAAFA/docs/ops-r3-1-3/evidence/final-status.txt)、[最终 diff stat](/Users/xianghanwang/Documents/Codex/NUAAFA/docs/ops-r3-1-3/evidence/final-diff-stat.txt)、[最终 name status](/Users/xianghanwang/Documents/Codex/NUAAFA/docs/ops-r3-1-3/evidence/final-name-status.txt)。

[受测源文件 SHA-256](/Users/xianghanwang/Documents/Codex/NUAAFA/docs/ops-r3-1-3/evidence/tested-source-sha256.json) 将结果绑定到当前源文件，不能只凭未变化的 HEAD 判断这批未提交改动。

## B. Workspace UX

赛事工作台按 URL 分为四页签，按需挂载内容，移动端四个入口采用两行布局：

| 页签 | 常驻职责 | 按需操作 |
| --- | --- | --- |
| 赛事资料 | 赛事基础资料、制式、公开状态、主办承办、周期、简介等 | 保存资料 |
| 球队与分组 | 人数摘要、小组目录、搜索、筛选、分页、球队列表 | 添加组织代表队/联合队/自由球队、新建或编辑小组、批量分组、移除 |
| 赛程与比分 | 场数、待排期/已安排/已结束、筛选和排序、比赛行 | 导入、手建比赛、安排/改期、符合条件时录入赛果 |
| 积分与出线 | 小组积分、尚未开赛提示、零统计、确认状态 | 调整同分次序、人工出线确认 |

球队页和赛程页移除了重复的完整积分、全队出线勾选、原因大文本、人工排序箭头和常驻阶段创建长面板。“阶段与轮次”复用一个弹窗组件。添加球队的多种创建表单也收进弹窗。

桌面保留深蓝侧栏、浅灰背景、白色面板及原有按钮/Badge。小组目录支持任意名称、搜索及每页 16 组；球队每页 30 支，多选条仅在选中时出现，切换页、筛选或阶段会清空选择，避免操作不可见球队。

赛程在数据库分页前排序：默认场序升序，空场序置后并用阶段/轮次/id 稳定排序；时间排序将未知时间置后。已安排筛选排除缺时间或场地的待排期比赛。未开始的比赛不称为“待赛果”。

原有手工排名、出线、比分更正待复核和手工淘汰赛路径保留。没有自动晋级、自动排赛或自动生成下一轮球队。

主要实现：[工作台](/Users/xianghanwang/Documents/Codex/NUAAFA/src/components/referees/admin/admin-competition-workspace.tsx)、[球队分组](/Users/xianghanwang/Documents/Codex/NUAAFA/src/components/admin/team-grouping-manager.tsx)、[积分与结构](/Users/xianghanwang/Documents/Codex/NUAAFA/src/components/admin/competition-structure-manager.tsx)、[共享弹窗](/Users/xianghanwang/Documents/Codex/NUAAFA/src/components/admin/workspace-dialog.tsx)。

## C. Team Removal

“移出本小组”解除当前阶段的 membership，球队仍在当前赛事；“从本赛事移除”通过新 Service/API 检查后，在同一事务内删除当前 Competition 的 Team 和 memberships。无依赖的已分组球队可直接移除，无需先移出小组。

预检查批量读取 Match 和排名/出线确认快照。有任何关联比赛（待排期、已安排、取消、已结束均包括）或确认历史就阻止普通误加删除；比赛的赛果、选派与裁判历史随关联 Match 得到保护。返回可读原因和比赛链接。不会 cascade 删除 Match，不删除学院、AffiliationUnit 或其他赛事球队；普通审计记录本身不被误当作正式业务依赖。

混合批次先列明安全/阻止数量。原样提交包含阻止球队的批次整体失败；只有管理员勾选“仅移除可安全移除球队”并确认具体名单后，才提交安全集合。服务端再次在事务内检查，配合 Match 外键 Restrict 和确认快照删除触发器保护检查后的依赖变化。

API 强制写权限与 CSRF，验证显式、去重、同赛事 Team ID，检查请求不写数据。成功后刷新页面及公开赛事/球队目录缓存；后续导入重新读取真实候选，不会复活被删除球队。

审计包含 `TEAM_REMOVED_FROM_COMPETITION`、`TEAM_BULK_REMOVED_FROM_COMPETITION`、`TEAM_GROUP_REMOVED`，记录赛事、球队名称/id、原小组、actor、时间、原因和数量。保留旧消费者需要的逐队 `TEAM_DELETED` 事件。

主要实现：[移除服务](/Users/xianghanwang/Documents/Codex/NUAAFA/src/lib/competition-team-removal.ts)、[移除 API](/Users/xianghanwang/Documents/Codex/NUAAFA/src/app/api/admin/competitions/[id]/teams/remove/route.ts)、[分组服务](/Users/xianghanwang/Documents/Codex/NUAAFA/src/lib/competition-structure-service.ts)。

## D. Import Matching

导入顺序为“上传文件 → 对应球队和小组 → 检查赛程与暂定信息 → 确认导入”，继续复用 DOCX/XLSX/CSV/粘贴解析、文件安全、审计和原子提交。

候选计算使用 NFKC、大小写、空格和常见无身份意义标点规范化，再用确定性的相似度/简称前缀产生最多 8 条推荐。保留原文，不删除“一队/二队/男队/女队/校区”。`SQA 项目队`、`机电`只产生候选，管理员确认后保存当前赛事真实 Team ID；`致慧书院`遇到一队/二队必须选择。不会自动合并或删除 `SQA项目` 与 `SQA项目队`。

来源名称去重后只确认一次，显示受影响场数，应用到本次所有相关行；可展开已确认项修改并重新检查。提供搜索全部真实球队的选项，不局限于推荐候选。赛事球队一次批量读取，110 队、109 行的专项检查通过。

小组对应单独确认，最终检查 membership，不因球队名字对应成功就创建小组或改组。分组不符用人类语言显示，可在保留文件的弹窗内管理分组；技术码、原文和内部字段放进折叠详情。

HTTP 比赛导入强制严格身份模式。提交时在事务内重建 preview，并检查绑定文件输入、真实映射、行集合、结构 fingerprint 和公开影响的 planHash。跨赛事 ID、主客同一球队、删除后的映射、结构变化和场序冲突会阻止提交；失效映射不会自动重建或改成其他相似球队。

主要实现：[匹配函数](/Users/xianghanwang/Documents/Codex/NUAAFA/src/lib/competition-import-matching.ts)、[导入服务](/Users/xianghanwang/Documents/Codex/NUAAFA/src/lib/competition-import-service.ts)、[导入 UI](/Users/xianghanwang/Documents/Codex/NUAAFA/src/components/admin/competition-import-manager.tsx)。

## E. Partial Scheduling

| 输入 | 保存行为 |
| --- | --- |
| 日期、时间、场地都空 | 允许待排期，正式 kickoff 为 null |
| 只有日期 | 存储零补齐的 `tentativeDate`，正式 kickoff 为 null，不生成午夜时间 |
| 只有场地 | 保存场地，继续待排期 |
| 下午/周末/待通知等文字或只有时钟 | 存储 `tentativeSchedule`，不生成正式 kickoff |
| 完整时间但格式无效或有歧义 | 需管理员显式选择保留为待排期说明，否则阻止 |

预览显示暂定日期/说明和汇总 Warning。比赛详情提供暂定信息编辑入口；服务端限制可编辑状态、日期格式与说明长度，验证权限/CSRF并写审计，编辑暂定信息不修改已有正式 kickoff。重复导入沿用防覆盖规则，不静默覆盖已有安排或赛果。

主要实现：[暂定信息表单](/Users/xianghanwang/Documents/Codex/NUAAFA/src/components/admin/match-tentative-form.tsx)、[暂定信息 API](/Users/xianghanwang/Documents/Codex/NUAAFA/src/app/api/admin/matches/[id]/tentative/route.ts)。

## F. Partial Import

逐行显式选择、重新检查并显示“本次导入/暂不导入/淘汰赛参考”数量。排除行保留在预览及审计，可恢复或下载 CSV；不会偷偷跳过异常行。空集合不能提交。

选定行在一个事务中重新校验并全部提交或全部回滚。专项验证 30 场选 28 场、排除 2 场成功；选定集合仍有真实错误时零场创建。DOCX 淘汰赛参考 10 条继续仅作为参考，未自动创建比赛、占位球队或晋级关系。

最终确认采用 HTML dialog，展示准确行数，避免原生 JavaScript confirm 在内嵌浏览器中的控制问题。

## G. Database

本轮新增 [20261001120000_ops_r3_1_3/migration.sql](/Users/xianghanwang/Documents/Codex/NUAAFA/prisma/migrations/20261001120000_ops_r3_1_3/migration.sql)：

- Match 增加可空 `tentativeDate` 和 `tentativeSchedule`，旧行默认 null。
- 增加 `ops_team_confirmation_delete`，阻止删除当前赛事排名/出线 JSON 快照引用的 Team。
- 保留所有旧字段、旧触发器、历史数据和 Match 外键。

继承的 [20261001090000_ops_r3_1_2/migration.sql](/Users/xianghanwang/Documents/Codex/NUAAFA/prisma/migrations/20261001090000_ops_r3_1_2/migration.sql) 保留。Prisma client 已生成。

R3.1.2/R3.1.3 迁移检查均在隔离 SQLite 运行，逐字段比较旧安排、比分、result version、任务和 membership，外键与完整性通过。历史 HTTP 回归确认旧记录仍可见、未伪造比分、未增加已确认执裁统计。

没有迁移用户现有开发数据库或生产数据库。没有连接生产执行变更或部署。

## H. Tests

以下是真实运行并检查退出码的命令；PASS 仅指列出的本地技术检查。主批次 14 项结果及时间戳见 [final-verification-results.json](/Users/xianghanwang/Documents/Codex/NUAAFA/docs/ops-r3-1-3/evidence/final-verification-results.json)，后续 CMS、历史和专项补充见 [additional-verification-results.json](/Users/xianghanwang/Documents/Codex/NUAAFA/docs/ops-r3-1-3/evidence/additional-verification-results.json)。

| 实际命令 | 结果 | 证据 |
| --- | --- | --- |
| `npm run build` | PASS / exit 0 | [构建](/Users/xianghanwang/Documents/Codex/NUAAFA/docs/ops-r3-1-3/evidence/build-final.log) |
| `npm run lint` | PASS / exit 0 | [Lint](/Users/xianghanwang/Documents/Codex/NUAAFA/docs/ops-r3-1-3/evidence/lint-final.log) |
| `npm run check:unicode` | PASS / exit 0 | [Unicode](/Users/xianghanwang/Documents/Codex/NUAAFA/docs/ops-r3-1-3/evidence/unicode-final.log) |
| `npx --no-install tsc --noEmit` | PASS / exit 0 | [Typecheck（成功时空日志）](/Users/xianghanwang/Documents/Codex/NUAAFA/docs/ops-r3-1-3/evidence/typecheck-final.log) |
| `git diff --check` | PASS / exit 0 | [Diff check](/Users/xianghanwang/Documents/Codex/NUAAFA/docs/ops-r3-1-3/evidence/diff-check-final.log) |
| `python3 scripts/test-ops-r3-1-3-migration.py` | PASS / exit 0 | [迁移](/Users/xianghanwang/Documents/Codex/NUAAFA/docs/ops-r3-1-3/evidence/r313-migration.log) |
| `python3 scripts/test-ops-r3-1-2-migration.py` | PASS / exit 0 | [继承迁移](/Users/xianghanwang/Documents/Codex/NUAAFA/docs/ops-r3-1-3/evidence/ops-r3-1-2-migration.log) |
| `npm run test:ops-r3-1-3` | PASS / exit 0 | [专项](/Users/xianghanwang/Documents/Codex/NUAAFA/docs/ops-r3-1-3/evidence/ops-r3-1-3-final.log) |
| `npm run test:ops-r3-1-3:http`（使用独立 fixture/origin） | PASS / exit 0 | [真实 HTTP](/Users/xianghanwang/Documents/Codex/NUAAFA/docs/ops-r3-1-3/evidence/http-r313-final.log) |
| `npx --no-install tsx scripts/test-ops-r3-1.ts` | PASS / exit 0 | [R3.1](/Users/xianghanwang/Documents/Codex/NUAAFA/docs/ops-r3-1-3/evidence/ops-r3-1-final.log) |
| `npx --no-install tsx scripts/test-ops-r3-1-1.ts` | PASS / exit 0 | [R3.1.1 / DOCX](/Users/xianghanwang/Documents/Codex/NUAAFA/docs/ops-r3-1-3/evidence/ops-r3-1-1-final.log) |
| `node scripts/test-ops-r3-1-3-regressions.mjs` | PASS，28 个子命令 exit 0 | [逐项命令与结果](/Users/xianghanwang/Documents/Codex/NUAAFA/docs/ops-r3-1-3/evidence/regressions/results.json) |
| `npm run test:security-runtime-r2` | PASS / exit 0 | [Runtime safety](/Users/xianghanwang/Documents/Codex/NUAAFA/docs/ops-r3-1-3/evidence/security-runtime-r2-final.log) |
| `npm run test:security-http` | PASS / exit 0 | [HTTP safety](/Users/xianghanwang/Documents/Codex/NUAAFA/docs/ops-r3-1-3/evidence/security-http-final.log) |
| `npm run test:unified-admin-blockers:http` | PASS / exit 0 | [后台阻塞回归](/Users/xianghanwang/Documents/Codex/NUAAFA/docs/ops-r3-1-3/evidence/media-content-blockers-final.log) |
| `npm run test:unified-admin-blockers:http -- --cms` | PASS / exit 0 | [完整媒体/内容 HTTP](/Users/xianghanwang/Documents/Codex/NUAAFA/docs/ops-r3-1-3/evidence/media-content-http-final.log) |
| 历史 HTTP 命令（见下方） | PASS / exit 0 | [历史事实](/Users/xianghanwang/Documents/Codex/NUAAFA/docs/ops-r3-1-3/evidence/legacy-history-final.log) |

28 个回归子命令覆盖 R3.1.2、competition import/HTTP、比赛删除、裁判全流程/R1/R1.3a/fix2/fix3/fix5、后台 R1/R1.2/RBAC、运营 R2/R2.1、迁移、CSV/准入/选派/API 安全、公开赛事及 HTTP、球队目录，以及 lint/unicode。结果清单保留准确 package script 名称及每项退出码。

专项覆盖 TEAM-REMOVE-01..07、IMPORT-MATCH-01..04、IMPORT-TIME-01..04、IMPORT-SUBSET-01..02、IMPORT-DELETE-01：包含真实 4 队/3 安全/1 阻止、依赖在预检查后增加、排名与出线快照、全部 Match 状态、删除映射禁止复活、110 队候选和 109 行同名只对应一次。HTTP 专项验证权限/CSRF/跨赛事、预检查零写入、混合批次回滚、准确安全集合、重复移除不重复审计及暂定日期编辑。

复跑主要技术检查：

```sh
node scripts/verify-ops-r3-1-3.mjs
```

该脚本包括独立 HTTP fixture 和临时服务器清理。主批次首次运行时尚未加入最后的 `--cms` 行，CMS 已单独实际运行通过；当前脚本已包含该行，没有把两个运行记录混写成一次。

历史检查使用明确的隔离环境：

```sh
OPS_HISTORY_ENV_FILE=docs/ops-r3-1-3/evidence/legacy-acceptance-environment.json OPS_HISTORY_EVIDENCE_DIR=docs/ops-r3-1-3/evidence OPS_HISTORY_VERSION=OPS-R3.1.3-worktree npx --no-install tsx scripts/test-ops-r3-1-legacy-history.ts
```

对应临时 3196 服务器已停止；复跑需先重建/启动隔离历史环境，不能把上述命令视为无需 fixture 的独立命令。[原始事实 before](/Users/xianghanwang/Documents/Codex/NUAAFA/docs/ops-r3-1-3/evidence/legacy-history-before.json) 与 [after](/Users/xianghanwang/Documents/Codex/NUAAFA/docs/ops-r3-1-3/evidence/legacy-history-after.json) 保留。

开发中遇到并修复的失败也保留：浏览器发现纯日期工具间接引用服务端 `node:crypto`，已拆出纯错误类型，构建、浏览器和 API 错误回归通过；旧迁移 worker 未应用新增迁移，已补齐迁移链；历史脚本硬编码的旧临时环境不存在，增加显式环境参数并创建合成 fixture；合成历史成员的首次改密状态妨碍历史页面检查，仅调整该 fixture。早期单独 CMS HTTP 命令缺少 fixture 配置失败，改用现有完整 `--cms` 隔离 runner 后通过。没有删断言或放宽产品权限来取得 PASS。

## I. Browser

实际使用本地隔离数据库及 Chrome 完成可见操作和截图，不以 DOM 字符串代替视觉检查。浏览器验收服务为 `http://127.0.0.1:3195`，独立代码副本 `/tmp/nuaafa-r313-browser-app` 使用自己的 `.next`，未复制用户 `.env.local`。用户原有 3193 开发进程保留。

实际 DOCX 操作链：上传足球中国格式测试文件（将来源名称改为 `SQA 项目队`）→ 识别 30 场及 10 条淘汰赛参考 → 人工确认来源名称，影响 5 场 → 显式排除第 29/30 场 → 重新检查为 28/2 → 确认提交 → 返回新增球队 0、复用球队 12、新建比赛 28、排除 2、待排期警告 28；未创建淘汰赛。此为真实浏览器提交结果；持久化数量与来源映射见 [浏览器 DOCX 导入审计](/Users/xianghanwang/Documents/Codex/NUAAFA/docs/ops-r3-1-3/evidence/browser-docx-import-audit.json)。

为另外验收“共 30 场、29 待排期、1 已安排”，之后准备脚本在同一个隔离赛事补入第 29/30 场，并将第 1 场安排到未来时间。这是后续测试数据准备，不是把 28 场导入宣称为 30 场。最终小赛事保留 13 队、12 已分组、1 未分组、A/B 两组。

单队移除在另一个隔离赛事真实完成 8→7；关联待排期比赛的球队被阻止，显示关联比赛链接。混合选择界面实际显示 1 安全/1 阻止、显式安全集合和最终 1 队名单，但未提交这次混合 UI 删除以保留验收 fixture；4/3/1 的真实删除由专项服务测试验证。

72 队/17 组赛事实际验证目录搜索、自定义第 17 组、30 队分页及翻页清空选择。赛程默认第 1→30 场，筛选待排期 29/已安排 1。尚未开赛积分视图没有默认原因框、全队出线选择或排序操作。实际检查弹窗 Escape 关闭及返回“添加球队”焦点、页签键盘切换。共享阶段/轮次弹窗已截图，结束时关闭并恢复正常视口，验收工作台保留。

### 五种宽度

四页签第一屏及已确认名称映射在全部五种宽度截图。最终移动端四页签均可见，小组目录和映射改成适合窄屏的布局。DOM 宽度/排序/选择/焦点 JSON 仅作为截图和真实操作的补充。

| 宽度 | 赛事资料 | 球队与分组 | 赛程与比分 | 积分与出线 | 名称对应 |
| --- | --- | --- | --- | --- | --- |
| 1440 | [截图](/Users/xianghanwang/Documents/Codex/NUAAFA/docs/ops-r3-1-3/evidence/overview-1440.jpg) | [截图](/Users/xianghanwang/Documents/Codex/NUAAFA/docs/ops-r3-1-3/evidence/teams-1440.jpg) | [截图](/Users/xianghanwang/Documents/Codex/NUAAFA/docs/ops-r3-1-3/evidence/matches-1440.jpg) | [截图](/Users/xianghanwang/Documents/Codex/NUAAFA/docs/ops-r3-1-3/evidence/standings-1440.jpg) | [截图](/Users/xianghanwang/Documents/Codex/NUAAFA/docs/ops-r3-1-3/evidence/import-mapping-confirmed-1440.jpg) |
| 1024 | [截图](/Users/xianghanwang/Documents/Codex/NUAAFA/docs/ops-r3-1-3/evidence/overview-1024.jpg) | [截图](/Users/xianghanwang/Documents/Codex/NUAAFA/docs/ops-r3-1-3/evidence/teams-1024.jpg) | [截图](/Users/xianghanwang/Documents/Codex/NUAAFA/docs/ops-r3-1-3/evidence/matches-1024.jpg) | [截图](/Users/xianghanwang/Documents/Codex/NUAAFA/docs/ops-r3-1-3/evidence/standings-1024.jpg) | [截图](/Users/xianghanwang/Documents/Codex/NUAAFA/docs/ops-r3-1-3/evidence/import-mapping-confirmed-1024.jpg) |
| 768 | [截图](/Users/xianghanwang/Documents/Codex/NUAAFA/docs/ops-r3-1-3/evidence/overview-768.jpg) | [截图](/Users/xianghanwang/Documents/Codex/NUAAFA/docs/ops-r3-1-3/evidence/teams-768.jpg) | [截图](/Users/xianghanwang/Documents/Codex/NUAAFA/docs/ops-r3-1-3/evidence/matches-768.jpg) | [截图](/Users/xianghanwang/Documents/Codex/NUAAFA/docs/ops-r3-1-3/evidence/standings-768.jpg) | [截图](/Users/xianghanwang/Documents/Codex/NUAAFA/docs/ops-r3-1-3/evidence/import-mapping-confirmed-768.jpg) |
| 390 | [截图](/Users/xianghanwang/Documents/Codex/NUAAFA/docs/ops-r3-1-3/evidence/overview-390.jpg) | [截图](/Users/xianghanwang/Documents/Codex/NUAAFA/docs/ops-r3-1-3/evidence/teams-390.jpg) | [截图](/Users/xianghanwang/Documents/Codex/NUAAFA/docs/ops-r3-1-3/evidence/matches-390.jpg) | [截图](/Users/xianghanwang/Documents/Codex/NUAAFA/docs/ops-r3-1-3/evidence/standings-390.jpg) | [截图](/Users/xianghanwang/Documents/Codex/NUAAFA/docs/ops-r3-1-3/evidence/import-mapping-confirmed-390.jpg) |
| 360 | [截图](/Users/xianghanwang/Documents/Codex/NUAAFA/docs/ops-r3-1-3/evidence/overview-360.jpg) | [截图](/Users/xianghanwang/Documents/Codex/NUAAFA/docs/ops-r3-1-3/evidence/teams-360.jpg) | [截图](/Users/xianghanwang/Documents/Codex/NUAAFA/docs/ops-r3-1-3/evidence/matches-360.jpg) | [截图](/Users/xianghanwang/Documents/Codex/NUAAFA/docs/ops-r3-1-3/evidence/standings-360.jpg) | [截图](/Users/xianghanwang/Documents/Codex/NUAAFA/docs/ops-r3-1-3/evidence/import-mapping-confirmed-360.jpg) |

### 要求的操作截图

| 要求 | 证据 |
| --- | --- |
| 球队第一屏 | [13 队/2 组](/Users/xianghanwang/Documents/Codex/NUAAFA/docs/ops-r3-1-3/evidence/teams-1440.jpg) |
| 小组目录 | [72 队/17 组](/Users/xianghanwang/Documents/Codex/NUAAFA/docs/ops-r3-1-3/evidence/teams-72-groups-17.jpg)、[自定义组搜索](/Users/xianghanwang/Documents/Codex/NUAAFA/docs/ops-r3-1-3/evidence/directory-17-search.jpg) |
| 删除确认 | [桌面](/Users/xianghanwang/Documents/Codex/NUAAFA/docs/ops-r3-1-3/evidence/team-removal-confirm.jpg)、[360](/Users/xianghanwang/Documents/Codex/NUAAFA/docs/ops-r3-1-3/evidence/team-removal-confirm-360.jpg)、[实际成功](/Users/xianghanwang/Documents/Codex/NUAAFA/docs/ops-r3-1-3/evidence/team-removal-success.jpg) |
| 删除阻止 | [关联比赛](/Users/xianghanwang/Documents/Codex/NUAAFA/docs/ops-r3-1-3/evidence/team-removal-blocked-1440.jpg)、[390](/Users/xianghanwang/Documents/Codex/NUAAFA/docs/ops-r3-1-3/evidence/team-removal-blocked-390.jpg)、[360](/Users/xianghanwang/Documents/Codex/NUAAFA/docs/ops-r3-1-3/evidence/team-removal-blocked-360.jpg)、[显式安全集合](/Users/xianghanwang/Documents/Codex/NUAAFA/docs/ops-r3-1-3/evidence/team-removal-mixed-safe-only.jpg) |
| 赛程列表 | [30 场/29 待排期/1 已安排](/Users/xianghanwang/Documents/Codex/NUAAFA/docs/ops-r3-1-3/evidence/matches-1440.jpg) |
| 积分空闲视图 | [未开赛](/Users/xianghanwang/Documents/Codex/NUAAFA/docs/ops-r3-1-3/evidence/standings-1440.jpg) |
| 导入对应页面 | [待确认](/Users/xianghanwang/Documents/Codex/NUAAFA/docs/ops-r3-1-3/evidence/import-mapping-1440.jpg) |
| 名称近似确认 | [SQA 影响 5 场](/Users/xianghanwang/Documents/Codex/NUAAFA/docs/ops-r3-1-3/evidence/import-name-candidate-final.jpg)、[已确认 SQA/机电](/Users/xianghanwang/Documents/Codex/NUAAFA/docs/ops-r3-1-3/evidence/import-mapping-confirmed-1440.jpg) |
| 待排期导入 | [暂定日期/文字/场地预览](/Users/xianghanwang/Documents/Codex/NUAAFA/docs/ops-r3-1-3/evidence/import-tentative-date-text.jpg)、[提交后页面（结果面板位于截图下方）](/Users/xianghanwang/Documents/Codex/NUAAFA/docs/ops-r3-1-3/evidence/import-subset-success.jpg)、[持久化创建 28 场审计](/Users/xianghanwang/Documents/Codex/NUAAFA/docs/ops-r3-1-3/evidence/browser-docx-import-audit.json) |
| 28/30 选择汇总 | [选择](/Users/xianghanwang/Documents/Codex/NUAAFA/docs/ops-r3-1-3/evidence/import-subset-28-of-30.jpg)、[汇总](/Users/xianghanwang/Documents/Codex/NUAAFA/docs/ops-r3-1-3/evidence/import-subset-summary.jpg)、[最终确认](/Users/xianghanwang/Documents/Codex/NUAAFA/docs/ops-r3-1-3/evidence/import-subset-confirm-dialog.jpg) |
| 共享阶段轮次 | [按需弹窗](/Users/xianghanwang/Documents/Codex/NUAAFA/docs/ops-r3-1-3/evidence/shared-stage-round-dialog.jpg) |

浏览器实际移除后的成功状态：

![隔离赛事移除 1 支球队成功，剩余 7 支球队](/Users/xianghanwang/Documents/Codex/NUAAFA/docs/ops-r3-1-3/evidence/team-removal-success.jpg)

## J. Known Limitations

- 人工业务验收尚未完成；所有删除/导入写操作仅针对隔离合成数据，不能将本地技术 PASS 等同于真实赛事验收或生产发布。
- 球队和小组使用客户端分页，页面仍加载当前赛事完整 roster；72 队浏览器与 110 队专项已验证，不宣称实现了服务端球队分页或无限规模性能。
- 模糊匹配是确定性推荐，最多 8 个候选并可搜索全部球队；没有外部 AI、自动简称词典、数据库合并或身份自动裁决。
- HTTP 比赛导入严格绑定真实 Team。为兼容既有可信内部 CSV 服务调用，未传 `strictIdentity` 的内部入口仍保留旧创建行为；该兼容入口不是 HTTP 管理员导入路径。
- DOCX 继续针对已支持的足球中国表格格式；未宣称所有任意排版 Word 文件均可解析。暂定文字仅保留说明，不推断真实开赛时间。
- 重复导入采用既有跳过/冲突保护，不将导入当作批量覆盖已有安排、比分或暂定字段的编辑工具。
- 未执行生产迁移、生产数据验证、部署、推送或 main 合并。当前工作仍未提交，后续发布需覆盖继承的 R3.1.2 与本轮 R3.1.3 迁移链。
- 3195 是用于人工验收的临时本地服务；其他本轮测试生产模式/历史 HTTP 服务已停止。保留的独立代码副本已与当前受测 `src` 文件核对，后续工作区改动不会自动同步到该副本。

可继续人工验收：[13 队工作台](http://127.0.0.1:3195/admin/competitions/cmupqqaur001rkm1g5hsu8hud?section=teams)、[72 队/17 组工作台](http://127.0.0.1:3195/admin/competitions/cmuproj1i0003k21geln9ao1d?section=teams)。

NUAAFA OPS-R3.1.3 IMPLEMENTATION: PASS

HUMAN ACCEPTANCE: PENDING

PRODUCTION RELEASE: NOT PERFORMED

STOP FOR HUMAN ACCEPTANCE.
