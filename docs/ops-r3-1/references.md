# 外部参考与代码复用

本轮采用任务书第 12 节已描述的设计思路；没有下载、复制或安装这些参考项目的源代码，也没有把外部自动化赛事引擎接入本站。

|参考|借鉴位置|实际采用边界|
|---|---|---|
|[brackets-manager](https://github.com/Drarig29/brackets-manager.js)、[Storage](https://drarig29.github.io/brackets-docs/user-guide/storage/)|阶段/组/轮次/比赛关系|本站 Prisma 最小持久化，人工安排；无抽签/自动赛程。|
|[react-spreadsheet-import](https://github.com/UgnisSoftware/react-spreadsheet-import)|选择输入、对应列、样例、预览、提交|沿用现有 parser、read-excel-file、事务；未引入 Chakra 或新表格库。|
|[Payload](https://github.com/payloadcms/payload)、[Upload](https://payloadcms.com/docs/upload/overview)、[Drafts](https://payloadcms.com/docs/versions/drafts)|媒体关联与草稿/公开权限边界|现有 CMS/TipTap/MediaAsset 上扩展，显式公开，不替换 CMS。|
|[TanStack Table](https://github.com/TanStack/table)、[服务器分页](https://tanstack.com/table/v8/docs/guide/pagination)|查询总数和列表分页口径|原表格、SQL 计数和 URL 筛选，未安装 TanStack。|
|[XState](https://github.com/statelyai/xstate)、[Guards](https://stately.ai/docs/guards)|状态转换前置条件|扩展现有 transition table 与事务验证，未安装 XState。|

这些链接是任务书提供的来源；本轮未重新在线核验其版本或许可证。由于没有复用其代码，不新增相应第三方代码版权文件，也不作未经核验的许可证结论。未来若复制实现须先固定仓库提交/文件并核对许可证和声明。

新增依赖：无。package.json、package-lock.json 和锁定 Next/React/Prisma/TipTap/read-excel-file 版本不变。新增测试 XLSX fixture writer 复用仓库既有 fflate 模式；业务 UI、上传验证、北京时区、授权、日志、迁移和解析均优先复用本站已有实现。
