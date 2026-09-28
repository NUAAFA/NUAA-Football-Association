# OPS-R3.1 实际基线

2026-09-28：工作目录 `/Users/xianghanwang/Documents/Codex/NUAAFA`；初始 git status 干净，分支 main，HEAD `4f594af0dc4f8d8d7e7eff96b0d702d81962e446`，与总任务书一致。开发分支 `codex/ops-r3-1`。Node v24.21.0 / npm 11.19.0。锁定依赖不升级。

已读取根 AGENTS.md，未发现其他目录级 AGENTS.md。已读取安装版 Next.js route handlers、server/client components、revalidation 指引；使用现有 request-time 渲染和 revalidatePath。Prisma 连接由 DATABASE_URL 决定，默认本地 dev.db；本轮所有写入验证显式使用隔离数据库及上传目录，不迁移现有 dev.db。

|能力|决定|本轮差异|
|---|---|---|
|动态公开目录、通用详情、稳定 slug|KEEP|验证公开投影与关闭公开|
|首页两赛事、一赛事一摘要|EXTEND|先求下一场再取两赛事；时间边界和空态|
|playingFormat 与裁判 format 分离、CUSTOM|KEEP|兼容测试|
|独立公开组队目录及便捷建队|KEEP|专项回归|
|导航|FIX|权限过滤后最长段匹配|
|准入审批|FIX|默认待批复、真实计数、分页、并发保护|
|内容/媒体|EXTEND|分类、附件、上传、使用情况|
|选派闭环|FIX|完赛事实、任务生命周期、窄联动|
|阶段/组/轮次|NEW|可空结构引用，不猜测历史文字|
|手建复制/批量导入|EXTEND|上下文、结构、安全校验|
|赛果/积分/人工确认|NEW|共用结果事实，保留人工决定|
|公开赛程积分|EXTEND|动态查询与独立历史入口|
|旧客户端迁移测试|FIX|固定 fixture，保留旧客户端读写断言|

## 最小增量设计

新增阶段、组、轮次、组成员及人工确认记录；Match 保留 stage/round 文字并增加可空关系、点球与结果版本。关联删除使用 Restrict，组成员在同阶段同球队唯一；所有跨赛事及小组归属由事务服务校验。人工确认保存事实摘要和历史记录，事实改变即不再生效。内容附件 join 表只存媒体 ID、显示名、顺序和创建信息，原 PDF 关系保留，读取时按媒体 ID 去重。新增 migration，旧 migration 不改。

以上为源码复核和设计，运行时证据见 test-report.md，不代表已通过测试。
