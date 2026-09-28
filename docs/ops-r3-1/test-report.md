# OPS-R3.1 测试报告

日期：2026-09-28。VERIFIED / PASS 仅用于下列实际执行、退出码为 0 的检查。统一人工验收 PENDING。生产数据库、生产发布和真实足球中国文件 NOT RUN。

## 环境与隔离

Mac / Node v24.21.0 / npm 11.19.0，锁定 Next16.3.4、React19.2.4、Prisma7.9.1。未联网安装新版本。每个写入脚本使用显式临时 SQLite 和独立上传目录；HTTP runner 自己准备 fixture、分配 loopback 端口、启动 Next 并清理。新 OPS HTTP/浏览器使用持久临时验收库（acceptance-environment.json），仅合成账号/媒体。

最终构建通过隔离入口运行实际 npm run build，Next 显示加载 .env.local；显式测试 DATABASE_URL、上传目录、内容来源及两个合成会话密钥覆盖其同名配置。隔离启动还禁用继承的真实 Legacy 管理员 hash；CMS Legacy 兼容测试单独生成合成 hash。没有迁移 dev.db，没有对生产写入。

时钟使用相对未来/过去时间，导入时间由北京时间工具构造。专项在 Europe/London 下运行，既有时区回归保持；公共下一场用共享 asOf，HTTP 无写入等待 3.2 秒确实换场。

## 实际既有脚本

表格来自 regression-results.json 每个命令最后一次运行；所有尝试的退出码和 UTC 起止时间仍在 JSON 中，日志保存最后一次。runner 使用 npm run 的真实 package scripts；没有虚构 test/typecheck 脚本。

|准确命令|最后退出码 / 状态|UTC 完成时间|日志|
|---|---|---|---|
|`npm run test:referee-r1`|0 / PASS|2026-09-28T12:29:28.990Z|[log](evidence/test-referee-r1.log)|
|`npm run test:referee-r1-3a:migration:fresh`|0 / PASS|2026-09-28T12:18:37.612Z|[log](evidence/test-referee-r1-3a-migration-fresh.log)|
|`npm run test:competition-import:http`|0 / PASS|2026-09-28T12:52:25.475Z|[log](evidence/test-competition-import-http.log)|
|`npm run test:public-competition-dynamic:http`|0 / PASS|2026-09-28T12:52:27.284Z|[log](evidence/test-public-competition-dynamic-http.log)|
|`npm run test:unified-admin-r1`|0 / PASS|2026-09-28T12:18:33.557Z|[log](evidence/test-unified-admin-r1.log)|
|`npm run test:unified-admin-r1-2`|0 / PASS|2026-09-28T12:29:36.008Z|[log](evidence/test-unified-admin-r1-2.log)|
|`npm run check:unicode`|0 / PASS|2026-09-28T12:55:45.330Z|[log](evidence/check-unicode.log)|
|`npm run test:referee-flow`|0 / PASS|2026-09-28T12:29:28.253Z|[log](evidence/test-referee-flow.log)|
|`npm run test:referee-r1-3a`|0 / PASS|2026-09-28T12:29:29.992Z|[log](evidence/test-referee-r1-3a.log)|
|`npm run test:referee-fix2`|0 / PASS|2026-09-28T12:18:35.252Z|[log](evidence/test-referee-fix2.log)|
|`npm run test:referee-fix3`|0 / PASS|2026-09-28T12:18:35.889Z|[log](evidence/test-referee-fix3.log)|
|`npm run test:referee-fix5`|0 / PASS|2026-09-28T12:18:36.439Z|[log](evidence/test-referee-fix5.log)|
|`npm run test:admin-operations-r2`|0 / PASS|2026-09-28T12:29:34.058Z|[log](evidence/test-admin-operations-r2.log)|
|`npm run test:admin-operations-r2.1`|0 / PASS|2026-09-28T12:29:34.618Z|[log](evidence/test-admin-operations-r2.1.log)|
|`npm run test:competition-import`|0 / PASS|2026-09-28T12:29:35.152Z|[log](evidence/test-competition-import.log)|
|`npm run test:public-competition-dynamic`|0 / PASS|2026-09-28T12:29:33.298Z|[log](evidence/test-public-competition-dynamic.log)|
|`npm run test:security-appointments`|0 / PASS|2026-09-28T12:29:31.223Z|[log](evidence/test-security-appointments.log)|
|`npm run test:security-admission`|0 / PASS|2026-09-28T12:18:25.184Z|[log](evidence/test-security-admission.log)|
|`npm run lint`|0 / PASS|2026-09-28T12:55:45.163Z|[log](evidence/lint.log)|
|`npm run test:referee-admission`|0 / PASS|2026-09-28T12:18:16.989Z|[log](evidence/test-referee-admission.log)|
|`npm run test:referee-match-deletion`|0 / PASS|2026-09-28T12:29:30.544Z|[log](evidence/test-referee-match-deletion.log)|
|`npm run test:unified-admin-rbac`|0 / PASS|2026-09-28T12:18:24.001Z|[log](evidence/test-unified-admin-rbac.log)|
|`npm run test:security-csv`|0 / PASS|2026-09-28T12:18:25.330Z|[log](evidence/test-security-csv.log)|
|`npm run test:team-directory-r1`|0 / PASS|2026-09-28T12:18:29.674Z|[log](evidence/test-team-directory-r1.log)|
|`npm run test:team-directory-r1-1`|0 / PASS|2026-09-28T12:18:30.746Z|[log](evidence/test-team-directory-r1-1.log)|
|`npm run test:security-api-errors`|0 / PASS|2026-09-28T12:19:56.641Z|[log](evidence/test-security-api-errors.log)|
|`npm run test:referee-r1-3a:migration`|0 / PASS|2026-09-28T12:18:36.757Z|[log](evidence/test-referee-r1-3a-migration.log)|
|`npm run test:unified-admin-migration`|0 / PASS|2026-09-28T12:18:37.886Z|[log](evidence/test-unified-admin-migration.log)|
|`npm run test:admin-operations-r2:migration`|0 / PASS|2026-09-28T12:18:38.210Z|[log](evidence/test-admin-operations-r2-migration.log)|
|`npm run test:security-http`|0 / PASS|2026-09-28T12:52:32.973Z|[log](evidence/test-security-http.log)|
|`npm run test:unified-admin-blockers:http`|0 / PASS|2026-09-28T12:52:34.608Z|[log](evidence/test-unified-admin-blockers-http.log)|

## 新增专项与构建

|实际命令|状态|证据|
|---|---|---|
|`node scripts/start-ops-r3-1-acceptance.mjs --build`（内部实际 `npm run build`）|PASS / exit 0|build.log；生产编译、类型检查、页面生成成功|
|`npx --no-install tsc --noEmit`|PASS / exit 0|typecheck.log（成功无输出）|
|`TZ=Europe/London npx --no-install tsx scripts/test-ops-r3-1.ts`|PASS / exit 0|ops-integration.log / json|
|`npx --no-install tsx scripts/test-ops-r3-1-http.ts`|PASS / exit 0|ops-http.log / json，真实 Next HTTP|
|`npm run test:unified-admin-blockers:http -- --cms`|PASS / exit 0|cms-http-regression.log；独立 fixture 中实际运行既有 test-unified-admin-r1-2-http.ts 全部场景|
|`python3 scripts/test-ops-r3-1-audit.py`|PASS / exit 0|audit-test.log；毫秒/ISO 两种日期，调用前后数据库字节不变|
|`python3 scripts/audit-ops-r3-1.py <隔离 smoke.db 路径>`|VERIFIED / exit 0|read-only-audit.json；repairs_performed 0，结果是合成库诊断|
|`git diff --check`|PASS / exit 0|最终仓库检查，无空白错误|

新 OPS 集成实际涵盖 NAV/ADM/CMS/MED/REF/STR/IMP/RES/TAB/QUAL/MIG 断言，11 类旧实体计数保持、FK0/integrity ok/no-op、305 申请与并发、36 场原子导入、0:0/点球/结果竞争、排名/出线失效、历史分类保留、九种 CMS 查询组合及图片/附件私有保护。具体对应关系见 implementation-report.md 需求表。

HTTP 旅程实际执行三输入 36 场预览、零写入、一次提交/重复零、发布、裁判登录确认、未来拒绝、过去比分联动、人工排名/出线及手建半决赛、赛果更正受影响提示、三个候选各40场、时间轮换、关闭公开404/投影安全。不是仅源码字符串断言。共36场断言在添加后续半决赛/时钟测试之前执行；持久验收库该赛事最终38场属于刻意追加的两个 fixture。

CMS HTTP 的既有回归包括角色/页面/导航/CSRF、强制改密及会话失效、合成 Legacy、草稿/归档/未来内容隐藏、新闻游标 DTO、PUBLIC/PRIVATE 响应及真实20MB流式上传。账号修改仅在其自行创建并销毁的隔离库中。

## 浏览器与视觉证据

实际使用 cua_repl 的 In-app Browser，访问隔离3188开发服务并在最终3187构建复查公开文章；没有操作真实网站。browser-journey.json 区分实际 UI 操作和 HTTP 旅程，browser-pdf-downloads.json 记录两份真实 PDF 响应200/application/pdf/605字节/signature。

- 已实际点击：新纪律内容、上传两PDF、正式原件/显示名、排序、保存/重开/发布、移除关系、媒体搜索引用、再选择并发布；最终正文后两份文件且正式原件不重复。
- 已实际点击：赛事组/轮次过滤、上下文建赛、保存继续清空独立字段而保留场地/结构；真正面板页签键盘切换、焦点与URL。
- 已实际检查：跨第1页以外比赛 hash 直达能自动打开第2页并渲染目标。
- 截图覆盖1440/1024/768/390/360：content-editor、media、workspace、published-discipline、public-schedule、account-menu。DOM measurements 中全页 scrollWidth 等于 viewport，允许表格自己的容器横滚。截图为单视口，未以损坏的全页拼接图代替检查。

截图在 [screenshots](evidence/screenshots/)；推荐查看 [最终公开附件](evidence/screenshots/final-published-discipline-1440.png)、[360内容编辑](evidence/screenshots/content-editor-360.png)、[360赛程](evidence/screenshots/public-schedule-360.png)、[保存继续](evidence/screenshots/save-and-continue-1440.png)、[分页直达](evidence/screenshots/match-direct-page-1440.png)。measurement 记录多处宽度；统一全旅程人工视觉签收尚未执行，不据截图宣称人工验收通过。

## 修正过的失败与测试基线

1. 旧动态 migration 测试以当前HEAD充当升级前 schema，改用固定 pre-R3 fixture；保留旧客户端的真实读写断言。旧 R1/Team 迁移脚本的外部 worktree/Windows shell 假设也改成可复现 fixture/平台无关准备，不删除兼容检查。
2. 本轮规则允许多个首页候选，旧“第三候选409”改为创建成功、公开首页仍最多2。未来比赛不得普通编辑COMPLETED，旧HTTP fixture改为明确过去时间后走正式赛果API，权限/URL/私有字段断言保留；无未来空态及比赛锚点预期按新规则调整。
3. 内容提交事务中的媒体 resolver 原全局连接会锁等待，改用同一事务客户端；真实测试通过。上传 staging 清理并发 rename 导致 ENOENT，现只容忍竞争文件已消失，其他错误保留；R1-2重复通过。
4. 构建发现新增测试 fixture 的 null/undefined、结构化文档字面量类型错误，修正显式输入类型并重跑，最终构建和独立tsc均0。一次并行build/tsc期间 .next 生成文件暂不可见，最终按build后顺序类型检查。失败不算PASS。
5. UI窄屏编辑器按钮/附件和转场截图已修正并重新保存；React列表缺key告警补key，后续重新进入未再发生。旧开发日志/少量较早截图可能含开发Issue计数，不是最终构建错误。
6. 新增CMS隔离封装首跑缺申请fixture ID，以及Next dotenv对scrypt美元符展开导致合成Legacy401；正确传入ID和转义合成hash后整个原HTTP脚本真实通过。未放松认证断言；启动入口禁用个人Legacy继承。

regression-results.json 保留5次既有脚本早期失败，最后每项0；其他迭代失败在上述说明记录，不将中途尝试算最终PASS。日志不含真实密码/密钥；账号和测试配置保留本机0600文件。CLI日志保留终端原始输出（包括进度回车和末尾空行），.gitattributes 仅对这些证据日志关闭空白报错；CSV和源文件仍按普通空白检查。

## 明确未执行

统一人工签收、真实足球中国导出兼容、生产数据库/文件诊断、真实生产备份恢复演练、生产migration、push/merge/deploy均 NOT RUN / NOT PERFORMED。不是实现阻塞项；按任务边界停在人工验收。自动抽签、排赛、晋级和API同步 OUT OF SCOPE。
