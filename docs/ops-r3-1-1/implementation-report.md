# NUAAFA OPS-R3.1.1 IMPLEMENTATION REPORT

日期：2026-09-29。分支：`codex/ops-r3-1-1`。起点：`2019231431b0ed26f00d5c81c05b02536ce1a241`（已完成的 OPS-R3.1）。最终实现代码提交：`2a011987dd4c8f5b2f676fd10642903b6b31549a`。本报告另作交付提交；交付 HEAD 见随报告提供的 `git rev-parse HEAD`，两次提交之间没有代码改动。

## 实现结果

1. **DOCX 导入**：在既有 CSV / XLSX / 粘贴导入和 Preview → 校验 → 原子提交链路中增加 `DOCX`。解析仅读取 OOXML `word/document.xml` 的 Word 表格，按 `w:gridSpan` 识别视觉表头“对阵”所覆盖的主、客队两列，提取阶段、轮次、场序、日期、时间、球队、场地、备注。仅支持本次核验的足球中国表格结构，损坏 ZIP/XML、异常结构、超限内容安全失败。Preview 中可逐场或批量补日期、时间、场地，并在重新校验后提交；球队、阶段分类、场序和淘汰赛参考行不可通过补全接口改写。小组和轮次必须对应既有赛事结构，不自动创建拼写相近的新组。真实 fixture SHA-256：`741c85627e6fb9feff4ef441495127f0bf797582a2a83f1b7d1b306c3bfedae2`。
2. **淘汰赛边界**：场序 31–40 在 DOCX Preview 中只读展示。导入不会创建占位球队、淘汰赛比赛或自动晋级。手动建赛可从已经人工确认的出线名单以及已完赛场次的真实胜者/负者选择主客队；平局不推断胜负，双回合总胜负仍需管理员核对。选择候选只填表单，最终保存仍须勾选人工确认；已存在的下一轮比赛双方不会被自动修改。
3. **场序与数据迁移**：`Match.matchNumber` 为可空整数，赛事内非空值唯一，数据库触发器约束 1–99999。新增迁移 `20260929090000_ops_r3_1_1`，没有修改旧迁移，也没有给历史比赛猜场序。新依赖仅 `saxen@11.1.1`（MIT），用于有边界的 XML SAX 解析；ZIP 安全读取复用现有能力，未升级 Next、React 或 Prisma。
4. **媒体与附件**：列表压缩为文件、状态、使用情况、上传信息、操作五列。使用情况只显示数量/类型摘要；弹窗独立滚动并保留全部真实内容链接。新增已使用/未使用服务端筛选，保留原有公开引用的可见性保护和“更多”操作。
5. **可执裁时间**：服务端按裁判员分页聚合，默认每位裁判一行，显示已填写天数、可执裁/不可执裁天数、记录数及最近更新；指定日期时展示当天的状态和时段。详情通过授权 API 按 20 条分页加载，代录入口保留。聚合查询只处理当前 30 位裁判的数据，没有前端全量拉取或 300 条静默截断。

## 实际验证

| 范围 | 结果与证据 |
| --- | --- |
| 真实 DOCX 专项 | `scripts/test-ops-r3-1-1.ts` PASS。识别小组赛 30 场、A/B 组、第 1–5 轮及场序 1–30；淘汰赛参考 10 场、场序 31–40。缺必填项的 30 行阻止提交；隔离库补真实字段路径后原子创建 30 场、0 支新球队，重复导入创建 0 场；错误球队/分组及强行提交占位对阵被拒绝。证据：`evidence/ops-r3-1-1-special.log`。 |
| 淘汰赛、媒体、可执裁专项 | 完赛第 31 场返回真实胜负方候选且自动创建为 0；31 篇内容引用的媒体详情包含全部 31 项，已用/未用筛选分别为 1；20 条可执裁记录聚合为 1 人，30 人分页、指定日期及第 31 人代录后第 2 页均通过。证据同上。 |
| OPS-R3.1 兼容 | 原 OPS 专项、历史数据迁移与赛程导入回归通过；隔离 HTTP 旅程通过（36 场 CSV/XLSX/粘贴预览及原子提交）。证据：`evidence/ops-r3-1-regression.log`、`evidence/ops-r3-1-http.json`。 |
| 现有自动化 | `scripts/test-ops-r3-1-1-regressions.mjs` 顺序运行 package.json 中 26 项，26/26 PASS，覆盖 competition import、unified admin/RBAC、referee flow、媒体内容、migration、security、公开赛事、Unicode 和 lint。证据：`evidence/regressions/results.json` 及同目录日志。 |
| 构建与类型 | `npx --no-install tsc --noEmit`、`npm run lint`、`npm run build`、`git diff --check` 实际通过。构建证据：`evidence/build.log`。迁移和浏览器/HTTP 均使用系统临时目录中的隔离 SQLite；未触碰生产库。 |
| 浏览器 | 本地隔离后台实际上传真实 DOCX，Preview 展示 30 场小组赛与 10 场只读淘汰赛；补全并重新校验后显示“检查通过，可以导入”。媒体 30 篇引用只占单行且弹窗有 30 个内容链接；20 条时间记录只占 1 行且详情完整、指定日期状态正确；第 31 场胜负方候选点击后表单值为真实 `team:` ID。1024、768、390、360 视口均已检查。 |

浏览器截图位于 `evidence/screenshots/`：`docx-preview-720.png`、`knockout-manual-720.png`、`media-detail-720.png`、`availability-detail-720.png`；媒体与可执裁页面另有 `1440/1024/768/390/360` 宽度截图。实测媒体最大行高在上述宽度分别为 101/122/122/126/126 px，与引用数无关；可执裁行高约 75–77 px。页面 `documentElement.scrollWidth` 与各视口宽度一致，表格的窄屏横向滚动限定在表格容器内。

## 已知限制与验收边界

- 解析器只接受本次核验的足球中国 Word 表格结构；其他 DOCX 模板需要另行核验和适配，不做 OCR 或通用文档语义推断。
- 样例的日期、时间、场地缺失时不会补造。浏览器通过时使用明确标记为“隔离”的测试赛事和合成补全值；正式导入必须由管理员核对真实赛程信息。
- 双回合总胜负、最终排名及出线仍需人工确认；系统只提供真实球队候选。生产数据、生产迁移和生产页面均未验证或变更。

NUAAFA OPS-R3.1.1 IMPLEMENTATION: PASS

HUMAN ACCEPTANCE: PENDING

PRODUCTION RELEASE: NOT PERFORMED

NO PUSH · NO MERGE MAIN · NO PRODUCTION MIGRATION · NO DEPLOY。**STOP FOR HUMAN ACCEPTANCE.**
