# pre-R3-schema.prisma

来源：仓库提交 `5376d6bb47a1b68fe256bb16d41b8907262dcabd` 的 `prisma/schema.prisma`（动态赛事 R3 migration 之前）。完整原文，供旧客户端升级后读写测试；无需网络或 Git 历史即可运行。边界：旧 ELEVEN_A_SIDE/FUTSAL 数据；不承诺旧客户端认识 CUSTOM。不随当前 HEAD 改写此 fixture。

`pre-team-directory-schema.prisma` 来源：`e3893fe` 的完整 schema（公开组队目录前）；R1/R1.1 迁移及旧客户端验证复用。

`ops-r3-1-baseline-schema.prisma` 来源：`4f594af0dc4f8d8d7e7eff96b0d702d81962e446` 的完整 schema；OPS 升级数据库验证在此基线植入代表性历史关系，再执行新增 migration。
