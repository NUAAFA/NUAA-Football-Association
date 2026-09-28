# OPS-R3.1 实施报告

日期：2026-09-28。唯一范围依据为用户提供的 `NUAAFA_OPS_R3_1_CODEX_TASK_2026-09-27.md`。从干净的 main / `4f594af0dc4f8d8d7e7eff96b0d702d81962e446` 开发，分支 `codex/ops-r3-1`；没有回退新代码。初始状态和 KEEP / EXTEND / FIX / NEW 见 [baseline.md](baseline.md)。

全部必做工作流已 IMPLEMENTED。下表 VERIFIED 指对应实际自动化或浏览器证据通过，人工统一验收仍 PENDING；生产验证、真实足球中国导出样例 NOT RUN。准确命令、失败记录与截图见 [test-report.md](test-report.md)。

## 需求与证据

|需求 ID|实施 / 验证状态|结果与主要证据|
|---|---|---|
|NAV-01|IMPLEMENTED / VERIFIED|权限过滤后按路径段最长匹配，仅一项 aria-current；八类路由专项断言，浏览器活动菜单数量 1。|
|ADM-01、ADM-02|IMPLEMENTED / VERIFIED|默认 PENDING，三状态真实计数、每页 30、305 条可遍历；并发批准/拒绝只一方成功，只建一个账号/审批审计；无效映射回滚。|
|CMS-01|IMPLEMENTED / VERIFIED|全部/新闻/公告/纪律处罚导航，状态/标题/slug 查询；九种类型状态组合与两页 18 条无重复；既有草稿安全预览与公开边界回归。|
|CMS-02|IMPLEMENTED / VERIFIED|新文章直接上传两份 PDF，暂存 ID，统一保存关系，重开、排序、移除、重新从库选入；正式 PDF 与附件同 ID 去重；真实浏览器旅程与 PDF HTTP 下载。|
|CMS-03、MED-01|IMPLEMENTED / VERIFIED|公开前检查附件/封面/正文的权限及文件可用性；私有不自动转公开，缺失拒绝；分类/搜索/分页及去重引用数；公开引用阻止改私有。|
|REF-01|IMPLEMENTED / VERIFIED|草稿不进入任务，正式发布即出现，撤回消失，重新发布按新版本确认；确认/冲突报告查询与写入在同一事务。|
|REF-02、REF-03|IMPLEMENTED / VERIFIED|未来比赛、未来结束时间、取消比赛拒绝提前完成；开球已过且未完赛仍留正式任务；历史和统计要求真实完赛及成对比分。|
|REF-04|IMPLEMENTED / VERIFIED|比赛写权限只触发该比赛已发布选派的完成，实际 actor 审计；赛事管理员直接发布选派仍 403。|
|STR-01、STR-02|IMPLEMENTED / VERIFIED|阶段/组/轮次/成员归属，跨赛事和跨组拒绝；已被比赛引用的删除与移组受保护。浏览器组/轮次上下文手建及保存继续；复制清空时间终点、比分、报名和选派。历史分类要求原因并保留旧文本、ID、比分、版本。|
|IMP-01|IMPLEMENTED / VERIFIED|CSV、XLSX、粘贴同一 36 场计划，落入 A/B/C/D 和三轮；旧模板回归。|
|IMP-02、IMP-03|IMPLEMENTED / VERIFIED|5 MB/5000 行、时间/队伍/组关系、重复与冲突检查；预览零写入、输入变化清预览、输入与事实计划绑定、事务重检/全批阻止；重复导入新增 0。|
|IMP-04|IMPLEMENTED / VERIFIED|预览显示实际公开影响，提交不改变赛事公开开关；已公开场次可见，未公开仍隐藏。|
|RES-01、RES-02|IMPLEMENTED / VERIFIED|0:0、胜负、点球单独字段；缺失/负数/小数/未来/取消拒绝；更正原因和版本检查，竞争结果一方成功，重复请求只完成一次。|
|TAB-01、TAB-02|IMPLEMENTED / VERIFIED|纯函数及集成按胜3/平1/负0重算 P/W/D/L/GF/GA/GD/PTS；只取有效本组小组赛。人工同分排列不改统计；恢复自动次序及事实改变待复核。|
|QUAL-01|IMPLEMENTED / VERIFIED|真实组内球队去重、人工顺位和原因、提前确认例外；不造占位球队/对阵；赛果更正提示既有半决赛受影响且保留其双方。|
|PUB-01、PUB-02|IMPLEMENTED / VERIFIED|数据库公开资格；先评估所有候选下一场再选最近两赛事，各一摘要；三个额外候选各 40 场的真实 HTTP 验证。|
|PUB-03、PUB-04|IMPLEMENTED / VERIFIED|共享时刻、稳定排序、完赛/取消/改期失效及请求时计算；3.2 秒无写入时钟验证轮换。无未来比赛使用真实空态，不自动结束赛事。|
|PUB-05、PUB-06|IMPLEMENTED / VERIFIED|详情 30 条分页遍历全 36 场；动态跨赛事赛程/积分与详情共用投影，历史独立；取消公开 404/消失，内部资料投影断言。|
|KEEP-01、KEEP-02|KEEP / VERIFIED|独立公开组队目录、便捷建队/批量、Team ID；比赛制式与岗位模板分离，CUSTOM fail-closed，北京时间。既有专项及安全回归。|
|MIG-01|IMPLEMENTED / VERIFIED|空库全链、新基线恢复库升级、重复 deploy no-op、11 类历史实体数量关系、FK/integrity、旧客户端读写。|
|UI-01|IMPLEMENTED / VERIFIED|五种宽度的内容编辑、媒体、赛事工作区、公开附件、赛程、菜单截图及 DOM 宽度；真实 tab 键盘方向/Home/End 与焦点检查。统一人工视觉验收 PENDING。|

## 主要实现位置和取舍

- 导航/审批：`src/lib/admin-navigation.ts`、`referee-admission-service.ts`、统一 Shell 与 admissions 页面。条件更新在事务中抢占 PENDING，失败回滚，不实现重新审批。
- 内容/媒体：`admin-content-input.ts`、`admin-content-service.ts`、`admin-media-service.ts`，`ContentPostForm`、`MediaPicker` 和媒体页。结构化节点解析器识别正文 ID；一次读取引用内容归并使用方式，避免逐资源 N+1。原正式 PDF 不回填、不复制二进制；公共附件位于正文之后。上传暂存清理只处理原有临时文件，修正并发 rename 的 ENOENT，不清理未使用正式媒体。
- 裁判/赛果：`referee-service.ts`、`referee-r1-service.ts`、`referee-public.ts`、`MatchResultForm`、`/api/admin/matches/[id]/result`。赛果、报名关闭、选派派生完成、版本和审计同一事务；普通编辑重读当前记录防止覆盖已确认结果。
- 结构/积分：`competition-structure-service.ts`、`competition-standings.ts`、`CompetitionStructureManager` 和 `/api/admin/competitions/[id]/structure`。可空结构关系兼容旧数据，数据库归属触发器配合服务验证。人工确认保存事实摘要和历史；积分每次从比分重算，不做累加账本。
- 手建/导入：`AdminMatchForm`、`AdminCompetitionWorkspace`、`competition-import-*` 和 import columns/preview/commit API。赛事 URL 保存阶段/组/轮次/页码，导入首屏映射与三个样例、预览每页 30。轮次必须先显式建好，未匹配不静默创建；未分组旧路径的未知球队计划明确显示。
- 公开：`public-competition-service.ts`、`public-competition-revalidation.ts`、`PublicSchedule`、`PublicStandings`、详情与 schedule/standings 页面。首页/目录取摘要字段及一场，详情另取完整赛程；五个相关路径失效。下一次请求按当前时间计算，已打开页面不承诺实时推送；裁判工作区恢复窗口焦点刷新。
- 样式/无障碍：沿用现有 Shell/面板/按钮和蓝色体系，局部 `.ops-*` 样式；窄屏表格自身滚动。导航页签用链接，真实内容面板使用 role/aria-controls/selected/tabIndex 与键盘管理。

## 数据与权限边界

新增 migration `20260928090000_ops_r3_1`；旧 migrations、依赖版本和 lockfile未修改。新增六张关系表及 Match 可空结构、点球和结果版本字段，SQLite Match 必要重建说明与审计步骤见 [migration-and-data.md](migration-and-data.md)。

所有新增 API 校验现有业务权限；媒体可见性是显式操作，赛事结果权限不等于裁判选派权限。没有伪造 SUPER_ADMIN，没有新增角色授权。数据库/文件写入测试均在临时目录；既有本地 dev.db 和生产数据库未迁移。

不实现自动抽签、排赛、球队分组、晋级、下一轮对阵、足球中国同步、消息通知或事件引擎（OUT OF SCOPE）。外部样例与生产历史异常尚未核验，不声称历史个案根因。参考与复用情况见 [references.md](references.md)。

交付停在本地开发分支和本地提交。没有 push、merge main、部署、生产服务重启或生产 migration。统一人工验收请按 [human-acceptance.md](human-acceptance.md) 操作。
