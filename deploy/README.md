# 生产部署接线与验收边界

本目录提供配置检查、容器启动和 HTTPS 反向代理。微信认证、会话、生产数据隔离及数据库迁移属于服务端功能，必须按上线检查逐项验收。填写凭据或健康检查通过不代表真实业务已验收。其他服务商的实现和配置以服务端接口文档为准，未实现或未配置的能力不能视为可用，也不能用服务商名称开关伪装成功。

## 配置与启动

需要支持 Linux 容器的 Docker 和支持 `up --wait` 的 Compose。复制本目录 `.env.production.example` 为 `.env.production`，填写两端 `WECHAT_OWNER_APPID/SECRET`、`WECHAT_AGENT_APPID/SECRET`、有效 HTTPS 根地址 `PUBLIC_APP_URL`、浏览器来源 `CORS_ORIGINS` 和 `TLS_CERT_DIR`。证书目录必须是绝对路径，含完整链 `fullchain.pem` 和对应私钥 `privkey.pem`，只读挂载到 `/etc/nginx/certs`。证书必须覆盖真实域名。私钥仅授予部署账户访问权限，不得提交或传入构建上下文。证书签发和续期由运维负责，更新后重启 nginx 并复核 HTTPS。

在项目根目录运行（也可从任意目录使用脚本完整路径）：

```powershell
./deploy/start-production.ps1 -CheckOnly
./deploy/start-production.ps1
```

`-EnvFile` 可指定其他文件；默认使用脚本目录中的 `.env.production`，不依赖当前目录。检查模式仍会构建镜像并创建临时检查容器，但不会启动正式服务或打开业务数据库。脚本不输出完整 Compose 配置，每步失败立即停止；不自动删卷、回滚或迁移数据。

API 使用 `env_file: ${QIAN_ENV_FILE:-.env.production}`，默认路径相对于 Compose 文件，即 `deploy/.env.production`，完整传入业务接入变量。脚本同时把所选文件的绝对路径用于 `--env-file` 和 `QIAN_ENV_FILE`，结束或失败后恢复原变量。前者供 Compose 插值，后者选择 API 环境文件；自定义文件时两者不能错配。只有容器专用的 NODE_ENV/HOST/PORT/DATA_DIR 在 environment 中固定覆盖。接入配置应按服务端对应模块说明填写；未启用的可选变量请省略，不要设置空值触发部分配置错误。不要打印展开后的 Compose 配置，也不要把无关密钥放进此文件。

Compose 固定使用 `NODE_ENV=production`、`HOST=0.0.0.0`、`PORT=4310`、`DATA_DIR=/var/lib/qian-estate`。API 只在专用桥接网络监听，不映射宿主端口；不得添加 API 的 `ports` 或主机网络。保留出站网络以访问微信，仅 nginx 发布 80/443。直接在宿主启动 Node 时，生产默认的 `0.0.0.0` 也会监听宿主网卡，必须自行设 `HOST=127.0.0.1` 或配置防火墙。容器私网隔离来自 Compose，而不是 HOST 本身。

`config.ts` 校验上述服务变量、生产必填的两端微信凭据和 HTTPS `PUBLIC_APP_URL`，并校验应用消费的 `CORS_ORIGINS` 与可选 `DEFAULT_AGENT_ID`（正式经纪人存在性由业务层检查）。PUBLIC_APP_URL 当前用于部署配置校验，不代表业务已据此生成链接；它不替代 CORS 来源设置。未使用的 `SESSION_SECRET`、`TRUST_PROXY` 和服务商名称开关已从模板移除。生产缺少任一端凭据、有效公开地址或绝对数据路径时，会在数据库打开前拒绝启动。该检查不调用微信，不验证凭据真实性。TLS_CERT_DIR 由 Compose 用于挂载，虽随 env_file 进入 API，应用不读取它。

## 镜像与路径

构建阶段用锁文件安装依赖，将服务端 TypeScript 编译为 JavaScript，运行镜像只安装生产依赖，不依赖 tsx。单独执行 Vite 构建，不运行小程序构建，也不修改本地 web/mini。`dist/web` 拷入 nginx 的 `/usr/share/nginx/html`；主页与 `/assets/` 来自同一构建产物。`/api`、`/api/…`、`/uploads`、`/uploads/…` 原路径代理到 API，上传文件不由 nginx 绕过服务端读取。HTTP 跳转 HTTPS。Dockerfile 专用忽略文件排除本地数据库、环境文件、证书和 node_modules。

API 健康检查仅确认 `/api/health` 返回 200 且 `status=ok`；nginx 等待 API 健康后启动，其回环健康检查确认静态首页存在并可代理 API。健康检查不证明迁移、微信登录或支付可用。HTTPS Origin 通过 `CORS_ORIGINS` 传入应用。nginx 访问日志不记路径、参数、IP、请求体或凭据，业务日志脱敏仍由应用负责。

### 限流与小规模部署限制

nginx 以 TCP 连接来源 `$binary_remote_addr` 为键，不信任客户端自行提交的转发头。全部 HTTPS 路径共享每个来源平均 120 次/分钟限流，允许额外 20 个突发请求立即通过。`/api/auth`、`/api/auth/…` 和 `/api/admin/pairing` 另共享每个来源平均 10 次/分钟的认证限流，最多 5 个突发请求排队等待，不一次性放行；这不是固定分钟窗口。超过容量返回 429 中文 JSON 和 `Retry-After: 60`。容器回环健康检查不受入口限流影响。

后端保持不信任代理，未提高原有生产认证上限。因此所有经过 nginx 的用户仍共享后端每分钟 10 次敏感请求额度（含认证和管理配对），可能在单个用户尚未触及 nginx 上限时收到 429。这是当前小规模部署的已知容量限制，不代表已完成按用户隔离限流。不能通过设置“信任所有代理”解决。若将来需要提高容量，应先验证专用代理地址或子网边界，再由服务端实施受限信任与限流调整。

若前面再加 CDN、负载均衡器，或宿主网络转换无法保留来源 IP，nginx 会按该上游共享限流；本示例没有配置真实地址头信任。上线须从不同客户端核对来源保留及 429 行为，不能仅凭配置静态检查宣称真实 IP 限流已运行验证。

## 上线前必须验收

### 容器内授予账户角色

构建会同时编译 `scripts/set-role.ts` 及其服务端依赖，运行镜像包含 `/app/scripts/set-role.js`，无需安装 tsx 或其他开发依赖。用户必须先真实登录并获得编号，运维核对身份后，在项目根目录显式执行下列命令（替换用户编号）：

```powershell
docker compose --env-file deploy/.env.production -f deploy/docker-compose.yml exec api node /app/scripts/set-role.js 用户编号 admin --confirm
```

将 admin 改为 agent 或 owner 可调整角色。该操作会修改正式数据库、记录审计并使该用户旧会话失效，不由启动脚本自动执行。容器中请使用此 Node 命令，而非根 package.json 仍依赖开发环境 tsx 的 `npm run account:role`。本次只验证编译与无参数拒绝路径，没有授予任何账户角色。使用非默认环境文件时，需像启动脚本一样设置 QIAN_ENV_FILE 为同一文件绝对路径，再调用 Compose。

### 业务检查

1. 确认生产不生成或使用演示账户/数据，历史演示会话不可复用，真实微信会话可访问受保护接口。
2. 使用新卷及已有数据库备份分别验证迁移，本目录不声称迁移已实现。备份恢复须使用已验收的数据库工具，不要只复制正在写入的 SQLite 主文件而忽略 WAL。
3. 核对有效证书、真实域名和微信平台域名配置；实测 HTTPS 登录、上传、静态资源、退出登录及重启后数据持久化。
4. 确认宿主机无 4310 公网映射，只有 80/443 入站；检查未实现服务商返回错误而非成功。

SQLite 位于命名卷 `qian-estate-data`，正常重建保留数据；不要执行 `down -v`。旧卷需核对 node 用户写权限。已完成本地 TypeScript 编译检查，不等于 Docker 镜像构建成功。当前环境没有 Docker，因此容器构建、nginx 配置加载、真实 IP 限流、TLS 握手与端到端启动尚未实测。

配置依据：[Compose 健康依赖](https://docs.docker.com/compose/how-tos/startup-order/)、[nginx 原路径代理](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_pass)。

限流依据：[nginx 请求限流模块](https://nginx.org/en/docs/http/ngx_http_limit_req_module.html)。
