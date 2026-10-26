# NUAAFA R1/R2 定向补修 2026-10-24

本轮在候选 `3d216472f3b9ba7401d1881edc4292e563880b2d` 上增量修复两项复核意见，不重做整轮审计。原 8 个提交保留，原交付 ZIP 不变。分支为 `codex/audit-targeted-followup-20261024`。

## R1 静态历史日期

`staticContentPublishedAt` 支持 YYYY-MM-DD、YYYY.MM.DD 及日期加 HH:mm[:ss]；日期标签按北京时间解释，纯日期维持中午约定。非法日历日期、非法时间和无时区的显式 publishedAt 返回 null。新闻详情正文与 metadata 复用同一转换函数。

原女足历史资料不改写：`2026-06-22 16:53` 得到 `2026-06-22T08:53:00.000Z`。独立列出的完整 12 篇历史集合与新闻列表、sitemap、RSS 一致，全部详情 HTTP 200，发布时间 metadata 正确。confirmed、未来时间、演示内容、URL 去重和数据库模式不静态回退仍受保护。该缺陷限定于静态模式，不据此断言生产曾出现 404。

## R2 持续挂载组件状态

报告回执、读回接口、工作区均投影同一份有限字段快照：id、reportedAt、resolvedAt、status、reasonCode、explanation。用报告身份、报告时间和内容区分报告代次，同代的新服务端处理结果消解旧本地 PENDING；旧 RESOLVED 不能覆盖新报告。任务版本隔离继续有效。不增加 schema、迁移或全局状态平台。

真实 Chrome 在全新合成 SQLite、虚构裁判和管理员会话中完成：本人提交 A → 管理员真实 PATCH 处理 → focus 触发 router.refresh → 原组件按钮恢复 → 提交 B → 旧 RESOLVED props 不解锁新 PENDING → 再次处理后恢复。同内容的已处理报告重复 POST 不重新待处理。全程仅一次 document 请求，DOM 哨兵、本地消息与 React hook queue 保留；测试读取已提交 React 树，仅测试依赖 React 内部结构。

POST 仅增加本人报告快照并设 private, no-store；未返回内部处理说明或管理员身份。匿名 401、跨来源 403、旧任务版本 409、其他裁判 409 的真实 HTTP 探针均通过。

## 验证与限制

受测代码提交 `3add6e1b7b9711962701aebb0f9471051a97ca13`。macOS arm64，Node 22.23.4、Next 16.4.1、Prisma 7.9.1、Chrome 155.0.8059.85。构建、类型、字符安全、三时区日期/状态用例、7 组公开内容、31 组网络恢复和 6 组请求 helper 均 PASS。lint 为 0 error，保留既有 combined-backup.ts 未使用 rm 警告。

独立子代理仅读取本轮 13 路径差异和证据，并独立执行 11 个函数案例，未发现新增阻断问题。代码包另提供逐项矩阵、完整报告、旧证据快照、补丁/bundle 与受测文件哈希。最后仅文档提交的业务与测试文件应与受测提交逐项相同。

早期测试等待 RSC 流结束导致测试超时，改为观察已提交 props 后通过；公开内容首次因未安装默认浏览器失败，指定本机 Chrome 重跑通过。失败记录保留，均不充当产品验收成功证据。

完整 Linux 应用、真实手机、原生 Safari、生产压测 NOT RUN；当前生产身份、备份、恢复和告警送达 UNKNOWN。原有 V2.10.1 等历史上线状态继续继承，本轮没有重新核验或改变。未推送、触发远端 CI、创建 PR、合并、部署、写真实数据或发送通知。可进入后续集成与 Linux 验证，不构成生产上线证明。
