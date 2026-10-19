# 远程会话内容：部署实测与链路钉死（CH-3）

> **状态**：调查记录（2026-10-19）。文中的 `not-ready` 阻断已在 `lib/local-rpc.mjs` +
> `lib/peer.mjs` 修复并有单测覆盖；**两台机器尚未重新部署**，所以下面的 NAS 实测输出仍是
> 修复前的。升级命令见 README。
>
> 所有"实测"条目均为 2026-10-19 在本机（Windows Desktop，DSH 0.2.1-rc.2）对
> `https://192.168.1.10:10443`（NAS，Caddy + Basic Auth）与 `http://127.0.0.1:50013`（本机 Host）的真实请求输出。
> 探针脚本在 `.dev/` 下（`probe-lead-edges.mjs`、`probe-raw.mjs`、`probe-nas-transcript2.mjs`、`probe-nas-pagination.mjs`、`probe-local-host.mjs`）。
> 注意：本机 `curl` 走 schannel 会 `SEC_E_NO_CREDENTIALS`，所有探针都用插件的 `lib/http-client.mjs`（Node http/https + `allowInsecureTls`）。

## 1. 拓扑与数据流

```
NAS (192.168.1.10:10443, Caddy → DSH web)          Windows Desktop (DSH Desktop 0.2.1-rc.2)
┌──────────────────────────────────────────┐          ┌────────────────────────────────────────┐
│ DSH Host（较新构建，含 dsh-api-gateway）   │          │ DSH Host（loopback 127.0.0.1:50013）    │
│  ├ /api/<method>  ← 官方信封 POST         │          │  ├ /api/<method>（需要 API cookie）     │
│  └ cloud-control role=endpoint + hub      │          │  └ cloud-control role=controller+spoke  │
│      /cloud-control/v1/{health,rpc,relay} │◄────────►│      spoke 长轮询 NAS 的 /relay/poll    │
└──────────────────────────────────────────┘          └────────────────────────────────────────┘
        ▲ NAS 面板（浏览器）                                 ▲ 桌面面板（浏览器）
        └── /api/cloud-control/* → 对端 rpc                   └── /api/cloud-control/* → 对端 rpc
```

面板一次"读内容"的调用链：

```
浏览器 fetch('api/cloud-control/history?peer&sessionId')
  → 本机 Host 的 controller（lib/controller.mjs，owner-only）
  → peer.mjs: direct(HTTP+Bearer) 或 relay(经 hub 长轮询到 spoke)
  → 对端 /cloud-control/v1/rpc  →  对端 local-rpc.mjs  →  POST 对端自身 /api/session/page
  → {records, hasMore} → transcript.toRows() → 面板行
```

## 2. 实测结果矩阵

| 探测 | 目标 | 结果 | 说明 |
|---|---|---|---|
| `GET /cloud-control/v1/health` | NAS | **200** `{"ok":true,"pluginVersion":"0.1.0","name":"NAS","node":"v24.21.0","relay":true}` | 端点活着；插件版本与工作树同为 0.1.0 |
| `GET /cloud-control/v1/health` 无 token / 错 token | NAS | **401** | 常量时间 token 校验生效 |
| `POST /rpc {method:'session/export'}` | NAS | **403** `method-not-allowed` | 方法白名单生效 |
| `POST /rpc {method:'session/list'}` | NAS | **500** `{"code":"not-ready","message":"the DSH webserver is not listening yet"}` | **唯一阻断点**，见 §3 |
| 同上（应为中继路径） | NAS | 3–16ms 内 500，同一文案 | 未走到中继：失败发生在 `local-rpc.origin()` |
| `POST /api/session/list`（官方信封，无 Cookie） | NAS | **200** `{type:'server-response',rpcId,result:{ok:true,value:{items:[…10 条…]}}}` | 对端 Host 的官方通道**完全可用** |
| `POST /api/session/projections`（`args:{request:{sessionId}}`） | NAS | **200**，`{asOfSeq:213, values:{title,goal,tokenUsage,contextPressure,inbox,sessionStats,turnOutline}}` | 投影可用 |
| `POST /api/session/page`（`throughSeq:213, maxMessages:20`） | NAS | **200**，`records=132 hasMore=true`，649 KB | **会话内容可读**：assistant/message 含 reasoning+text+tool-call 块 |
| 同上（分页） | NAS | `beforeSeq:159` → seq 106–158，`hasMore=true` | 向前翻页语义成立 |
| 同上（maxMessages=8） | NAS | 返回 **55** 条（seq 159–213） | `maxMessages` **不是**硬上限，仅约束窗口边界 |
| `POST /api/session/list` | 本机 Desktop | **401** `unauthorized` | 本机 Host 需要 API cookie，与 NAS 不同 |
| `GET /connect?token=…` | 本机 Desktop | **401**（错 token） | cookie 交换路由存在，等待合法 launch token |
| `GET /api/cloud-control/state` | 本机 Desktop | **401** | controller 路由已注册（未带 owner cookie） |

## 3. 根因：`localRpc` 的 loopback 桥在 NAS 上构造失败

`lib/local-rpc.mjs` 的 `origin()` 只走 `ctx.webServer.getOrigin()`，任何异常都被吞成固定文案
`'the DSH webserver is not listening yet'`（`CloudError('not-ready', …)`），因此：

- NAS 上每一次 `/rpc`（含本该走中继的调用）都在几毫秒内以 500 失败；
- 面板只看到 `upstream-http: peer nas returned HTTP 500`（`lib/peer.mjs` 丢弃了响应体）；
- 两端会话列表都为空、内容不可读。

**修复方向（CH-1）**：`getOrigin()` 优先 → 失败回退 `${ctx.webServer.protocol}//127.0.0.1:${ctx.webServer.port}`
（DSH 官方 `dsh-web-app`/`desktop-host` 内部即如此构造 loopback URL）→ 仍失败时把底层 `error.message` 与
`typeof ctx.webServer.getOrigin / protocol / port / host` 写进错误信息。同时让 `peer.mjs` 透出对端响应体前 200 字符。
修复后需**重新安装到 NAS**才对 NAS 生效（见 §4）。

## 4. 升级与配置步骤

> 本节是当时的调查记录。**现行的安装与升级步骤以 [UPGRADING.md](../UPGRADING.md) 为准**，
> 这里只保留当时确认过的事实：插件以 `github:mimoxh/dsh-cloud-control` 装进 desktop profile，
> 升级必须锁 ref（`#v<版本>` 或 `#<commit>`）。

NAS 侧 `$DSH_HOME/profiles/web/cordis.patch.yml`（patch 层是**整份替换 config**，改一层就把该层字段写全）：

```yaml
- id: cloud-control
  name: dsh-cloud-control
  config:
    role: endpoint
    displayName: NAS
    endpoint: { enabled: true, tokenEnv: DSH_CLOUD_TOKEN }
    relay: { enabled: true }
    peers:
      - { id: desktop, label: Windows Desktop, kind: relay, tokenEnv: DSH_CLOUD_TOKEN }
```

桌面侧 `cordis.patch.yml` 保持 `role: controller` + `peer nas kind: direct` + `relay.hubUrl`（spoke）。
**建议把明文 token 换成 `tokenEnv: DSH_CLOUD_TOKEN`**（当前 desktop patch 里是明文）。

## 5. 安全提醒（本次实测发现，非本次任务范围）

NAS 的 `POST /api/session/list` 在**没有任何 Cookie/API 凭证**时即返回 200（只有 Caddy 的 Basic Auth 挡在外面）。
这意味着：任何能过 Caddy 认证的客户端都能以 owner 身份读写 NAS 上的会话，**绕过插件自身的共享 token**。
建议核对 NAS 上 DSH 的绑定与反代策略（是否只应经插件端点暴露），并避免把该端口放到更大范围网络。
另：`/cloud-control/v1/health` 与 `/rpc` 的 token 目前是明文写在 patch 文件里，建议改用环境变量注入。
