# dsh-cloud-control

在**同一个 DSH 窗口**里管理另一台机器上的 DSH 会话：列出对端会话、阅读对话、继续发消息，**执行始终发生在对端 Host**。

一个包，两种角色：

- **endpoint（远端）**：在 `/cloud-control/v1` 上暴露一个共享 token 保护的 HTTP 面，把官方的 DSH Remote unary 调用转发到本机 `/api`（凭证在进程内现取现用，永不外传）。
- **controller（本端）**：注册同源的 `/api/cloud-control/*` 路由给浏览器面板使用；对端可以是**直连**（HTTP）或**中继**（对端主动外联，适合桌面这种只监听 loopback 的 Host）。

```
桌面 DSH 窗口
└─ 客户端面板 ──相对 fetch──► 本机 Host /api/cloud-control/*
                                 ├─ controller：对端 direct（HTTP + Bearer）
                                 └─ spoke：长轮询 NAS 的 /relay/poll（出站，无需入站端口）
NAS DSH Host
└─ endpoint /cloud-control/v1/{health,rpc,relay/*} ──► 本机 127.0.0.1 /api/<官方端点>
```

- 不修改 DSH 源码，不写 profile 的 `package.json`，插件零运行时依赖（只用 Node 内置模块）。
- 会话数据面复用官方 Remote 面：`session/list`、`session/projections`、`session/page`、`session/prompt`、`session/cancel`。

## 快速开始

### 0. 生成共享 token

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

两端使用**同一个** token；建议用环境变量 `DSH_CLOUD_TOKEN` 注入，不要写进日志或提交到仓库。

### 1. 装到 NAS（1Panel / 容器内可执行命令）

两种来源，任选其一：

```sh
# 方式 A：GitHub 直装（本插件无构建步骤，不需要 prepare / allowBuilds 授权）
docker exec -it <容器名> sh -lc 'dsh plugin --profile web add github:mimoxh/dsh-cloud-control#v0.1.0'

# 方式 B：本机打包后拷进容器（离线可用，最稳）
pnpm pack          # 产出 dsh-cloud-control-0.1.0.tgz
docker cp dsh-cloud-control-0.1.0.tgz <容器名>:/tmp/
docker exec -it <容器名> sh -lc 'dsh plugin --profile web add /tmp/dsh-cloud-control-0.1.0.tgz'
```

> GitHub 方式依赖容器能访问 github.com（管理器在安装前会做一次 `git ls-remote`，默认 5s 超时）；不通就用方式 B。
> 务必带上 `#v0.1.0`（或 `#<commit>`）锁版本，否则每次重装都会拉默认分支。

编辑容器内 `$DSH_HOME/profiles/web/cordis.patch.yml`（`$DSH_HOME` 默认 `~/.dsh`）：

```yaml
- id: cloud-control
  name: dsh-cloud-control
  config:
    role: endpoint
    displayName: NAS
    endpoint:
      enabled: true
      tokenEnv: DSH_CLOUD_TOKEN      # 或 token: '<shared-token>'
    relay:
      enabled: true                  # 充当 hub：接受 spoke 长轮询
    peers:
      - id: desktop
        label: Windows Desktop
        kind: relay                  # 桌面侧通过出站中继接入
        tokenEnv: DSH_CLOUD_TOKEN
```

给容器加上 `DSH_CLOUD_TOKEN` 环境变量后重启容器。`docker logs` 里不应出现插件加载错误。

> patch 层是**整份替换 config**：改哪一层就把该层用到的字段一次写全。

### 2. 装到桌面（DSH Desktop）

desktop profile 由 Electron 独占，CLI 不接管，请用 **设置 → 插件 → 安装**（或让会话里的 agent 用 `plugin_manager` 的 `install_bundle`，target 传本目录的绝对路径）。

然后在 `C:\Users\<你>\.dsh\profiles\desktop\cordis.patch.yml` 加：

```yaml
- id: cloud-control
  name: dsh-cloud-control
  config:
    role: controller
    displayName: Windows Desktop
    peers:
      - id: nas
        label: NAS
        kind: direct
        baseUrl: 'https://192.168.1.10:10443'     # NAS 上 DSH 的地址（Caddy 前是 https）
        tokenEnv: DSH_CLOUD_TOKEN
        basicAuth: { user: admin, password: '<caddy-basic-auth>' }
        allowInsecureTls: true                    # Caddy 自签证书时为 true
    relay:
      hubUrl: 'https://192.168.1.10:10443/cloud-control/v1/relay'
      tokenEnv: DSH_CLOUD_TOKEN                   # 让 NAS 也能看/用桌面的会话
      basicAuth: { user: admin, password: '<caddy-basic-auth>' }
      allowInsecureTls: true
    pollIntervalMs: 2000
    maxMessages: 60
```

重启桌面应用后，侧边栏会出现「云控台」入口，主面板里能看到对端会话、对话和输入框。

## 配置参考

| 字段 | 默认 | 说明 |
|---|---|---|
| `role` | `controller` | `controller` / `endpoint` / `both` |
| `displayName` | `dsh-cloud-control` | 对端面板里显示的名字；spoke 上报身份也用它 |
| `pollIntervalMs` | `2000` | 面板刷新对话的间隔（面板不可见时暂停） |
| `maxMessages` | `60` | 每次读取的历史条数上限（1–500） |
| `requestTimeoutMs` | `30000` | 单次对端/本机调用预算 |
| `endpoint.enabled` | 角色为 endpoint/both 时 true | 是否挂载 endpoint 路由 |
| `endpoint.token` / `tokenEnv` | — | 共享 token；endpoint 角色必填 |
| `endpoint.allowFrom` | `[]` | 可选来源白名单：`10.0.0.5`、`10.0.0.0/8`、`loopback` |
| `endpoint.allowMethods` | 见下 | 允许转发的官方端点白名单 |
| `endpoint.maxBodyBytes` | `1048576` | 请求体上限 |
| `peers[]` | `[]` | 对端：`{id,label,kind:'direct'\|'relay',baseUrl?,token/tokenEnv,basicAuth?,allowInsecureTls?,timeoutMs?}` |
| `relay.enabled` | `false` | 充当 hub，挂载 `/relay/poll`、`/relay/result` |
| `relay.hubUrl` | — | 充当 spoke：拨号到 hub 的 relay 基址 |
| `relay.token` / `tokenEnv` | 回退到 `endpoint.token` | relay 路由的 token |
| `relay.basicAuth` / `relay.allowInsecureTls` | — | 同 peers，用于 spoke 拨号时经过的反代 |
| `relay.waitMs` | `25000` | 长轮询时长（1000–30000） |
| `relay.maxQueue` / `requestTtlMs` | `32` / `30000` | hub 队列上限与请求存活时间 |

默认 `allowMethods`：`session/list`、`session/projections`、`session/page`、`session/prompt`、`session/cancel`、`session/updateQueue`。

### 反向代理（1Panel / Caddy）下的配置

自建部署通常把 DSH 放在 Caddy 后面：对外是 **HTTPS**，并可能带一层 **Basic Auth**。此时：

- `baseUrl` / `relay.hubUrl` 用 `https://…`；
- 反代的 Basic Auth 写进 `basicAuth: { user, password }`；
- 证书是自签的（Caddy 内部 CA）时加 `allowInsecureTls: true`（仅对这一个对端生效，不会关闭全局 TLS 校验）；
- 本插件的 token 走**独立请求头** `X-Cloud-Control-Token`，因此和 `Authorization: Basic …` 互不冲突（也仍接受 `Authorization: Bearer …`）。

```yaml
peers:
  - id: nas
    label: NAS
    kind: direct
    baseUrl: 'https://192.168.1.10:10443'
    tokenEnv: DSH_CLOUD_TOKEN
    basicAuth: { user: admin, password: '<caddy-basic-auth>' }
    allowInsecureTls: true
```

## 验证

```sh
# 端点存活 + 版本（反代带 Basic Auth 时加 -u，自签证书加 -k）
curl -s -k -u admin:pass -H "X-Cloud-Control-Token: $TOKEN" https://<NAS>:10443/cloud-control/v1/health

# 直接读一次会话列表
curl -s -k -u admin:pass -H "X-Cloud-Control-Token: $TOKEN" -H 'content-type: application/json' \
  -d '{"method":"session/list","payload":{"args":{"_request":{}}}}' \
  https://<NAS>:10443/cloud-control/v1/rpc

# 负例：无 token → 401；白名单外方法 → 403
curl -s -k -u admin:pass -o /dev/null -w '%{http_code}\n' https://<NAS>:10443/cloud-control/v1/health
```

面板链路（本机浏览器 Cookie）：打开 DSH → 侧边栏「云控台」→ 选择对端 → 选择会话。

## 安全边界

- 共享 token 等价于对端的 **owner 级** Remote 权限（读会话 + 发消息）。只在内网/VPN 使用；公网必须 HTTPS，并考虑 `endpoint.allowFrom` 限制来源。
- endpoint 路由不走 DSH 的 Host/Origin 栅栏（`ctx.webServer` 本身不做鉴权），**鉴权全部由本插件负责**：常量时间比较、可选来源白名单、方法白名单、体积/超时上限。
- 对端 Cookie / launch token 只在各自进程内使用，不会跨机传递，也不会写进日志。
- 中继只由 spoke 出站发起，hub 不新开任何端口；请求带 TTL，spoke 掉线不会挂死调用方。

## 已知限制（v1）

- 没有 token 级流式：面板按 `pollIntervalMs` 轮询最新窗口（可见时才轮询）。
- 只支持文本输入：图片/附件、斜杠命令、终端、plan/goal 面板不在本期。
- 不能在远端新建会话；只读+续用已存在的会话。
- 子会话（subagent）行会被过滤掉，只显示根会话。
- 会话 cursor 依赖 `session/projections`：极少数没有任何投影的冷会话会返回 `no-cursor`。
- 若对端会话正被另一个写者持有，`session/prompt` 会返回 `session/writer-held`（原样透传到面板）。

## 开发

```sh
# 单元测试（每个文件直接跑；`node --test` 在受限沙箱里会 EPERM）
node test/auth.test.mjs
node test/config.test.mjs
node test/relay.test.mjs
node test/transcript.test.mjs
node test/client.test.mjs     # 用迷你 React + 假 fetch 渲染面板
node test/manifest.test.mjs

# 本地起一个带插件的临时实例（.dev/overlay.yml 用绝对路径挂载工作树）
$env:DSH_HOME="$PWD/.devhome"
dsh ccdev --from-default-profile web --patch .dev/overlay.yml --no-open --port 39180

# 面板外观预览：不需要 Host / 登录 / 对端，直接开生成的静态页
node .dev/preview-server.mjs --write   # 生成 .dev/panel-preview-{light,dark}.html
node .dev/preview-server.mjs 39181     # 或起一个预览服务（可切换 ?theme=dark）
```

面板的会话区**刻意与原生会话页同构**：布局变量（`--dsh-chat-content-width`、`--dsh-composer-card-max-width`、`--dsh-content-font-size`）、圆角、投影与行节奏都照抄自安装包内客户端的样式，只用 `--dsw-alias-*` / `--dsw-specific-*` 令牌。按插件撰写规范，客户端插件**不得** `require` 其他 Harness 客户端包（会随版本变动、且抛错会清空插槽），所以这里是"抄标记与样式"而不是"引组件"；`client.js` 顶部注释记录了每个值的来源，升级 DSH 后照它重新对一次即可。`node .dev/check-classes.mjs` 会校验"标记里用到的类都有样式、样式里的类都被用到、字面色只出现在图标里"。

`.dev/overlay-spoke.yml` 是第二个实例（spoke）的配置，用来本地验证中继；`.dev/`、`.devhome*/` 均已 gitignore。

浏览器半边是**手写**的 `window.__ModuleLoader__.load({id, factory})` 包，不需要构建步骤；改完 `client.js` 保存即可（宿主按文件 mtime 热换）。

## License

MIT
