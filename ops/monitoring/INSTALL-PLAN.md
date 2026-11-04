# M01 精确候选安装计划 — 未执行、待集中审批

本文不是安装授权。实际安装须重绑当前生产SHA、代码/配置/工具摘要、批准编号、时间窗、
接收人身份和凭据负责人。不得直接运行旧README命令，不重启应用或访问业务数据库。

## 身份及对象

| 对象 | 候选归属与权限 | 用途 |
|---|---|---|
| collector服务 | root UID，但仅CAP_DAC_READ_SEARCH、NoNewPrivileges=yes；主组`nuaafa-monitor-readers` | 固定源读取，无网络/通知凭据可见性 |
| `nuaafa-ops-notify` | 专用非root无登录UID/主组；补充组`nuaafa-monitor-readers` | 只读handoff与专用凭据 |
| `/usr/local/lib/nuaafa-monitoring/` | root:root 0755，不可由以上两UID修改 | 已批准精确摘要的Python代码 |
| `nuaafa_monitoring.py` | root:root 0755 | 完整运行链及内部固定源读取函数 |
| `readonly-inputs.py` | 可选诊断候选，若批准安装则root:root 0755 | 非主链必装项，无服务/sudo调用 |
| `/var/lib/nuaafa-ops-collect/` | root:reader-group 0700 | 私有SQLite、锁、事件与游标 |
| `/var/lib/nuaafa-monitor-handoff/` | root:reader-group 0750 | 白名单事件和活跃快照 |
| `events.jsonl`、`latest.json` | root:reader-group 0640 | sender不能写；首次由collector创建 |
| `/var/lib/nuaafa-ops-notify/` | sender:sender 0700，内部0600 | 独立发送状态，不是业务DB |
| `/etc/nuaafa-monitoring/` | root:root 0700 | 专用SMTP配置/secret各0600 |
| systemd credential目录 | systemd按service隔离、只读私密 | 仅sender读取专用配置与密码 |

不加入`adm`或`systemd-journal`广域组，不授予原应用.env/db读取权。
原monitor的600快照会原子替换；**不以一次文件ACL作为持续访问方案**。root输入桥只接受
`--source monitor/access/journal`和有界数字/指纹游标，不接受任意路径、unit、环境文件或命令。
桥只做固定源只读操作，原文不输出。最终collector在受限root服务内直接调用固定读取函数，
没有sudo规则或提权链；前期sudo设计已废弃，不可安装。sender无sudo、无原日志和业务资料权限。

## 批准的精确配置清单

1. 批准一个专用非root sender UID及read-only共享组，逐一排除身份冲突；collector明确使用
   root但只有CAP_DAC_READ_SEARCH，不能将示例改为完整root能力或增加任意命令。
2. 核对全部代码摘要与root祖先权限；安装到上述新目录，不覆盖原监控8个程序。
3. 核对固定原事件/快照路径、实际journal unit。根桥禁止自由文件、unit和命令参数。
   对受限root collector的真实systemd正例核对内核NoNewPrivs=1、CapEff/CapBnd仅bit2，
   对sender核对不能读原始源、不能写handoff；不得新增sudoers来绕过sandbox。
4. 本轮上下文复核确认`access_log off;`仅属于隐藏文件拒绝location，正常HTTP/HTTPS继承
   `/var/log/nginx/access.log`。候选固定读现有combined源，仅持久时间/状态计数，隐藏拒绝请求
   不在日志分母内；当前单一enabled配置，未来新增站点须重新审查共享日志归属。
   可选`$msec $status`最小日志优化不是本轮安装前置；若未来改用新路径，配置修改、
   `nginx -t`及reload均须独立批准。先前“整站关闭日志”的directive-only判断已更正并保留证据。
5. 明确批准监控时间窗、请求/错误/比例门槛、3坏/2好、周期、handoff预算、64MiB
   collector预算与5GiB空间下限；示例20请求/5错误/5%不是既成生产政策。
6. 明确批准SMTP relay、单一接收人、负责人、专用凭据、测试数量/内容/时间；真实地址和密钥
   不写Git或交付包。生产SMTP配置必须单独审核后enabled=true，不能改示例占位值直接发信。
7. 审阅两个oneshot服务及timer。collector有PrivateNetwork、NoNewPrivileges、完整Protect*
   及仅DAC_READ_SEARCH，业务/SMTP路径不可见，不存在sudo规则或提权链；
   sender有NoNewPrivileges与业务/原日志路径隔离，只读handoff、私有outbox和systemd credentials。
8. 独立观察collector/sender unit结果、最后完成时间和数字健康；为同机故障准备独立主机HTTPS
   探测及不同故障域的通知链，渠道/执行主机另行批准。不能把原22项PASS当此监测已安装。

## 实施与验收顺序（仅获批后）

1. M02容量门禁通过；备份及独立恢复证据按总任务书先行。确认没有未批准写入者。
2. 安装精确代码、专用目录、身份和能力边界，先运行禁用传输的collector与sender消费链；不安装sudoers。
3. 先核验固定输入、初始活跃故障bootstrap、handoff模式和独立UID隔离，原22监控无退化。
   sender每次consume核对collector提供的采集时间，缺失/过期/不完整输入持久3坏2好生成
   关联采集链故障/恢复事件；消费异常不能阻挡后续发送自身故障通知。600秒只是待批示例门槛。
   原monitor自身utc也须新鲜，候选源预算900秒；缺失、未来或过期则collector失败，
   不刷新handoff采集时间，避免旧healthy状态被新封套洗新。两级预算须在安装前明确批准。
4. 核对现有combined源的格式、归属与轮转；不能因可选最小日志未获批而把现有源误判关闭。
5. 批准配置后仅向获批接收人发送约定数量的标记故障、恢复和一次已知未接受重试消息。
   不停站、不破坏DB、不制造真实业务异常。核对event ID、传输回执及接收方确认。
6. 验证不确定发送进入UNKNOWN_DELIVERY并停止自动重发，达到空间预算不删除既有队列。
   独立观察者识别失败/积压；记录测试结束状态与未消费事件，不能删除outbox强制重发。
7. 绑定最终文件/units/源配置摘要、身份、PID、网站健康、迁移与数据保护摘要。

## 失败与回退边界

配置/权限/输入缺失或预算不足即停止启用通知；保留现有网站和原22项监控。只停止/撤销本次
明确批准安装的候选timer/oneshot/配置，不停止网站、不清理原事件/有效备份，不删除未确认
投递队列。Nginx变更若需撤回，使用批准前精确配置及重新`nginx -t`/reload的独立授权；
未授权不得自动恢复配置。生产配置回退不是应用代码或数据库回退。

审批前所有这些动作均NOT RUN。候选双UID、fsync/崩溃/截断回放、回环SMTP和真实临时
systemd测试只证明隔离工程，不能证明已生产安装或真实送达。
