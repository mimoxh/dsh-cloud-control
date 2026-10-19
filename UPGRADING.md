# 升级到 0.1.3

0.1.3 修掉了一个会**让整个远端会话功能失效**的缺陷，并把面板的会话区改成原生观感。
**两端都要更新**——NAS 与本机各自运行一份插件，各自负责自己的会话。

| 改动 | 影响谁 |
|---|---|
| `lib/local-rpc.mjs`：本机 API 回环 origin 三级解析 + 失败原因不再被吞 | **两端都必需**。NAS 上这条一直失败，所以之前两端都取不到会话 |
| `lib/peer.mjs`：对端非 200 时透出响应体 | 两端（面板能看到对端真实报错） |
| `client.js`：会话区与原生会话页同构 | 本机（面板所在侧） |

## 0. 为什么必须两端都升

一次「在 NAS 面板里读本机会话」的链路是：

```
NAS 的浏览器面板
  → NAS Host 的 controller（peer: desktop, kind: relay）
  → desktop 的 spoke 长轮询取到请求
  → desktop 的 lib/local-rpc.mjs 调自己的 /api/session/*
```

读 NAS 会话时方向相反，用的是 **NAS 自己**的 `lib/local-rpc.mjs`。两端的回环桥都要修好，
两个方向才都通。

---

## A. NAS（1Panel / Docker 里的 web profile）

下边的 `<容器名>` 换成你的 DSH 容器名，可先 `docker ps` 查。

### A1. 先备份配置与旧版本

```sh
docker exec -it <容器名> sh -lc 'cp -a $DSH_HOME/profiles/web/cordis.patch.yml /tmp/cordis.patch.yml.0.1.0'
docker exec -it <容器名> sh -lc 'ls -l $DSH_HOME/profiles/web/node_modules/dsh-cloud-control'
```

### A2. 升级插件（三选一）

**方式 1：GitHub 直装（容器能出网时最省事）**

```sh
docker exec -it <容器名> sh -lc 'dsh plugin --profile web add github:mimoxh/dsh-cloud-control#v0.1.3'
```

> 一定要带 `#v0.1.3`。不带版本会拉默认分支，每次重装结果都可能不同。
> 管理器安装前会做一次 `git ls-remote`（默认 5s 超时），容器不能出网就换方式 2。

**方式 2：离线 tgz（最稳，推荐）**

在本机仓库根目录打包（不需要 npm/pnpm，也不写任何全局缓存）：

```powershell
node .dev/pack.mjs          # 产出 dsh-cloud-control-0.1.3.tgz（23 个文件）
node .dev/verify-pack.mjs   # 校验：与工作树逐字节一致（应输出 PACK OK）
docker cp dsh-cloud-control-0.1.3.tgz <容器名>:/tmp/
docker exec -it <容器名> sh -lc 'dsh plugin --profile web add /tmp/dsh-cloud-control-0.1.3.tgz'
```

**方式 3：只换文件（不想动插件管理器时）**

把本机的 `index.js`、`client.js`、`lib/*.mjs`、`cordis.patch.yml` 覆盖到
`$DSH_HOME/profiles/web/node_modules/dsh-cloud-control/` 下同名位置，然后重启 DSH。

### A3. 确认 NAS 侧配置（role=endpoint）

`$DSH_HOME/profiles/web/cordis.patch.yml` 里这一层：

```yaml
- id: cloud-control
  name: dsh-cloud-control
  config:
    role: endpoint
    displayName: NAS
    endpoint:
      enabled: true
      tokenEnv: DSH_CLOUD_TOKEN     # 建议用环境变量，不要明文写 token
    relay:
      enabled: true                 # 充当 hub，接受桌面 spoke 长轮询
    peers:
      - id: desktop
        label: Windows Desktop
        kind: relay                 # 桌面通过出站中继接入，不开放任何入站端口
        tokenEnv: DSH_CLOUD_TOKEN
```

> patch 层是**整份替换 config**：改哪一层就把该层用到的字段一次写全，别只写改动的那两个。
> 给容器配好 `DSH_CLOUD_TOKEN` 后重启容器。

### A4. 重启与自查

```sh
docker restart <容器名>
docker logs --tail 100 <容器名>          # 不应出现插件加载错误
```

---

## B. 本机（DSH Desktop）

desktop profile 由 Electron 独占，CLI 不接管，所以用 **设置 → 插件 → 安装**，
或让会话里的 agent 用 `plugin_manager` 的 `install_bundle`，target 传本仓库目录的绝对路径。

装完后在 `C:\Users\<你>\.dsh\profiles\desktop\cordis.patch.yml` 里确认这一层：

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
        baseUrl: 'https://<NAS地址>:10443'      # Caddy 前是 https
        tokenEnv: DSH_CLOUD_TOKEN
        basicAuth: { user: admin, password: '<caddy-basic-auth>' }
        allowInsecureTls: true                  # Caddy 自签证书时
    relay:
      hubUrl: 'https://<NAS地址>:10443/cloud-control/v1/relay'
      tokenEnv: DSH_CLOUD_TOKEN
      basicAuth: { user: admin, password: '<caddy-basic-auth>' }
      allowInsecureTls: true
    pollIntervalMs: 2000
    maxMessages: 60
```

重启桌面应用。若面板外观没变化，按一次 `Ctrl+R` 刷新（浏览器半边按文件 mtime 热换，
但有时需要重载一次页面）。

---

## C. 验证清单

按顺序做，每一步都有明确的期望值。

> 下面的 `.dev/*.mjs` 探针是本仓库的开发脚本（`.dev/` 未纳入版本库，克隆仓库后才有）。

**1. 端点版本（在能出网的机器上执行）**

```powershell
node .dev/probe-raw.mjs
```

期望：`GET /cloud-control/v1/health` 返回 `"pluginVersion":"0.1.3"`。
若仍是 `0.1.0`，说明 NAS 没装上新版本。

**2. 回环桥是否修好（关键）**

```powershell
node .dev/probe-raw.mjs
```

期望：`POST /cloud-control/v1/rpc {session/list}` 返回 **HTTP 200** 且带
`{"ok":true,"response":{"type":"server-response",...}}`。

- 若仍 500 但 message 变成 `the DSH webserver origin is unavailable: getOrigin() failed: …`：
  说明新代码已生效，且它**告诉了你 NAS 上真正的原因**（这正是本次修复的价值）。
  把这句话发给我，我按它给下一版。
- 若还是老文案 `the DSH webserver is not listening yet`：NAS 上的还是旧代码。

**3. 面板链路**

打开 DSH → 侧边栏「云控台」：

- 顶部对端标签有绿点；
- 左侧出现对端会话列表（按工作目录分组）；
- 点一个会话，右侧按「轮」渲染出对话，推理与工具调用是可折叠行；
- 输入框是原生卡片样式，右下角圆形发送键；
- 发一条消息，对端会话应收到；对端在跑时会出现「停止」。

**4. 两个方向都测**

- 本机面板 → 看 NAS 会话；
- NAS 面板 → 看本机会话（这条依赖本机的 spoke 与 `local-rpc`）。

---

## D. 回滚

```sh
docker exec -it <容器名> sh -lc 'dsh plugin --profile web add github:mimoxh/dsh-cloud-control#v0.1.0'
docker exec -it <容器名> sh -lc 'cp -a /tmp/cordis.patch.yml.0.1.0 $DSH_HOME/profiles/web/cordis.patch.yml'
docker restart <容器名>
```

本机在 设置 → 插件 里重装并指定 `#v0.1.0` 即可。

## E. 排错

| 症状 | 原因 | 处理 |
|---|---|---|
| 面板顶部出现 `peer nas returned HTTP 500: {"code":"not-ready",…}` | NAS 仍是旧代码 | 走 A2 升级 NAS |
| 提示 `unauthorized` | 共享 token 或反代 Basic 不一致 | 两端用同一个 token；`basicAuth` 填 Caddy 的账号密码 |
| 提示 `unreachable` / 证书错误 | 自签证书未放行 | 该对端加 `allowInsecureTls: true` |
| 对端标签显示「等待对端接入」 | 桌面 spoke 未连上 hub | 检查 `relay.hubUrl` 与 token；桌面需能访问 NAS 的 10443 |
| 装完插件后 DSH 起不来 | patch 层字段写残 | patch 是整层替换：把该层字段写全（见 A3） |
| `dsh plugin add` 报 git 超时 | 容器不能访问 github.com | 改用方式 2 的离线 tgz |

## F. 安全提醒（本次实测发现）

NAS 部署上，`POST /api/session/list` 在**不带任何 Cookie/API 凭证**时即返回 200——
只有 Caddy 的 Basic Auth 挡在外面。任何能过反代认证的客户端都能以 owner 身份读写该
Host 的会话，绕过插件自己的共享 token。建议只让插件端点暴露在可信网络内，并改用环境
变量注入 token（`tokenEnv`），不要明文写进 `cordis.patch.yml`。
