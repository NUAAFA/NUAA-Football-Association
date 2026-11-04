# M06 当前发布维护契约与交接补充

记录日期：2026-10-27。当前只读核验窗口及精确退出状态以交付包中的
`evidence/maintenance-contract.json` 为准；以下为快照，下一次操作前必须重新读取。
本文件不构成生产安装、部署、回退或数据复制授权。

## 已核实的运行链

生产应用 SHA `7f90d4714756f792b312a766985dfe2094fdd71d`，main
`19d1687658a97b8b40adf2ae3b14e4b21d7f3fbb`；完整 tree均为
`55217139183919a0d95c873d6cf101243851c973`。Node22.23.4、Next16.4.1、Prisma7.9.1、21项迁移。

| 对象 | 实际契约 |
| --- | --- |
| current | `/srv/nuaafa/current`直连`/srv/nuaafa/releases/<SHA>` |
| systemd ExecStart | `/usr/local/lib/nuaafa/start-transition`，User/Group为`nuaafa` |
| 服务停止 | `KillMode=control-group`、`SendSIGKILL=no`、`TimeoutStopUSec=infinity` |
| 合同入口 | `/opt/nuaafa/security-transition/contracts.json`，root控制 |
| 合同摘要 | `c63756fdcd0f67578619d38cae6742aa2ab371bdc09db1cd710129a41df79b64` |
| wrapper摘要 | `ecbb60be45e184aab6026ef570ec873f25998199a616289de7b0d9979ef038d8` |
| 当前Node | `/opt/nuaafa/security-transition/6db56b94c25ca3ce1376dabbda74714448decf53/node` |
| Node摘要 | `94efd062ed066c1a0b332e18249859c905e920eeada5df55d24c99b919629a90` |
| 当前helper | `/opt/nuaafa/security-transition/7f90d4714756f792b312a766985dfe2094fdd71d/prebuilt-artifact.py` |
| helper摘要 | `960f0e793a6dc8f8a8a5164b916994d55da7d8541c069edf44050f5a5ac12bd7` |
| 当前start摘要 | `4317c46fcd8011e0beba81028c755c53e1ac4ace68b3b2f1868a108f09d51d17` |
| 版本合同制品摘要 | `3f5a324b4d71dcb11598c0c11da9fe65610957a5c845f700bd92e4a06cd1ba63`；本轮未重新下载制品，不把合同标签代替制品字节复核 |
| 激活记录 | `/srv/nuaafa/prebuilt-activation.json`，当前`HEALTHY`；previous只作历史线索 |

root控制的版本合同先选择该SHA对应的Node/helper/start及摘要，再验证实际运行条件。
Node可复用先前版本目录内经摘要固定的二进制，不能仅凭目录名判断Node版本。
额外环境变量、服务drop-in、应用可写程序及不同启动入口均须停在审查关口。

## 部署器与旧文档的差异

实际 `/usr/local/sbin/nuaafa-deploy` 摘要为
`c634f497132411354dda9516cc347040b87044118649172d62512faf9e209d04`；
main中的`ops/deploy/nuaafa-deploy`摘要为
`a4bb258a94eca12175715826efcaaeb1df9fd8a0dc3c6443c4ac33c52752c34e`。
二者不同，仓库默认`start-prebuilt`也不同于生产按版本选择的启动器。

因此不能把旧README中的命令复制为下一次生产发布命令，也不能为使文档一致而更换生产文件。
本轮新增只读契约工具；现有部署器、helper、启动器和应用代码未被此工作包修改。
下一次发布批准必须指定实际执行的部署器/入口、Python/Node/helper/start摘要、引用、制品和审批文件，
并先在私有合成Linux环境按同一契约演练。缺少其中任何身份，发布准入为NO-GO。

## 正式发布前的停止条件

1. 批准人分别批准代码、工具安装和生产实施，技术维护人核对批准编号；业务管理员不能据后台权限推断服务器发布权。
2. 将源码SHA/tree、锁文件、完整CI、独立制品摘要及制品字节绑定；确认main与候选没有漂移。
3. 只读检查服务器、进程cwd/exe、BUILD_ID、有效systemd属性、版本合同、激活记录、既有部署锁和异常收据。
4. 确认当前数据库及上传集合的完整联合备份、独立副本、可恢复性和容量峰值；M02–M04未满足批准要求时停止。
5. 核对精确21项迁移清单、每项校验和、账本顺序、schema和运行版本。不运行旧17/18迁移工具处理21迁移数据。
6. 核对数据库写入者，确认无其他导入、备份恢复或维护写入，禁止两个服务同时写同一数据库。
7. 发布工具导入只可处理全新目标；碰撞、孤儿收据、非终态激活和锁忙均保留原现场并停止。
8. 正式迁移、停止、激活、恢复都必须由经过独立批准的版本工具完成，不在浏览器或终端临时拼接替代逻辑。
9. 若服务自然停止未结束，不通过kill -9、临时启用SendSIGKILL或缩短超时跳过保护。保持原证据，重新审查活动事务和进程后申请处理方案。
10. 新服务只能在旧PID/cgroup和监听已退出后启动；通过MainPID、cwd、exe、健康JSON和数据库状态验收。

## 故障与回退

`MIGRATING`或`MANUAL_REQUIRED`表示需要人工处理，不能清除日志、激活记录或锁inode再重试。
失败后先保存脱敏的阶段、命令退出码和身份；不得自动连续推送或重试生产发布。
`previous=1737b2a48cc0ac9eccc227d5a86fc929943c8850`不是回退批准；回退前仍需证明代码、迁移、
schema、业务历史、上传引用、构建及root合同兼容。没有自动down migration。

排名/出线确认已经使用`v2:`指纹。旧代码不理解v2，不能直接退回并认为人工确认仍有效；
不得批量删除确认或把无法证明的旧记录宣布有效。需要兼容代码或经逐条核对、单独批准的恢复方案。
裁判正式任务版本、原审核时间/人及C01–C03历史也必须保留。

## 管理员交接附页

- 业务管理员：维护已授权后台业务；不能修改历史审核意图、服务器配置或用真实数据测试。
- 技术维护人：按批准的只读巡检检查网站、版本、容量、22项监控、备份尝试和最近成功时间、迁移及合同。
- 生产批准人：确认操作范围、备份/恢复证据、消息接收方、容量政策、维护窗口和失败停止条件。
- 告警渠道、负责人、密钥保管、独立备份目标、真实恢复环境及保留政策均在M01–M04集中审批中单列。
  未批准字段保留`UNKNOWN`或`NOT RUN`，不得在手册中填写猜测值。
- C01保留原报名和补录历史；C02与C03分别`NEEDS MANUAL REVIEW`，纸面证明或原管理员确认由业务负责人提供。
- 接手者先在无真实资料的环境完成只读巡检练习，确认知道何时停止。账号/主机权限移交和本人签收仍须实际完成后记录。

## 独立Linux证据的解释

新工具的同用户文件/SQLite测试、既有决策模拟、真实root权限/导入、真实制品冷启动和原生systemd测试是不同证据。
完整CI应保留各测试命令及结果。原有trusted prebuilt Job的同制品导入两次、自然停止和下一代进程启动
用于证明合成环境中的旧新实例没有重叠；这不是对生产全进程写入者的长期证明。
本轮不创建生产制品Release、不安装维护候选、不重新部署官网，也不声称已完成真实数据恢复。
