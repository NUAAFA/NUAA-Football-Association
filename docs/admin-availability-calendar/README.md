# 后台可执裁时间详情月历

本地分支：`feat/admin-availability-calendar`。基线：`f7a5460713b3886130910d28b24f9f9c8cab9b7b`。本次未推送、合并或部署，没有修改线上数据。

“查看详情”打开月历，沿用裁判中心的日历样式和后台原有弹窗。绿色表示全天可执裁，红色表示全天不可执裁，蓝色表示部分时段或混合安排，未设置保留为独立状态。点击日期集中显示该日全部时段、比赛制式和说明，并保留原有删除操作。支持前后月份、月份跳转和回到本月。

日期和时间固定按 Asia/Shanghai 计算，不依赖管理员电脑时区。跨天记录按实际重叠日期显示，午夜结束不延伸到次日。详情读取整个可见的 42 天区间，不受旧详情每页 20 条限制；列表筛选只决定入口与初始日期，不会隐藏月历中其他日期或另一种状态。读取中和读取失败时不把未知日期显示成“未设置”。

月历读取复用 `/api/referees/admin/availability/[id]?month=YYYY-MM`，沿用 `referees:read` 授权。原有详情分页接口和删除接口保持兼容；不修改数据库结构、排班判断、裁判本人填写流程或依赖版本。

验证使用 Node v22.23.2、Next.js 16.3.8、全新迁移的临时 SQLite 数据库和临时验收账号。所有结果通过：

- `npm run test:admin-availability-calendar`：超过 20 条、混合状态、北京时间、跨天/午夜边界、闰年、裁判隔离、归档/不存在裁判及安全 DTO。
- `npm run test:admin-availability-calendar:browser`：月历 GET 的 401/403/400/404、无需 Origin 的已授权读取、旧分页兼容、日期选择、月份切换、失败重试、删除刷新、Escape 与焦点恢复。
- 浏览器时区 Europe/London；1440×900、1024×768、390×700、360×700 无横向溢出或弹窗越界，无浏览器运行时错误。
- `npm run build`、`tsc --noEmit`、`npm run lint`、`npm run check:unicode` 和 `git diff --check`。

截图和结果位于 `evidence/`，均为隔离测试数据。浏览器测试仅将临时账号的 Secure 会话 Cookie 和写请求 Origin 适配到隔离的 HTTP 回环服务器，应用认证代码未改动。

重跑浏览器验证：先运行数据测试，使用输出的 `ISOLATED_FIXTURE` 设置 `CALENDAR_FIXTURE_ROOT`；完成构建后运行浏览器测试。若 Playwright 不在模块搜索路径中，用 `PLAYWRIGHT_MODULE` 指向已安装的 `playwright/index.mjs`。
