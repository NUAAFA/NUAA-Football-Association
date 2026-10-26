# 2026-10-24 审计整改交付说明

执行基线：`496629c67c939c688f2d556917685936a1d658dc`。本轮完成 F01–F07 与首页最新故事 H01 的隔离修复；没有生产发布、真实数据修正或 schema/迁移变更。

## 行为与兼容

- 冲突区间为 `[kickoff, endAt)`。相同开球或开球落入另一已知区间直接阻止；未知时长只提示，绝不补默认时长。已发布比赛的时间等事实继续要求先撤回任务。SQLite 写事务在读取前通过无行 UPDATE 取得写保留，避免两个延迟读事务互相等待；忙/并发失败返回可重试 409。
- 审核只能写 PENDING、REVIEWING、APPROVED、REJECTED。APPOINTED/NOT_SELECTED 由正式任务控制，个人和后台展示也核对真实岗位。发布保留原报名审核快照；正式撤回/取消恢复可证明原结论，已过截止或赛事取消的未决状态不重开，缺少旧快照则留待人工核查。本人已持有正式岗位时不再创建另一条待审核意向。
- 新排名/出线指纹带 `v2:`，只包含排名事实。旧指纹精确匹配且当前仍为正式非测试小组时可只读兼容；普通比赛编辑前，仅将可证明有效的旧确认在同事务内提升，并记录 before/after 审计。真正赛果变化仍失效。旧过期或无法证明的记录不会自动复活。
- 三类裁判提交按对象、任务版本和精确内容预检/读回，无自动重发。每个请求（含响应体）最多 12 秒，一次提交最多预检、写入、读回三段。未知时保留输入并提供再次核对。任务 POST 现在要求 expectedVersionId；旧已打开页面得到安全 400/409，需刷新。
- 数据库模式以 CMS 为公开权威，静态模式保留合法历史内容；无按文章缺失进行的静态回退。列表、详情、首页、sitemap/RSS 共用生效资格。首页最新 3 篇按发布时间、稳定 ID 排序。sitemap 收录全部资格条目，RSS 最近 30 条。
- 相关页面动态读取；feeds 成功/失败均 no-store。新发布、归档和未来时刻跨越在下一请求重新判断。已打开页面需重新加载。存储故障返回安全重试界面；feed 返回 503，独立首页/赛事栏目保留其他内容。
- fast-uri 间接依赖仅从 3.1.8 更新到 3.1.9，保留既有 override、定制 tarball 及其他安全依赖。

## 新隔离环境复现

使用 Node 22.23.4/npm 10.9.9，先新建专用数据库/上传目录，显式设置 DATABASE_URL 与 NUAAFA_UPLOAD_DIR；不要复制真实 .env 或默认数据库。`npm ci` 仅生成 Prisma 客户端，随后在专用空库执行 `prisma migrate deploy`。测试自行建立新的虚构数据库。

```text
npm ci --no-audit --no-fund
npm run build
npm run typecheck
npm run lint
npm run test:audit-business
npm run test:referee-submission-requests
npm run test:audit-public
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs AUDIT_BROWSER_CHANNEL=chrome npm run test:audit-business:http
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs AUDIT_BROWSER_CHANNEL=chrome npm run test:audit-public:http
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs F06_BROWSER_CHANNEL=chrome npm run test:audit-network:browser
npm audit
npm audit --omit=dev
```

浏览器脚本读取现有 `.next`，运行期间不要并行重建。Chrome 仿真不等于真实手机或原生 Safari。自动流水线增加了对应关键入口，但本轮未推送或触发远端 CI。

## 只读历史诊断与撤回限制

```text
npm run audit:diagnose -- --database=/absolute/path/to/explicit-database.db
```

诊断使用 SQLite readOnly + query_only，拒绝默认路径/符号链接，无 apply 模式；输出旧/新确认有效、过期/待核查及报名/岗位矛盾，不修改记录。本轮仅在合成库验证，真实库修正须另行授权。

schema 和旧迁移均未改动。开始使用 v2 后，旧代码不理解新指纹，不能简单回退并宣称旧确认仍有效。若确需回退，先只读盘点 v2 与已有审计 before/after，设计明确的兼容或恢复步骤；不能批量删确认或把无法证明的记录全部宣布有效。任务版本、报名快照及已完成的真实任务历史同样需要保留。

本轮保留既有 V2.10.1/PR #11/Tag/Release 已完成的历史状态。后续生产前需另行核对当时主线、Linux 验证、精确部署身份、备份/恢复/异地副本和告警送达；不把本地 PASS 当作已经合并上线。
