# 远端会话内容读取：协议可行性与保真度取证

> **状态**：调查记录（2026-10-19），保留作协议参考。面板侧的落地选择见 README「开发」一节：
> 会话区与原生会话页同构（抄标记与令牌），而**不是**把远端会话挂进原生会话区——原因见第 0 节。
>
> 取证对象：`dsh-cloud-control`（插件，git `19a0d5d7aba75c8f299c4e7e2cedda413e9658c0`，2026-10-19 13:11）
> 官方实现：`D:\Software\AI\Deepseek_Harness\resources\app.asar`（182,794,869 bytes；内嵌 `@deepseek-ai/dsh-*` **0.2.1-rc.2**）
> 取证时间：2026-10-19
> 引用约定：
> - 插件源码：仓库相对路径 + 行号，例如 `lib/transcript.mjs:109-121`。
> - 官方源码：`app.asar!<归档内路径>:<行号>`，例如 `app.asar!dsh/node_modules/@deepseek-ai/dsh-api-session-controller/lib/types/history.js:395-425`。括号中的 `@byte` 是该文件在 asar 中的**起始字节偏移**（asar 数据区起点 = 4,779,796；用 Node 解析 asar header 后 `dataOffset + file.offset` 得到，18309 个条目全部可复现）。
> - 「实测」= Team Lead 在 NAS Host（`https://192.168.1.10:10443`，Caddy + Basic Auth）上用官方信封 `POST /api/<method>` 实测（2026-10-19），本报告只转述，不重复声称。
> - 「未验证」= 源码/实测都没有直接确证的点，集中在第 7 节。

---

## 0. 结论

**有条件可行。**

- **协议层：完全可行。** 官方 Remote 面本身就提供完整的会话内容读取：`session/page` 按序返回**整段持久事件日志**（含工具参数、工具结果全文、`tool/result.data.meta`、`assistant/message` 的 reasoning 块与紧凑流），`session/attachment` 能按会话授权取回**图片原始字节**（base64），`/api/file` 能读**工作区文件**，`session/page`/`session/follow` 还接受 **subagent 地址**读子会话；官方甚至提供 `session/export` 把「会话 + 子会话 + 附件」打成一个 ZIP。证明见第 3.4 节。
- **实时层：官方有真推送，但当前插件的 HTTP 转发面用不了。** 官方实时跟随是 `session/follow`（`mode: 'stream'`，先整页 opening snapshot，再逐条 `{type:'event'}` 帧，另可选 token 级 `assistant-stream` 帧），它和所有 Remote 流共用 **`/api/remote.mux` WebSocket**；本插件端点只做一元 HTTP 转发（`lib/local-rpc.mjs:98-141`），而一元 POST 打到 stream 端点会被网关直接拒绝（`gateway/signature-invalid`）。所以现状只能是轮询近似。
- **展示层：当前实现是有损的，但这是插件自设限制，不是协议限制。** `lib/transcript.mjs` 自己写明 "intentionally lossy: images and file references become placeholders because v1 carries text only"（`lib/transcript.mjs:15-16`），并且丢掉了 `step/*`、`turn/*`、`assistant/attempt`、审批、用量等已持久化的可读信息，也**没有按 `surfaceOp === 'append'` 过滤历史替换副本**（这点会显示被替换掉的旧内容，见 4.1）。
- **不需要改 DSH 源码。** 达到「内容可读」的最小实现只动插件（S 级）；达到「近实时跟随」需要端点侧新增一条 in-process `session/follow` 桥 + 长轮询转发（M–L 级），仍然不需要改 DSH。

一句话给用户：**「看到会话内容」今天就能做，工作量小；「像 ChatGPT 那样逐字实时跟随」协议支持，但要在插件里补一条流桥，属于中等偏上的改造，不必改 DSH 本体。**

---

## 1. `session/page`：请求/响应形状与分页语义

### 1.1 形状（源码）

官方注册表（含 JSDoc、jsonSchema、TS 声明）在 `typert.host.js`：

- 请求：`app.asar!.../lib/typert.host.js:1716-1747`（`@byte 20,102,645`，其中 1729 是 strict jsonSchema，`required: ["address","throughSeq"]`）。
- 响应：同文件 1740-1746（`{records, hasMore}`，`required: ["records","hasMore"]`）。
- TS 声明：同文件 `2874-2875`（`SessionPageRequest`）、`2870-2871`（`SessionPage`）、`2834-2835`（`SessionHistoryRecord = SessionEventEntry`）、`2802-2803`（`SessionEventEntry`）、`2998-2999`（`SessionWireEvent`）、`2750-2751`（`SessionAddress`）。

| 字段 | 语义（原文/源码） | 证据 |
|---|---|---|
| `address` | `{kind:'session',sessionId}` 或 `{kind:'subagent',parentSessionId,childSessionId,mode}`；subagent `mode ∈ {one-shot,continuable,unknown}` | `typert.host.js:1729, 2750-2751` |
| `throughSeq` | **必填**，包含式日志截断点（"Inclusive log cut obtained from the corresponding follow opening frame"）；允许 `-1`；必须 ≤ 当前 source cursor，且必须命中日志（`sourceLog[throughSeq].seq === throughSeq`） | `typert.host.js:1729`；`.../lib/types/history.js:101-117, 318-323`（`@byte 20,907,944`） |
| `beforeSeq` | 可选，**页码的上界（不包含）**：`end = min(throughSeq+1, beforeSeq)`；它不设下界 | `history.js:104-106, 395-396` |
| `maxMessages` | 可选，默认 50（`DEFAULT_MAX_MESSAGES`）；**只统计 append-origin 的 `user/message`/`assistant/message`**，不是「事件条数上限」 | `history.js:59-60, 395-425` |
| `turnWindow` | 可选 `{minMessages,minTurns}`，`minMessages ≤ maxMessages`；扫描时先遇到 `turn/start` 且两个下限同时满足就在该轮起点切 | `history.js:332-347, 400-408` |
| `records[]` | `{type:'event', event:{type,seq,time,data,ignorable?,sourceEventSeqs?,surfaceOp?}}`，按 seq 升序、**连续**（区间内所有持久事件，含 log-only 事件） | `typert.host.js:1745, 2998-2999, 2802-2803` |
| `hasMore` | `cut > 0`，即**更早**还有历史；与「是否还有新事件」无关 | `history.js:425, 120-123` |

### 1.2 分页方向：只有「向前翻页」，没有 go-forward 参数

`paginate()` 的完整逻辑（`history.js:395-425`）：

```js
const end = SessionLogOffset(Math.min(throughSeq + 1, beforeSeq ?? throughSeq + 1));
// 从 end-1 向下扫描，累计 append-surface 的 user/assistant 消息；命中 maxMessages 或 turnWindow 即 cut
return { events: events.slice(cut, end), hasMore: cut > 0 };
```

- **向前翻页（load older）**：拿当前窗口最小 seq 当 `beforeSeq` 再请求即可，页尾恰好停在 `beforeSeq-1`。实测印证：`throughSeq=213, beforeSeq=159` → `seq 106..158`（实测，Lead）。
- **向后取（go-forward）**：**请求里没有 `afterSeq` / `fromSeq` / `cursor` / `exclusive` 任何字段。** strict schema 是 `additionalProperties:false`（`typert.host.js:1735`），校验函数只读 `throughSeq`/`beforeSeq`/`maxMessages`/`turnWindow`（`history.js:318-347`）。
- 因此要从「上次的 seq N」之后取新事件，一元面**只有近似法**：记住上次最大 seq，用最新 `throughSeq`（通常取 `session/projections.asOfSeq`）请求尾部页，再按 `seq > N` 过滤 / 去重。
  - 这个近似是**可靠的**：page 一定包含 `(cut, throughSeq]` 区间，只要 `throughSeq` 已推进到最新，新区间必然落在页内。
  - 但它**不是增量的**：每次仍把整个尾部窗口（默认 50 条消息所跨的全部事件）传回来。实测印证：`throughSeq=213, maxMessages=8` 返回 55 条 / 360KB（实测，Lead）——`maxMessages:8` 只数 8 条 user/assistant 消息，中间夹着的 `turn/*`、`step/*`、`tool/*`、`assistant/attempt`、`request/header` 等事件全都随页返回（`history.js:409-424`；`MESSAGE_TYPES` 只含两类消息，`history.js:60`）。
- **官方真正的 go-forward 通道是 `session/follow` 流**（第 2 节）。它的 wire 请求同样**没有 cursor 字段**（`SessionFollowRequest` 只有 `address` / `assistantStream` / `maxMessages` / `turnWindow`，`typert.host.js:2818-2820`）；官方注册表对该参数的描述写着 "durable address and last committed sequence already held by the caller"（`typert.host.js:1562`），但**schema 里没有承载这个 seq 的字段**——这是一处「描述比 wire 多说了半句」的地方。官方的续传方式是：重新打开 follow 拿新的 opening snapshot，再用 tail page 修缺口（`.../lib/types/client/transport.js:74-112`；`.../README.zh.md:54`，`@byte 19,779,197`）。**任何形如 `session/page{afterSeq}` 的调用都是不存在的参数**，不要发明。

### 1.3 `throughSeq = -1` 与错误语义

- `throughSeq: -1` 合法，代表「日志起点之前」的截断（`history.js:101-103, 319-323`）。插件在会话还没有可读游标时会走自己的 `no-cursor` 分支（`lib/controller.mjs:101-106`），并不发 `-1`。
- `throughSeq > sourceCursor` → `gateway/bad-request`；`throughSeq` 未命中日志 → `gateway/internal`（`history.js:111-117`）。
- `maxMessages` 必须为正安全整数（`history.js:333-336`）；`beforeSeq` 必须非负安全整数（`history.js:324-329`）。

---

## 2. 流式/推送：官方有什么，插件能不能用

### 2.1 `session/follow`：官方实时跟随（真推送）

- 端点声明：`mode: 'stream'`，描述 "Follow one Session log from its opening or resume cursor"（`typert.host.js:1554-1587`）。结果类型 `SessionFollowFrame`（`typert.host.js:2814-2815`）：

  ```
  { type:'snapshot', header, cursor, records, hasMore, projections, assistantStream? }
  | { type:'event', event: SessionWireEvent }
  | { type:'assistant-stream', frame: SessionAssistantStreamFrame }
  ```

- 实现（`history.js:139-269`）：先发 opening snapshot（= 从 `cursor` 起按 `maxMessages`/`turnWindow` 回溯的一页 + projections 基线 + 可选 assistant 流基线，`history.js:201-220`），然后持续 `yield` 新事件；**seq 必须连续**，跳号直接 `gateway/internal`（`history.js:231-252`，`nextOffset = cursor+1`）。
- 订阅源是 `session/event`（每个已提交事件，`history.js:158-163`），所以它推的是**持久事件**，不是 UI 私有数据。
- `assistantStream: true` 时额外推 `assistant-stream` 帧（`history.js:179-190`）：token 级 `start/chunk/end`，含 `text-delta`/`reasoning-delta`/`tool-call-delta`（帧类型 `typert.host.js:2762-2763`）。这些帧来自 agent 主循环的 `agent/assistant-stream`（`app.asar!.../dsh-agent-loop/lib/index.js:1079-1091`，`@byte 17,287,418`）——**这是「看到正在生成的回复」的唯一官方数据源**。
- `SessionControlFrame`：`session/control` 也是流（`mode:'stream'`，`typert.host.js:1505-1520`），每代先发全量 `{type:'baseline', value:{projections: Record<SessionId, {asOfSeq,values}>}}`，再发逐键 `{type:'projection', sessionId, key, value, seq}`（`.../lib/types/control.js:30-64`，`@byte 20,900,532`）。这是官方实时「会话列表状态/投影」通道（running、title、inbox…）。

### 2.2 传输：流只走 `/api/remote.mux` WebSocket

- 常量：`REMOTE_STREAM_MUX_PATH = '/api/remote.mux'`（`app.asar!.../dsh-api-gateway/lib/types/stream-protocol.js:3-4`，`@byte 18,334,855`）；客户端帧 `open/item/end/cancel`、服务端帧 `item/end/error`（同文件 148-198）。
- 浏览器侧一元走 HTTP `POST /api/<endpoint>`，流走这条 WebSocket；Host 启动器就绪后才注册该 upgrade 路由（`app.asar!.../dsh-api-gateway/README.zh.md:39,41`，`@byte 17,924,695`；`.../dsh-client-connection/README.zh.md:34,41`，`@byte 22,646,905`）。
- **一元 POST 打 stream 端点必然失败**：`gateway/signature-invalid: stream Remote methods must be opened through the stream carrier`（`app.asar!.../dsh-api-gateway/lib/types/index.js:244-247`，`@byte 18,271,957`）。`ctx.typertGateway.stream()` 才是 Host 侧打开流的入口（同文件 266-294，参数装配 554-559；README.zh.md:39）。
- `$events`（转发的 Host 事件）也走同一条 mux，而且名单里**只有生命周期事件**：`api-session/added|removed|status|activity|error`、`approval/request`（waterfall）、`user-questions/request` 等（`app.asar!.../dsh-api-remotes/lib/types/remote-events.js:16-45`，`@byte 19,743,385`；`.../README.zh.md:43,47`）。**没有任何消息内容事件**——想拿内容就必须 follow/page。

### 2.3 本插件现状：只有一元转发 + 轮询

- 端点只能转发白名单里的一元方法（`lib/config.mjs:7-14`；`lib/endpoint.mjs:88-95`），实现是 `POST /api/<method>` 的官方一元信封（`lib/local-rpc.mjs:98-141`）。`session/follow`、`session/control` 都不在白名单，且即使加进去也会被 2.2 的 `gateway/signature-invalid` 拒绝。
- 面板侧 `history` 路由每次轮询都重新取「尾部窗口」（`lib/controller.mjs:84-118`），前端每 `pollIntervalMs`（默认 2000ms，`lib/config.mjs:81`；面板下限 1000ms，`client.js:353`）整体替换 `latest.rows`，再与 `older.rows` 按 seq 去重（`client.js:366-409`）。也就是说：**每次轮询 = 1× `session/projections` + 1× `session/page`（约 200–400KB 量级，实测 360KB/55 条）+ 列表 TTL 4s 内复用**（`lib/controller.mjs:7, 91-99`）。
- 轮询的**下界（粒度上限）**在协议侧由「持久事件何时落盘」决定：
  - `turn/start`、`step/start`、`tool/call`、`tool/result`、`step/end`、`turn/end` 都是**即时追加**的持久事件（`dsh-agent-loop/lib/index.js:682, 697, 945, 970, 994, 1029`）。
  - `assistant/message` / `assistant/attempt` 是 **attempt 结算时才落盘**（`live.settle(...)`，`dsh-agent-loop/lib/index.js:1098, 1113, 1118, 1131, 1156`）。
  - 结论：**轮询能看到「工具在跑、步骤在推进」，但助手正文只能等 attempt 结算后才整段出现；正在逐字生成的文本只能通过 `session/follow` 的 `assistantStream` 帧拿到。** 轮询粒度再快也拿不到 token 流。

### 2.4 不改 DSH 源码的前提下，插件还有什么办法拿到流

三条源码可证的路径（**均未在本机实测**，见第 7 节）：

1. **端点进程内打开流**：`ctx.typertGateway.stream(request)`（`dsh-api-gateway/lib/types/index.js:266-294`；README.zh.md:39）+ 自建 in-process Peer `ctx.connection.createPeer({principal:{kind:'owner'}, interactions:'none'})`（`app.asar!.../dsh-client-connection/lib/index.js:751-754`，`@byte 22,743,947`；`.../README.zh.md:49`）。请求对象需要 `{namespace, method, args, signal, peer}`（装配读这些字段：`dsh-api-gateway/lib/types/index.js:554-559`；一元信封构造 `remoteRequest` 返回同形，同文件 910-926）。这是**最干净的一条**：不新开端口、不碰 WebSocket、不需要改 DSH。
2. **端点自己开 WebSocket 客户端**连本机 `/api/remote.mux`：技术上存在（`dsh-client-connection/lib/client.node.js:456-458, 530-531`，`@byte 22,720,700`），但需要带 cookie 的握手；Node 全局 `WebSocket` 不支持自定义 `Cookie` 头，官方非页面载体靠 shell 注入 `createWebSocket`（同 README.zh.md:30,34）。**不推荐**。
3. **端点用 `ctx.webServer.registerUpgrade` 直接给面板开推送**：`registerUpgrade` 是公开 API（`app.asar!.../dsh-host-webserver/README.zh.md:61`，`@byte 82,354,628`；`.../lib/index.js:326-345`，`@byte 82,365,731`），但握手与帧格式要插件自己实现，而且浏览器面板在 relay 场景下根本连不到对端。**只适合直连部署，不推荐当主方案。**

**推荐形态**：端点侧（1）持有 follow 流 → 缓存帧 → 插件自己的 `/cloud-control/v1/events` 长轮询把增量交给控制器 → 面板长轮询 `/api/cloud-control/events`。relay 的长轮询已经存在（`lib/endpoint.mjs:108-118`，hub `take(waitMs)` 上限 30s；`lib/config.mjs:98` `waitMs` 默认 25000），可以直接复用这套「请求挂起等数据」的骨架。

---

## 3. 投影与列表字段、写者占用、富内容

### 3.1 `session/projections`

- 请求 `{request:{sessionId}}`，响应 `null | {kind:'sequenced', asOfSeq, values} | {kind:'migration-required', values}`（`typert.host.js:1749-1780, 2894-2895`；`SessionProjectionBaseline` 2878-2879）。
- `values` 是**开放记录**：`SessionProjectionValues = Partial<SessionProjectionMap> & Readonly<Record<string, SessionProjectionValue>>`（`typert.host.js:2906-2907`），即字段取决于部署挂了哪些投影插件。`SessionProjectionMap` 声明的全集（`typert.host.js:2886-2887`）：

  `inbox`、`workingDirectory`、`agentPreset`、`title`、`todos`、`sessionListMetadata`、`imageLimits`、`modelSelection`、`permissions`、`subagentCatalog`、`subagentTiming`、`subagent`、`tokenUsage`、`contextPressure`、`contextBreakdown`、`agentTeam`、`userQuestions`、`goal`、`plan`。

- `title` 语义：最新一条 `session/title` 事件的文本（last-wins），首条标题前为 `null`（`typert.host.js:1664` 内 `title` 描述）。
- `sessionListMetadata` = `{blank: boolean, lastPromptAt: number|null}`（`typert.host.js:2846-2847`；折叠规则见 `.../lib/types/list.js:27-36`）。
- 实测（Lead）在 NAS 上见到的 `values` 键：`title, goal, tokenUsage, contextPressure, contextBreakdown, inbox, sessionStats, turnOutline`——`sessionStats` / `turnOutline` 正是「未在 `SessionProjectionMap` 里、由其他投影插件贡献」的开放键。
- `asOfSeq` 是**该 values 块的水位**：`kind:'sequenced'` 时与同一连接的 baseline/frame 可比，`kind:'cached'`（列表里的冷缓存块）不可比（`typert.host.js:1664` 内 `projections.kind` 描述；`list.js:271-302`）。
- 注意：**`running` / `blank` / `agentAvailable` 不是 projection 字段**，它们是 `session/list` 行的字段（见 3.2），其中 `blank` 的同名值同时存在于 `sessionListMetadata` 投影里。

### 3.2 `session/list` 的 items 字段全集

声明 `SessionSummary`（`typert.host.js:2966-2968`）：

| 字段 | 类型 | 语义/实现 |
|---|---|---|
| `sessionId` | string | 会话 id |
| `updatedAt` | number | `max(header.createdAt, sessionListMetadata.lastPromptAt ?? 0)`（`list.js:316-318`） |
| `running` | boolean | `agents.get(id)?.status === 'running'`；冷行为 `false`（`list.js:101, 155`） |
| `agentAvailable` | boolean | 该会话当前是否持有 live Agent；冷行 `false`（`list.js:99, 153`） |
| `blank` | boolean | `sessionListMetadata.blank ?? session.seq === 0`（attached）/ `?? false`（cold）（`list.js:102, 157`） |
| `formatStatus` | `'current' \| 'migration-required'`? | attached 恒为 `'current'`，冷行的持久化状态（`list.js:100, 154`） |
| `parentSessionId` | string? | 来自 header.parentSession（`list.js:319-324`） |
| `origin` | `'subagent'`? | 子会话标记（同上） |
| `cwd` | string? | 工作目录（同上） |
| `projections` | `{kind:'cached'\|'sequenced', asOfSeq, values}`? | 列表 hint；冷行走持久化 projection cache（`list.js:271-302`；`typert.host.js:2882-2883`） |

- 排序：`updatedAt` 降序（`list.js:144`）。
- 请求参数名是 `_request`（`typert.host.js:1641`），schema 里有一个可选 `cursor`（`typert.host.js:1648, 2850-2851`），但 **Host 实现 `list()` 只接收 `signal`，没有用 cursor 分页**（`list.js:112-146`）——即当前版本 `session/list` 一次返回全部可见行。「cursor 是否在别的部署里生效」列入未验证。
- 插件已消费的字段：`sessionId/title/running/blank/agentAvailable/updatedAt/cwd/asOfSeq`（`lib/controller.mjs:288-297`），并**主动过滤掉** `parentSessionId !== undefined || origin === 'subagent'` 的行（`lib/controller.mjs:286-287`）——所以今天的面板看不到子会话行。

### 3.3 `session/prompt`：accepted 语义、queue/steer、writer-held

- 形状：`{requestId, sessionId, mode:'queue'|'steer', content:[{type:'text',text}|{type:'image',mediaType,data,name?}|{type:'file',receiptId}], clientTimeZone?}` → `{accepted: true}`（`typert.host.js:1782-1813, 2910-2915`；response 的 `accepted` 是 `const true`，不是任意布尔）。
- 端点描述明确写着 "Admit one prompt **after explicitly resuming** its Session"（`typert.host.js:1784`）——**prompt 会显式恢复冷会话**，因此它也可能撞上写者占用。
- **accepted 语义**（`.../lib/types/commands.js:302-350`，`@byte 20,870,382`）：
  1. 先 `resolveAgent`；
  2. `hasPromptRequest(agent, requestId)` 为真 → 直接 `{accepted:true}`，**不重复插入消息**（去重，304-305；README.zh.md:34 同样表述）；
  3. 有图片时校验当前模型 `inputModalities` 是否含 `image`，否则 `session/attachment-invalid`（311-317）；
  4. `file` part 用 `receiptId` 经 `ctx.fileUploads.resolve` 换持久引用（318）；
  5. 附件准入失败 → `session/attachment-invalid`；其它失败 → `session/agent-busy: prompt rejected`（339-346）。
  - 也就是说 `accepted:true` 只表示「已受理并入队/注入」，**不表示开始执行、更不表示成功**。插件把这个语义原样透传（`lib/session-api.mjs:83-94` → `lib/controller.mjs:138-147`）。
- **queue vs steer**：实现就是 `agent.steer(message)` vs `agent.followup(message)`（`commands.js:325-328`）；官方 Client 的 JSDoc 定义得最清楚：**"queue appends after the current turn; steer interrupts it"**（`.../lib/types/client/sessions/session.js:166-169`，`@byte 20,825,241`）。对已排队项的 `updateQueue{action:{kind:'steer'}}` 还要求目标是 `next-turn` 且 agent 正在运行，否则 `session/steer-unavailable`（`commands.js:433-435`）；`edit` 只接受非空纯文本（`commands.js:396-403`）。
- **writer-held**：resume 时若已有写句柄占用（`SessionAlreadyOwnedError`），返回 `session/writer-held`（错误码 + `sessionId` details，`.../lib/types/agent.js:243-245`，`@byte 20,690,822`；README.zh.md:65）。它的影响面是：**读不受影响，写（prompt/cancel/rename/updateQueue/selectModel）可能被拒**；而 `session/page`、`session/projections`、`session/attachment` 都是冷安全的只读路径（README.zh.md:34）。
- `session/cancel`：只结束当前 active turn，**保留 pending inbox**（`typert.host.js:1458-1488`；`commands.js:461-469`），结果同样是 `{accepted:true}`。

### 3.4 富内容：官方途径（⇒ 占位符是插件限制）

| 内容 | 官方读法 | 证据 |
|---|---|---|
| 图片字节（历史里的用户图/工具图） | `session/attachment {sessionId, attachmentId}` → `{attachment: ImageAttachmentRef, data: <base64>}`；Host 先校验该图片确实被此会话日志引用，再读字节（不存在/损坏/被替换都会报 `session/attachment-invalid`） | `typert.host.js:1426-1455, 2766-2771`；`commands.js:361-389` |
| 图片块的 id 从哪来 | 事件里的 `image` 内容块：`ImageBlock { type:'image', attachment: ImageAttachmentRef{attachmentId, mediaType, bytes, width, height, name?, originalDimensions?}, offloaded? }` | `typert.host.js:2422-2432`；`ContentBlockMap` 2306-2311 |
| 文件附件 | `file` 块：`FileBlock { type:'file', attachment: FileAttachmentRef{attachmentId, name, bytes} }`；模型侧拿到的是只读宿主路径的句柄文本，不是字节 | `typert.host.js:2358-2364`；`app.asar!.../dsh-attachment/README.zh.md:40,71,105`（`@byte 22,384,396`） |
| 任意工作区/临时文件字节 | 官方 Host 路由 `GET|HEAD /api/file?path=<绝对路径>`（鉴权 `connection.fetch`，20MiB 上限，忽略 Range，`private,no-store` + 沙箱 CSP） | `app.asar!.../dsh-api-session-controller/lib/types/media-references.js:65-75`（`@byte 20,980,263`）；README.zh.md:87 |
| 工具参数/结果全文/失败/meta | `tool/call.data = {turn,step,callId,name,arguments}`；`tool/result.data = {turn,step,message:ToolResultMessage,error?,meta?}`，控制器**原样透传**，不解析工具定义、不跑展示转换器 | `typert.host.js:2807`（SessionEventMap）；`3166-3167`（ToolResultMessage）；README.zh.md:30 |
| reasoning | `assistant/message.data.message.content` 里的 `reasoning` 块；另有带时间戳的紧凑流 `AssistantStreamRecord`（`text-chunks`/`reasoning-chunks`/`tool-call-chunks`/`chunk`） | `typert.host.js:2306-2311, 2258-2259`；实测（Lead）：`assistant/message` content 同时含 reasoning/text/tool-call |
| 子会话记录 | `session/page`/`session/follow` 接受 `{kind:'subagent', parentSessionId, childSessionId, mode}`；父会话日志里也有 `subagent/catalog`、`subagent/descriptor` 等事件；官方 UI 用 `subagentCatalog` 投影做目录、按精确地址打开子会话对话 | `typert.host.js:1729, 2750-2751, 2886-2887, 3022-3023`；`app.asar!.../dsh-client-ui-subagent/README.zh.md:28-36`（`@byte 47,768,554`）；`dsh-tool-subagent/README.zh.md:98-100, 227`（`@byte 97,458,754`） |
| 整档导出（含子会话 + 附件） | `GET /api/session.export?sessionId=<id>&includeDescendants=true`（鉴权 Fetch 路由，流式 ZIP；图片 `media/<attachmentId>.<ext>`，文件 `files/<digest>/<name>`） | `app.asar!.../dsh-session-log-export/README.zh.md:55,60,80`（`@byte 92,181,033`） |

**判定：`lib/transcript.mjs` 把 `image`/`file` 块降级成 `[image]`/`[file]` 是插件自设限制**，源码里也自认（`lib/transcript.mjs:15-16`「intentionally lossy: images and file references become placeholders because v1 carries text only」、`109-121` 的 `textOf` 只处理 text/reasoning/image/file 四类并把后两类变成占位符）。协议侧既有图片字节接口，也有文件读取路由。

---

## 4. 展示保真度矩阵（能力 × 现状 × 可达成）

图例：✅ 已支持 / 🟡 部分支持 / ❌ 缺失。「可达成」列默认**不需要改 DSH 源码**。

| 能力 | 协议 | 插件现状 | 证据（现状） | 可达成 | 备注 |
|---|---|---|---|---|---|
| 用户消息文本 | ✅ | ✅ | `lib/transcript.mjs:33-44` | 保持 | 插件还额外带出 `data.source.kind` |
| 助手消息文本 | ✅ | ✅ | `lib/transcript.mjs:45-58` | 保持 | 单行截断 32000 字符（`:2, 183`） |
| reasoning 块 | ✅ | ✅（抽成 `reasoning` 字段） | `lib/transcript.mjs:47, 129-138` | 保持 | 与正文一起截断 |
| 工具调用参数 | ✅ | 🟡 压成单行 1200 字符 | `lib/transcript.mjs:59-69, 173-176` | 可展开全文 | 参数是 `string`，本身就是 JSON 文本 |
| 工具结果全文 | ✅ | 🟡 只取 text 块且 32000 截断；`data.meta` 全丢 | `lib/transcript.mjs:70-83, 109-121` | 直接可达 | 官方原样透传 meta |
| 工具失败信息 | ✅ | 🟡 只显示 `error.message`/JSON | `lib/transcript.mjs:72-81, 146-153` | 直接可达 | `tool/result.data.error` 有 `name/code/reason` |
| 助手 `usage`（token） | ✅ | ❌ | `toRows` 未读 `event.data.usage` | 直接可达 | `assistant/message.data.usage?: TokenUsage`（`typert.host.js:2807, 3130-3131`） |
| turn/step 边界 | ✅ | ❌ 被 default 丢弃 | `lib/transcript.mjs:84-85` | S 级可达 | 影响分段、耗时、步骤归属 |
| turn 结束原因（completed/aborted/error/max-tokens/interrupted/blocked/forked） | ✅ | ❌ | 事件 `turn/end.reason`（`typert.host.js:3182-3183`）；`toRows` 不处理 | S 级可达 | **这是「中断/失败」的权威记录**；`assistant/message.interrupted` 只在有内容的中断分支写入（`dsh-agent-loop/lib/index.js:1098-1112`） |
| 失败/重试的 `assistant/attempt` | ✅ | ❌ | `toRows` 只认 `assistant/message` | S 级可达 | 官方 UI 用它显示重试/失败过程 |
| 审批请求/决定（`approval/asked|decided`） | ✅（页面里就是事件） | ❌ | `toRows` 未处理 | S 级可达（只读展示） | 想「远程点批准」还需要 `approval/request` waterfall（`remote-events.js:18`），那要 mux |
| todo/plan/goal/压缩事件 | ✅ | ❌（只读 title 等投影） | `session/title`、`todo/write`、`plan/mode`、`goal/change`、`compaction/*` 均在持久日志里 | S 级可达 | 也可走 `session/projections` 的 `todos/plan/goal` |
| 图片（用户/工具产出的图块） | ✅ | ❌ → 占位 `[image]` | `lib/transcript.mjs:117` | M 级可达：`session/attachment` + 面板 `<img>` | 大图/多图需要限流与缓存 |
| 文件附件卡 | ✅ | ❌ → 占位 `[file]` | `lib/transcript.mjs:118` | M 级可达（下载需端点加 `/api/file` 代理） | `/api/file` 只按绝对路径读 |
| 子会话行 + 子会话内容 | ✅ | ❌（列表里被过滤，日志里当普通工具行） | `lib/controller.mjs:286-287`；`toRows` 不区分 subagent 工具 | M 级可达：列表放开 + subagent 地址翻页 | 需要 UI 上的「进入子会话」动作 |
| 实时逐字（token 级） | ✅ 仅 `session/follow` + `assistantStream` | ❌（2s 轮询，只能等整段落盘） | `lib/config.mjs:81`；`client.js:353-391` | L 级可达：见 5.2（P3）/第 6 节阶段 C | 需端点侧流桥 |
| 近实时（事件级，无逐字） | ✅ | 🟡 2s 轮询 | 同上 | M 级可达：长轮询桥 | 工具调用/结果可秒级可见 |
| 会话列表 running/blank/agentAvailable | ✅ | ✅ | `lib/controller.mjs:288-297` | 保持 | 列表 TTL 4s；`running` 用列表行而非投影 |
| 向后翻页（load older） | ✅ | ✅（`beforeSeq`） | `lib/controller.mjs:92, 107`；`client.js:421-445` | 保持 | 实测印证 106..158 |
| go-forward 增量 | ✅ 仅 follow | 🟡 尾部窗口 + seq 去重 | `client.js:400-409` | 见 5.1/5.2 | 一元面没有 afterSeq |
| 消息搜索 | ✅ `session/search`（仅 `user/assistant` 文本片段，有上限） | ❌ | `typert.host.js:1847-1878, 2934-2943`；`list.js:168-269` | S 级可达 | 返回 `{items:[{sessionId,snippet}],hasMore}` |
| 整档导出（会话树 + 附件） | ✅ `/api/session.export` | ❌ | `dsh-session-log-export/README.zh.md:55,60` | M 级可达（端点代理下载） | 见 7.5 未验证 |

### 4.1 `toRows` 的两个额外风险（现状正确性，不只是保真度）

1. **没有按 `surfaceOp === 'append'` 过滤历史替换副本。** 官方明确：人类 transcript 要用 append-origin 事件，替换副本是「model-only」（`app.asar!.../dsh-session/lib/types/surface.js:39-52`，`@byte 94,006,098`；`.../dsh-session/README.zh.md:46,50,161`，`@byte 93,799,751`）。`session/page` 返回的 records 里包含替换事件（`surfaceOp: {op:'replace', startSeq, endSeq}` 的 `user/message`/`assistant/message`/`tool/result`），而 `toRows` 无条件映射它们（`lib/transcript.mjs:32-83`），所以压缩/替换之后面板可能同时显示旧内容与被替换后的新副本。修复：加一条 `event.surfaceOp` 判定。
2. **静默丢事件无提示。** `default: break`（`lib/transcript.mjs:84-85`）让未知/未映射事件无声消失；对包含 `request/header` 携带的大量工具 schema 来说这是优点，但至少应对 `turn/end.reason`、`approval/*` 这类「读者会关心」的事件做显式映射或计数。

### 4.2 对实测第 5 条的正面回答：丢掉 `step/*`、`turn/*` 会不会损失可读信息

**会，而且丢的正是「当前正在发生什么」这一类信息**（实测数据里这些事件确实存在）：

- **`turn/end` 是中断/失败的权威记录**：`turn/end.data.reason` 取值 `completed | aborted | blocked | error | max-tokens | interrupted | forked`（`typert.host.js:3182-3183`）。`assistant/message` 只在「被中断但已攒到内容」的分支才带 `interrupted: true`（`dsh-agent-loop/lib/index.js:1096-1112`），**没有内容的中断/失败只留下 `assistant/attempt` + `turn/end`**——这两个 `toRows` 都不映射。面板顶多能从列表行的 `running` 位判断「会话还在不在跑」（`lib/controller.mjs:113, 293`），但说不出「这一轮为什么停下、是完成还是被中断/报错/达到 token 上限」。
- **`step/start` + `step/end` 是分段与耗时归属的骨架**：官方 UI 用它们把 reasoning、工具行、正文分组（`app.asar!.../dsh-client-ui-chat/README.zh.md:93,104`，`@byte 23,677,867`），子代理目录还用轮次耗时与结束状态展示进度（`app.asar!.../dsh-client-ui-subagent/README.zh.md:36,66`，`@byte 47,768,554`）。丢弃后插件只能把所有行平铺，无法回答「这一步用了多久/是哪一步的工具」。
- **`assistant/message.data.usage` 被丢弃**：token 统计随之丢失（`typert.host.js:2807, 3130-3131`）。
- **`approval/asked|decided` 被丢弃**：远端读者看不到「这里在等审批」，只会看到流程卡住。想要「远程点批准」还需要 `approval/request` waterfall 事件（`remote-events.js:18`），那条只在 mux 上。
- **`compaction/*`、`goal/change`、`plan/mode`、`todo/write`、`job/*`、`subagent/*` 同样被丢弃**（`KNOWN_SESSION_EVENT_TYPES` 全集见 `dsh-session/lib/types/known-event-types.js:21-84`）。

这些事件**都已经在 `session/page` 的返回里**（`history.js:119-123, 439-441` 逐条 `entryFor`），不需要任何新端点就能展示，属于第 6 节阶段 A 的纯映射工作。

---

## 5. 增量与实时性方案对比

### 5.0 先把「go-forward」说清楚

- `session/page` 只有 `throughSeq`（包含式头部截断）与 `beforeSeq`（不包含式尾部上界）两个位置参数；**不存在 `afterSeq`/`cursor`/`exclusive`**（`typert.host.js:1716-1747, 2874-2875`；`history.js:318-347, 395-396`）。
- 官方唯一的 go-forward 通道是 `session/follow` 流：opening snapshot 给出 `cursor`，其后每条 `{type:'event'}` 都是 `cursor+1, cursor+2, …` 且必须连续（`history.js:201-252`）。follow 的 wire 请求**没有 cursor 字段**，重连=重开 follow + tail page 修缺口（`transport.js:74-112`）。
- 因此一元面上「从 seq N 之后取新事件」的准确表述是：**「用最新 throughSeq 取尾部页，再按 `seq > N` 过滤/去重」的近似**，且尾部页一定覆盖到最新（前提：`throughSeq` 取自当前 `asOfSeq`，且不超过 cursor）。

### 5.1 轮询 payload 优化（现状可立即做，S）

当前每次轮询固定 1×`projections` + 1×`page`（`lib/controller.mjs:91-107`），实测单页可达 ~300–360KB。建议：

1. **`asOfSeq` 门控**：先只发 `session/projections`（小），`asOfSeq` 未变就**不发 page**。当前 `history` 路由即使没有新事件也照发 page（`lib/controller.mjs:95-107`），这一条就能把「空轮询」的流量砍掉。
2. **缩小 page 窗口**：请求里带 `turnWindow:{minMessages:1,minTurns:1}` + `maxMessages:1`（当前插件根本不发 `turnWindow`，见 `lib/session-api.mjs:62-75`）。扫描在「计到 ≥1 条 append-surface 消息后的第一个 `turn/start`」处切，能把窗口压到**当前轮**而不是默认的 ~50 条消息跨度（`history.js:59-60, 400-408`；当前轮尚无消息时会退到上一轮起点）。注意 `minMessages ≤ maxMessages` 且都 ≥1（`history.js:333-346`）。
3. **控制器侧先过滤再回传**：把 `seq <= lastSeenSeq` 的 records 丢掉再 `toRows`，面板就只收到新行（省的是本机→浏览器的字节，不是对端→本机的字节）。
4. **剥掉不展示的重字段**：`records` 里 `assistant/message.data.stream`（逐 token 数组）、`request/header.data.header.tools`（工具 schema）、`request/context` 往往是单页体积大头。可以在控制器侧对「不映射事件」直接不序列化——注意这要求 `toRows` 之前先按 seq 过滤，不能改变 `throughSeq/hasMore` 语义。
5. **降低轮询频率而不是提高**：面板已有 1s 下限（`client.js:353`）；空转 2s、有新事件时才在 200–500ms 内连续追几帧，是性价比更高的策略。
6. **relay 场景合并请求**：relay 每次调用都要 hub 入队 → spoke 轮询 → 回投（`lib/peer.mjs:49-60`，`lib/relay-hub.mjs`），一次 history 轮询 = 2 次方法调用 × relay 往返。近实时方案（5.2）能把它压成一条挂起的长轮询。

### 5.2 方案对比表

| # | 方案 | 数据来源 | 端到端延迟 | 每次流量 | 改动面 | 工作量 | 需改 DSH | 风险/限制 |
|---|---|---|---|---|---|---|---|---|
| P0 | 现状：2s 轮询整页 | `session/page` | 轮询间隔 ~2s（最坏 +RTT） | ~200–400KB/次 | — | — | 否 | 空转也发全页；无逐字 |
| P1 | P0 + `asOfSeq` 门控 + `turnWindow` 小窗 + seq 过滤 | `session/projections` + `session/page` | ~2s（可降到 0.5–1s） | 空转 ≈ projections（<几 KB）；有新增 ≈ 当前轮 | `lib/controller.mjs`、`lib/session-api.mjs`、`client.js`、`lib/config.mjs` | **S** | 否 | 仍是消息对齐窗口，`maxMessages` 不是硬上限（实测 8→55 条） |
| P2 | **端点侧 in-process `session/follow` + 两端长轮询**（事件级推送） | `session/follow`（`ctx.typertGateway.stream` + `ctx.connection.createPeer`） | ≈ RTT（LAN 十毫秒级；relay ≈ 一次 relay 往返，受 `relay.waitMs`/`requestTtlMs` 限制） | 仅新事件（通常 <10KB/次） | 新增 `lib/follow.mjs`；`lib/endpoint.mjs`、`lib/controller.mjs`、`lib/session-api.mjs`、`client.js`、`index.js` | **M–L** | 否（源码可证） | `typertGateway` 必须被组合；流的生命周期/背压/缺口重建要自己做；relay 挂起时长受 `requestTtlMs`(30s) 与 `waitMs`(25s) 约束 |
| P3 | P2 + `assistantStream: true`（token 级逐字） | `session/follow` 的 `assistant-stream` 帧 | ≈ RTT（帧级） | 帧很小但频繁 | P2 + 面板瞬态行渲染 | **L** | 否 | 需实现「瞬态 assistant/live-chunk ↔ 持久 cursor 之间排序」的合并逻辑（官方客户端逻辑见 `transport.js:74-112`、README.zh.md:54） |
| P4 | 端点自建 WebSocket 推送 | `session/follow` + `ctx.webServer.registerUpgrade` | 最低 | 仅新事件 | `lib/endpoint.mjs` + 手写握手/帧 + 面板 WS | **L** | 否 | 面板需直连对端：**relay 场景不可用**；还要自己定鉴权（token 只能进 query） |
| P5 | 富内容读取（图片/文件/导出） | `session/attachment`、端点代理 `/api/file`、`/api/session.export` | 按需（点击加载） | 图片/文件大小 | `lib/session-api.mjs`、`lib/endpoint.mjs`、`lib/controller.mjs`、`lib/transcript.mjs`、`client.js` | **M** | 否 | `/api/file` 需绝对路径 + 端点侧 cookie 代理；导出 ZIP 未实测 |
| P6 | 保真修复（不新增端点） | 现有 page records | 不变 | 略增 | `lib/transcript.mjs`、`client.js` | **S** | 否 | 纯展示层；建议与 P1 一起做 |

**建议路线**：**P6 + P1 先落地**（S，立刻把「内容看得全、看得准、流量可控」做出来）→ **P2**（M–L，拿到秒级推送）→ 视需要 **P3**（逐字）。P4 只有在「所有 peer 都直连」的部署里才有意义。

---

## 6. 最小实现清单（要改哪些文件）

> 本轮取证任务不改任何代码；以下为后续实现的落点。写范围提醒：`lib/local-rpc.mjs`、`lib/peer.mjs`、`test/local-rpc.test.mjs` 当前由其他成员改动，下列清单刻意不包含它们。

### 阶段 A（S，先做：保真 + 流量）
1. `lib/transcript.mjs`
   - 只映射 `event.surfaceOp === 'append'` 的可视事件（或至少跳过 `surfaceOp: {op:'replace'}`），修掉历史替换副本重影。
   - 新增行类型：`turn`（`turn/end.reason`：completed/aborted/blocked/error/max-tokens/interrupted/forked，`typert.host.js:3182-3183`）、`step`、`approval`、`attempt`（失败/重试）、`usage`。
   - `image`/`file` 块不再降级成占位符，而是输出 `{kind:'image', attachment}` / `{kind:'file', attachment}`，保留 `attachmentId/mediaType/bytes/width/height/name`（`typert.host.js:2422-2432, 2358-2364`）。
   - 工具结果保留 `data.meta`、`data.error.{name,code,reason}`（`typert.host.js:2807`）。
2. `lib/controller.mjs`
   - `history` 路由：`asOfSeq` 未变化时跳过 `page`；`page` 请求带 `turnWindow`；按 `seq > lastSeen` 过滤后再 `toRows`。
3. `lib/session-api.mjs`
   - `page()` 透传可选 `turnWindow`；新增 `attachment(peerId, sessionId, attachmentId)`（`typert.host.js:1426-1455`）。
4. `lib/config.mjs`
   - `DEFAULT_ALLOW_METHODS` 增加 `session/attachment`（`session/follow` 不要加：一元转发必然 `gateway/signature-invalid`）；可选新增 `historyWindow` / `realtime` 配置。
5. `client.js`
   - 增量合并：按 seq 去重（已有）+ 只把新行追加；新增 `/api/cloud-control/attachment` 图片渲染路径（懒加载）。

### 阶段 B（M，近实时）
6. 新增 `lib/follow.mjs`（端点侧）：用 `ctx.typertGateway.stream({namespace:'session', method:'follow', args:{request:{address, assistantStream?}}, peer, signal})` 打开流（`dsh-api-gateway/lib/types/index.js:266-294, 554-559`），Peer 由 `ctx.connection.createPeer({principal:{kind:'owner'}, interactions:'none'})` 创建（`dsh-client-connection/lib/index.js:751-754`）；用环形缓冲保存最近 N 个 `{type:'event'}` 帧与 `nextSeq`。
7. `lib/endpoint.mjs`：新增 `POST /cloud-control/v1/events`（带 `wait`，复刻 `/relay/poll` 的挂起-唤醒骨架，`lib/endpoint.mjs:108-118`），返回 `{frames, nextSeq}` 或空。
8. `lib/controller.mjs`：新增 `GET /api/cloud-control/events`，把面板长轮询转成对端的长轮询；保留 history 轮询作为降级路径（对端不支持时自动回退）。
9. `client.js`：事件循环（长轮询 + 断线退避），把事件帧交给 `toRows` 的增量入口；保留 P1 轮询兜底。
10. `index.js`：`inject` 增加可选 `typertGateway`（或用 `ctx.get('typertGateway')` 判空），把新 deps 传给 `registerEndpoint`。

### 阶段 C（L，逐字）
11. `lib/follow.mjs` / `client.js`：`assistantStream: true`，把 `{type:'assistant-stream', frame:{type:'start'|'chunk'|'end', ...}}`（`typert.host.js:2762-2763`）合并进一个瞬态行，`end.outcome.kind==='committed'` 时由持久 `assistant/message` 接班；`abandoned` 时撤掉瞬态行（语义见 `dsh-api-session-controller/README.zh.md:54`）。

---

## 7. 未验证项

1. **`ctx.typertGateway.stream()` + `ctx.connection.createPeer()` 的进程内 follow 未实测。** 源码可证两者存在且签名匹配（`dsh-api-gateway/lib/types/index.js:266-294, 554-559`；`dsh-client-connection/lib/index.js:751-754`；README.zh.md:39,49），但「任意 Host 插件在真实部署里都能拿到 `typertGateway` 服务、并以 owner Peer 打开 `session/follow`」这一点尚未在 NAS 上跑通。
2. **在 relay 模式下把长轮询挂在 `requestTtlMs`（默认 30s）与 `waitMs`（默认 25s）之内的实际端到端延迟**未实测（`lib/config.mjs:98-100`）。
3. **`turnWindow:{minMessages:1,minTurns:1}` + `maxMessages:1` 到底能把 page 压到多少字节**未实测；Lead 的 `maxMessages:8 → 55 条/360KB` 只证明 `maxMessages` 不是条数上限，不能直接外推。
4. **`session/list` 的 `cursor` 参数是否有任何部署真正实现分页**未验证：本机 0.2.1-rc.2 的实现没有使用它（`list.js:112-146`）。
5. **`/api/session.export` 能否由插件端点用 minted cookie 代理**未实测（路由是鉴权 Fetch 路由，ZIP 为流式响应：`dsh-session-log-export/README.zh.md:80,88`）。
6. **`image/offload`（图片卸载/压缩）之后 `session/attachment` 是否仍能取回原图**未验证：`image/offload` 是已知事件类型（`dsh-session/lib/types/known-event-types.js:43`）且属于「需要显式纯解释器」的模型投影事件（同文件 86-88，`@byte 93,987,367`），本次未取证 `dsh-compaction-image-offload` 的行为。
7. **`assistantStream: true` 在「非 Web 客户端」语境下的语义**未验证：schema 把该字段约束为 `const true` 且描述为 "process-local assistant presentation frames for the Web client"（`typert.host.js:1568`），插件以 owner Peer 进程内调用时是否等价，需要实测。
8. **Node 侧 WebSocket 客户端携带认证 Cookie 的可行实现**未验证（P4 方案的先决条件）；官方非页面载体依赖 shell 注入的 `createWebSocket`（`dsh-client-connection/README.zh.md:30,34`），不是插件可直接复用的东西。
9. **字段漂移风险**：本报告基于本机 `@deepseek-ai/dsh-* 0.2.1-rc.2`（`app.asar!dsh/package.json`）；Remote 面有版本化 (`session/*` 的 jsDoc/`sourceLocation` 指向 `packages/api/session-controller/src/index.ts`)，跨版本升级后需要重新取证。
10. **本报告引用的官方文件都是我为了取证从 `app.asar` 提取到系统临时目录的副本**（未写入工作区）；行号对应提取出的文件内容，字节偏移对应 asar 内文件起点，两者都可复现（解析方法见 `.dev/asar-recon.mjs` 的按字节扫描思路；本次用 asar header 解析 + 按 offset/size 精确切文件，比 indexOf 扫描更稳）。

---

## 附：证据索引（asar 内文件起始字节）

`dataOffset = 4,779,796`；下表 = `dataOffset + file.offset`。

| 归档内路径 | 起始字节 | 大小 |
|---|---:|---:|
| `dsh/node_modules/@deepseek-ai/dsh-api-session-controller/lib/typert.host.js` | 20,102,645 | 365,047 |
| `.../dsh-api-session-controller/lib/types/history.js` | 20,907,944 | 19,450 |
| `.../dsh-api-session-controller/lib/types/list.js` | 20,965,593 | 14,670 |
| `.../dsh-api-session-controller/lib/types/control.js` | 20,900,532 | 3,307 |
| `.../dsh-api-session-controller/lib/types/commands.js` | 20,870,382 | 30,150 |
| `.../dsh-api-session-controller/lib/types/agent.js` | 20,690,822 | 27,724 |
| `.../dsh-api-session-controller/lib/types/media-references.js` | 20,980,263 | 3,215 |
| `.../dsh-api-session-controller/lib/types/client/transport.js` | 20,864,755 | 5,627 |
| `.../dsh-api-session-controller/lib/types/client/sessions/session.js` | 20,825,241 | 38,957 |
| `.../dsh-api-session-controller/README.zh.md` | 19,779,197 | 24,730 |
| `.../dsh-api-gateway/lib/types/stream-protocol.js` | 18,334,855 | 10,542 |
| `.../dsh-api-gateway/lib/types/index.js` | 18,271,957 | 62,622 |
| `.../dsh-api-gateway/README.zh.md` | 17,924,695 | 22,287 |
| `.../dsh-api-remotes/lib/types/remote-events.js` | 19,743,385 | 2,725 |
| `.../dsh-client-connection/lib/index.js` | 22,743,947 | 44,434 |
| `.../dsh-client-connection/lib/client.node.js` | 22,720,700 | 23,247 |
| `.../dsh-client-connection/README.zh.md` | 22,646,905 | 13,194 |
| `.../dsh-host-webserver/lib/index.js` | 82,365,731 | 21,436 |
| `.../dsh-host-webserver/README.zh.md` | 82,354,628 | 11,103 |
| `.../dsh-session/lib/types/surface.js` | 94,006,098 | 26,100 |
| `.../dsh-session/lib/types/known-event-types.js` | 93,987,367 | 2,923 |
| `.../dsh-session/README.zh.md` | 93,799,751 | 20,707 |
| `.../dsh-agent-loop/lib/index.js` | 17,287,418 | 74,599 |
| `.../dsh-attachment/README.zh.md` | 22,384,396 | 10,505 |
| `.../dsh-session-log-export/README.zh.md` | 92,181,033 | 7,686 |
| `.../dsh-client-ui-subagent/README.zh.md` | 47,768,554 | 9,101 |
| `.../dsh-client-ui-conversation/README.zh.md` | 24,446,346 | 29,578 |
| `.../dsh-client-ui-chat/README.zh.md` | 23,677,867 | 27,362 |
| `.../dsh-tool-subagent/README.zh.md` | 97,458,754 | 15,850 |
