# 赛事中心与裁判公开列表优化验收 · 2026-10-23

基线：`origin/main` / `5c86ad7c042efcac0256f20caa8644999ae37f34`。分支：`codex/competition-presentation`。

最终行为：

- 赛事头图保留原来的左侧大标题、右侧摘要卡和背景图样式；二级栏目导航居中。
- 校区、场地、主办及承办单位支持后台逐行填写和公开页逐行展示，兼容现有顿号、分号分隔资料；保留括号内的备用场地。没有数据库结构迁移。
- 赛事卡片使用两项简要资料、整行比赛日期、独立下一场安排，消除空白网格单元。
- 详情页赛程标题右侧不再显示重复的“下一场”文字。筛选默认收起，融入场次信息栏，点击后展开；第一眼可直接看到比赛、开赛时间、对阵和场地。
- 赛程仍默认三场，点击展示更多后每页六场。即将进行的已定时间比赛优先，待排期靠后；保留条件筛选、翻页、收起、比赛直达和无 JavaScript 的原生链接浏览。
- 积分榜直接展示完整分组榜单，增加排名和醒目的积分列，采用小组切换和内嵌搜索；保持原始排名数据、同分暂列、人工出线确认及待复核语义，小屏可在榜单内横向查看。
- 赛事详情中的选派仍默认近期三场，展示阶段、小组、轮次、开赛日期及时间、场地与状态，全部公开记录可展开后按六场翻页。
- 裁判选派公告和公开报名场次按实际赛事分类，可分别查看新生杯、男子五人制、女子联赛等。分类以赛事 ID 区分，同为五人制的赛事不会合并。记录按开赛时间升序、ID 确定同一时间的次序，不再按公告发布时间排序。
- 两类裁判列表均默认三场；点击继续浏览仅展开当前分类的全部记录，切换分类重新从三场开始。刷新保留分类和展开状态，无 JavaScript 时可使用原生表单及链接。原有公开条件、报名期限和账号权限保留。

| 验证 | 结果 |
| --- | --- |
| 最终构建（Next.js 16.4.1，含 TypeScript） | PASS |
| 修改文件 ESLint / git diff --check | PASS |
| 多行字段、时间优先级、分类解析、不同赛事计数测试 | PASS |
| Chrome / WebKit 各 320、390、768、1024、1440、1920 像素宽度 | PASS |
| 原版左右头图、默认收起筛选、移除重复下一场文字 | PASS |
| 20 场赛程：初始三场、六场分页、完整性及无重复、筛选与比赛直达 | PASS |
| A / B 组积分榜：直接显示、切换、搜索、保留完整排名上下文 | PASS |
| 手机积分列：标题与数值同步固定在右侧，390 × 844 复核右边界均为 373px | PASS |
| 18 场选派与 16 场报名场次：分类、顺序、默认三场、展开、刷新及空分类 | PASS |
| 两种五人制赛事分别筛选，未混入其他赛事 | PASS |
| 原有 13 场公开选派展开、完成状态与草稿隔离 | PASS |
| 后台四项分行资料保存、重新打开、前台显示及手机宽度无溢出 | PASS |
| 禁用 JavaScript 的赛程展开、裁判分类与展开 | PASS |
| 真实手机、原生 Safari、生产环境验收 | NOT RUN |
| 推送、PR、合并、部署 | NOT RUN |

WebKit 备注：仍有 `/media`、`/association`、`/participation` 的既有 RSC 预加载 access-control 诊断。脚本验证对应直接页面均 HTTP 200，其余页面异常仍使测试失败；自动化 WebKit 不等同于原生 Safari 实机验收。

所有验证写入均发生在新建临时数据库。正式构建的后台浏览器测试仅在本地请求代理中提供受信 Origin、在测试浏览器上下文安装本地会话 Cookie，应用的来源校验、Secure Cookie 和权限配置没有改变。

本地预览（模拟数据）：

- 赛事详情：http://127.0.0.1:3138/competitions/presentation-cup
- 选派公告：http://127.0.0.1:3138/referees/assignments
- 公开场次：http://127.0.0.1:3138/referees/open-matches

证据目录：`/Users/xianghanwang/Documents/Codex/2026-10-23/competition-presentation/acceptance-round2-an6ugteo`

结构化结果：`/Users/xianghanwang/Documents/Codex/2026-10-23/competition-presentation/acceptance-round2-an6ugteo/results.json`

主要截图：`round2-hero.png`、`round2-schedule.png`、`round2-standings.png`、`round2-assignments.png`、`round2-women-assignments.png`、`round2-open-matches.png`，以及手机宽度截图；最终积分列复核图为 `round2-mobile-standings.jpg`。

复现：运行 `npm run test:competition-presentation -- --prepare --with-referee-lists` 创建全新临时数据；使用输出目录启动隔离预览；以 `COMPETITION_PREVIEW_URL` 和 `PLAYWRIGHT_MODULE` 指定本地地址及已安装的 Playwright 包路径，运行 `npm run test:competition-presentation:browser -- <临时目录>`。开发模式另需设置 `COMPETITION_MUTATION_ORIGIN` 为本地预览 Origin；正式构建默认使用应用受信 Origin。浏览器验收会修改临时数据库，重复完整验收时应创建新目录。
