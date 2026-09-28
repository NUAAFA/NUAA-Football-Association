# OPS-R3.1 迁移与历史数据说明

状态：隔离迁移 VERIFIED；现有开发库/生产库 migration NOT RUN；生产异常修复 NOT RUN。

## 增量结构

新增 `prisma/migrations/20260928090000_ops_r3_1/migration.sql`。原有 13 个 migration 完整保留；新增为第 14 个。

新增 `CompetitionStage`、`CompetitionGroup`、`CompetitionRound`、`TeamGroupMembership`、`GroupConfirmation`、`ContentAttachment` 六表。组成员同阶段同球队唯一；轮次的组内/无组名字有部分唯一索引。关系使用 Restrict 保护已被引用的赛程/组/媒体；删除一篇内容时只级联其附件关系，不删除 MediaAsset。

Match 增加可空 stageId/groupId/roundId、可空双方点球、resultVersion（默认0）和 resultConfirmedAt。保留旧 stage/round 文本、比分、ID/slug、报名与其他旧字段。SQLite 为加正式外键必须重建 Match：复制全部旧列，恢复原索引，加新索引及结构归属触发器。migration 并不推断旧分组、补赛果、改选派、转换媒体权限或生成业务记录。

服务和数据库共同防止跨赛事阶段、不同组轮次、组内非成员和同队对赛；已引用组成员不得直接移除。普通比赛修改仍受事务验证和既有约束。

## 已执行证据

`scripts/test-ops-r3-1.ts` 实际用锁定 Prisma CLI migrate deploy 在临时目录先部署固定基线 13 migrations，植入代表性历史关系，再升级新增 migration，并再次 deploy 检查 no-op。`ops-integration.json` 保存前后数量：Competition1、Team2、Match1、MediaAsset1、ContentPost1、DisciplineDetail1、Referee1、RefereeAppointment1、AppointmentVersion1、AppointmentPosition1、AuditLog1 全部相同；旧阶段/轮次文字保留，foreign_key_check 0 行、integrity_check ok。

空库全链迁移、其他既有迁移脚本和 pre-R3/pre-team-directory 旧客户端读写也实际运行。fixtures 来源见 `scripts/fixtures/README.md`。证据针对合成恢复库，未对真实生产备份运行恢复演练，不以此宣称生产已迁移成功。

## 未来迁移和回滚边界（说明，未执行）

任何真实部署前须先人工验收和授权，确认目标 DATABASE_URL/上传目录、冻结写入并备份数据库及文件。先在备份副本运行完整 migrate deploy，比较上述实体数量、关联、索引、外键、完整性及公开文件读取，再决定生产执行窗口。不要用 db push 代替已交付 migration，不编辑旧 migration 来消除错误。

该迁移没有自动 down。新版本产生结构/附件/人工确认/结果版本后，直接退 schema 或删新表会丢失新事实；旧应用写入还可能破坏新约束。需要回滚时停止业务写入，人工评估新数据导出和完整备份恢复，数据库与应用/上传文件一同恢复到一致时点。不得将“旧客户端还能读写”当作生产降级许可。

## 历史异常的只读检查与人工修复

`python3 scripts/audit-ops-r3-1.py <显式SQLite路径>` 使用 mode=ro / query_only，仅输出安全 ID、状态、比分、版本和旧文本，不读取账号资料、不写入。它检查完成选派缺完赛事实、发布版本不匹配、未结构化比赛及正式 PDF 断关系。支持 SQLite 毫秒数和 ISO 日期。只读测试还核对调用前后数据库字节不变。该工具不扫描真实文件内容；文件存在/权限由媒体列表和发布校验核对。

本轮运行对象仅隔离验收库，结果在 `evidence/read-only-audit.json`；其中旧种子未结构化和历史不一致条目属于合成测试，不是生产诊断。真实环境 NOT RUN。

发现“未来 COMPLETED”或版本异常时，先人工核对 Match 时间/状态/比分、Appointment 当前岗位/版本、实际变更日志和确认记录，确定是否录错时间、比赛事实还是状态转换。列出单条前后方案、角色与影响，备份后取得明确修复授权，再通过受控事务保留审计。不能按一个按钮名称断言旧个案误操作，也不能批量把 COMPLETED 改回 PUBLISHED。

历史阶段/分组文字不自动映射，不提供模糊同名回填。先使用只读列表逐条确认赛事、正式阶段/组、真实成员与轮次；历史已完赛比赛分类时必须输入原因并确认积分影响，保留 ID、旧文本、比分和选派历史。受已有比赛保护的改组/删除会被拒绝，需要另立明确的数据整理方案。重复只读检查无写入；已经分类的比赛不再列为未结构化。

旧正式 PDF 无需回填到附件 join，公共读取合并并按媒体 ID 去重，历史正文引用仍用原结构化节点解析。无需新增引用索引回填。缺文件不假装修复，公开提交会阻止并要求人工从合法源恢复或明确替换。
