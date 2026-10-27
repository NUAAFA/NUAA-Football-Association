# M06 维护契约预检候选

本目录不替换现有部署器、启动器、systemd 或数据库。代码合并也不会安装本工具。
`contract-preflight.py` 只读取批准文件、元数据、摘要、迁移账本和服务身份，并调用
已经独立批准且摘要匹配的 helper 的 `verify`、`runtime-ready` 两个只读模式。
它不会生成批准、安装依赖、解压制品、执行迁移、控制服务、远端 fetch 或读取环境密钥。

## 使用边界

生产使用前，由批准人单独核定本工具和计划文件的精确摘要、安装位置及执行范围。
运行者不得自行填写 `human_review=APPROVED` 来代替人工批准。默认生产模式要求
计划、程序及其所有祖先目录为 root 所有、无组/其他用户写权限、非符号链接；
计划内的数据库路径只允许精确的 `shared/prisma/dev.db`，数据库通过 SQLite
`mode=ro`、`query_only` 和事务读取，不导出业务表。

示例只表示接口，文件必须事先经过独立审批；当前仓库没有可直接使用的生产批准文件：

~~~console
python3 -I -B /approved/path/contract-preflight.py --approval-plan /approved/root-owned/m06-plan.json
~~~

退出0仅表示本工具列出的只读检查通过。JSON 始终包含
`production_authorization=false`，不授予发布或回退权限。
退出1表示证据缺失、身份不同或环境无法验证；输出固定检查代号，不输出内部错误、
命令 stderr、数据库路径或配置正文。**不得清除锁文件、修改批准或忽略错误继续发布。**

`--synthetic-root` 是显式同用户夹具模式，输出 `mode=SYNTHETIC`，仅供测试。
其路径不得指向 `/srv/nuaafa`、`/opt/nuaafa`、`/etc/nuaafa`。该模式不能证明 root
权限、实际 systemd 运行或生产安装成功。

## 批准计划的必填项

计划采用严格 JSON，拒绝重复和未知键。不得放入密码、Token、收件地址或个人信息。
程序会在读取前拒绝.env*、.ssh及私钥路径，也不允许把SQLite误填为JSON元数据或程序。
普通JSON计划/配置上限4MiB；只有包含全源码/native清单的密封receipt允许16MiB。
这是有界解析预算，不放宽任何身份、结构、哈希或独立helper检查。

| 字段 | 要求 |
| --- | --- |
| `format` / `purpose` | 整数1 / `M06_READONLY_PREFLIGHT` |
| `approval_id` / `expires_at` | 可追踪批准编号、带时区到期时间；有效余期最多24小时 |
| `commit` / `tree` / `allowed_ref` | 精确40位 SHA、完整 Git tree 和获批分支引用 |
| `artifact_sha256` | 从可信 CI 身份独立取得的64位制品摘要；不得只相信制品旁的 sidecar |
| `lock_sha256` / `schema_sha256` | 精确锁文件及 schema 摘要 |
| `migration_inventory` | 按名称排序的21个不可变迁移及各自 SHA-256 |
| `paths` | `current,releases,shared,database,contracts,receipt,activation,deployment_lock,import_approval` 的绝对路径 |
| `programs` | `node,helper,start,wrapper,deployer` 各自的 `path` 和 `sha256` |
| `contract_sha256` | root控制的实际 contracts.json 摘要 |
| `service_name` / `application_user` / `application_group` | `nuaafa.service`及批准的低权限服务身份 |
| `build_id` | 精确 Next BUILD_ID |
| `human_review` / `security_gate` / `linux_validation` | `APPROVED` / `PASS` / `PASS`，必须有外部审查证据支持 |

检查将合同中的每版本制品摘要、Node/helper/start路径及摘要，与计划及实际文件进行交叉核对。
激活状态必须为当前 SHA 的 `HEALTHY`；`MIGRATING`、`MANUAL_REQUIRED`、未知状态和
`previous` 均不能变成隐含回退许可。部署锁只以已存在文件的共享非阻塞锁检查，不创建锁文件。
锁忙即停止，不等待、不删除、不绕过。

服务必须有唯一 ExecStart，使用批准的 wrapper、工作目录和低权限账号；
`SendSIGKILL=no`、`TimeoutStopUSec=infinity`、`KillMode=control-group` 必须成立。
生产模式额外核对实际 MainPID 的 cwd 和 Node 可执行文件。

本工具不枚举所有进程的数据库描述符，不能单凭其 PASS 断言没有其他数据库写入者。
正式发布仍需在批准操作窗口内，独立核对活动维护进程、数据库写入者和停服后的旧 cgroup/PID
已退出，才能允许新实例启动。预检与正式操作之间如有身份或配置变化，原结果失效。

## 隔离验收

~~~console
python3 -I -B scripts/test-maintenance-contract.py
~~~

这会创建虚构 SQLite，实际应用本仓库21项迁移；核对只读及重复运行、摘要/权限/链接、
迁移、锁、服务和隐私负例。服务/helper调用使用明确适配器，不能称为真实 Linux 服务验收。

全新、一次性的 Ubuntu24.04 x64 / Node22.23.4 / root测试机可运行：

~~~console
sudo env "PATH=$PATH" python3 -I -B ops/maintenance/run-linux-rehearsal.py --confirm-disposable
~~~

驱动拒绝任何已存在（包括断开的符号链接）`/srv/nuaafa`、`/etc/nuaafa`、`/opt/nuaafa` 的主机。
既有startup套件使用`/var/lib`可信夹具父目录和真正非root的`SUDO_USER`；无该身份时必须以
`--application-user`指定已有的一次性CI应用账号，否则NOT RUN，不能把root当应用用户。
Checkout必须保留完整Git历史，供既有套件读取真实旧迁移。驱动依次运行新契约测试及
既有启动、恢复判定、制品和真实root权限测试。它不安装持久服务。
现有完整CI的 trusted Linux prebuilt Job还必须对**同一个构建制品**完成精确摘要、导入两次、
非特权Next冷启动和原生临时systemd运行/自然停止；该部分不能用驱动的无制品测试替代。
任何真实生产备份恢复仍属于M04单独审批，不在这里执行。
