window.__ModuleLoader__.load({
  id: 'dsh-cloud-control',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = 'cloudControl';
    const PANEL_ID = 'cloud-control';
    const API_ROOT = 'api/cloud-control/';

    const zh = {
      panel: '云控台',
      title: '远程会话',
      subtitle: '在远端执行，本窗口查看',
      roleController: '控制器',
      peer: '对端',
      peersEmpty: '还没有配置对端。请在本机 profile 的 cordis.patch.yml 里给 cloud-control 增加 peers。',
      endpointOnly: '本实例当前只启用了端点半边（供其他实例调用），没有配置对端。',
      selectPeer: '选择对端',
      sessions: '会话',
      sessionsEmpty: '对端没有可见会话',
      selectSession: '从左侧选择一个会话',
      untitled: '（无标题）',
      running: '运行中',
      idle: '空闲',
      refresh: '刷新',
      loadOlder: '加载更早',
      loading: '加载中…',
      noMore: '没有更早的消息了',
      statusOk: '已连接',
      statusWaiting: '等待对端接入',
      statusError: '连接失败',
      disconnected: '连接中断',
      retry: '重试',
      composerPlaceholder: '发送到远端会话（Enter 发送，Shift+Enter 换行）',
      send: '发送',
      sending: '发送中…',
      queueMode: '排队',
      steerMode: '插入',
      stop: '停止',
      stopped: '已请求停止',
      reasoning: '思考过程',
      user: '你',
      assistant: '助手',
      tool: '工具',
      toolResult: '工具结果',
      emptyMessage: '（空消息）',
      image: '[图片]',
      file: '[文件]',
      error: '出错了',
      dismiss: '知道了',
      loadFailed: '加载失败',
      sendFailed: '发送失败',
      historyUnavailable: '这个会话暂时没有可读的历史游标',
      noPeers: '无对端',
      noCwd: '（未记录工作目录）',
      now: '刚刚',
      minutesAgo: '{n} 分钟前',
      hoursAgo: '{n} 小时前',
      daysAgo: '{n} 天前',
      cancelled: '已停止',
      publicHint: '执行发生在远端 DSH，本机只负责显示与输入。'
    };

    const en = {
      panel: 'Cloud Control',
      title: 'Remote sessions',
      subtitle: 'Execution runs on the remote Host',
      roleController: 'controller',
      peer: 'Peer',
      peersEmpty: 'No peer is configured yet. Add peers to this profile\'s cloud-control row in cordis.patch.yml.',
      endpointOnly: 'This instance only runs the endpoint half (for other instances) and has no peers configured.',
      selectPeer: 'Select a peer',
      sessions: 'Sessions',
      sessionsEmpty: 'The peer has no visible sessions',
      selectSession: 'Pick a session on the left',
      untitled: '(untitled)',
      running: 'Running',
      idle: 'Idle',
      refresh: 'Refresh',
      loadOlder: 'Load older',
      loading: 'Loading…',
      noMore: 'No older messages',
      statusOk: 'Connected',
      statusWaiting: 'Waiting for spoke',
      statusError: 'Connection failed',
      disconnected: 'Disconnected',
      retry: 'Retry',
      composerPlaceholder: 'Send to the remote session (Enter to send, Shift+Enter for a newline)',
      send: 'Send',
      sending: 'Sending…',
      queueMode: 'Queue',
      steerMode: 'Steer',
      stop: 'Stop',
      stopped: 'Stop requested',
      reasoning: 'Reasoning',
      user: 'You',
      assistant: 'Assistant',
      tool: 'Tool',
      toolResult: 'Tool result',
      emptyMessage: '(empty message)',
      image: '[image]',
      file: '[file]',
      error: 'Something went wrong',
      dismiss: 'Dismiss',
      loadFailed: 'Could not load',
      sendFailed: 'Could not send',
      historyUnavailable: 'This session has no readable history cursor yet',
      noPeers: 'No peer',
      noCwd: '(no working directory recorded)',
      now: 'just now',
      minutesAgo: '{n} min ago',
      hoursAgo: '{n} h ago',
      daysAgo: '{n} d ago',
      cancelled: 'Stopped',
      publicHint: 'Execution happens on the remote DSH; this machine only renders and sends input.'
    };

    /*
     * The conversation half mirrors the native Conversation page: same layout
     * variables, radii, type scale and row patterns. Values are copied from the
     * installed client bundles rather than imported, per the plugin authoring
     * contract (a client plugin may not require another Harness client package).
     * Source of the copied values, for the next DSH upgrade:
     *   .-ja1rG_row/.stack/.bubble  — right-aligned user message (ui-goal)
     *   .RlGAzG_root/.dock/.card/.input/.row/.primary — composer chrome
     *   --dsh-chat-content-width    — conversation column (loaded Chat body)
     */
    const CSS = `
      .cc-root{box-sizing:border-box;display:flex;flex-direction:column;height:100%;min-height:0;color:var(--dsw-alias-label-primary);background:transparent;font-size:var(--dsh-content-font-size,14px);line-height:calc(24px + var(--dsh-content-font-delta,0px))}
      .cc-pad{padding-top:var(--dsh-frame-top-clearance,0px)}
      .cc-head{flex:none;display:flex;align-items:center;flex-wrap:wrap;gap:12px;padding:12px 16px 10px;border-bottom:.5px solid var(--dsw-alias-border-l1)}
      .cc-head h1{margin:0;font-size:15px;font-weight:600;line-height:22px}
      .cc-sub{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px}
      .cc-spacer{flex:1;min-width:0}
      .cc-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;font-weight:500;line-height:20px}
      .cc-btn{border:0;border-radius:var(--dsw-radius-sm);padding:5px 11px;cursor:pointer;background:var(--dsw-alias-button-ghost-active-fill, var(--dsw-alias-interactive-bg-hover));color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;transition:background-color .1s}
      .cc-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-solid, var(--dsw-alias-interactive-bg-hover))}
      .cc-btn:disabled{opacity:.5;cursor:default}
      .cc-tabs{flex:none;display:flex;gap:8px;flex-wrap:wrap;padding:10px 16px;border-bottom:.5px solid var(--dsw-alias-border-l1)}
      .cc-tab{display:flex;align-items:center;gap:6px;border:.5px solid transparent;border-radius:999px;padding:4px 12px;cursor:pointer;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;line-height:20px}
      .cc-tab:hover{background:var(--dsw-alias-interactive-bg-hover)}
      .cc-tab-on{border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-fill-l1);color:var(--dsw-alias-label-primary)}
      .cc-dot{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-label-caption);display:inline-block;flex:none}
      .cc-dot-on{background:var(--dsw-alias-state-success-primary)}
      .cc-dot-err{background:var(--dsw-alias-state-warn-primary)}
      .cc-body{display:flex;flex:1;min-height:0}
      .cc-list{width:264px;flex:none;border-right:.5px solid var(--dsw-alias-border-l1);overflow:auto;padding:8px;--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l1);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l1)}
      .cc-group{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;padding:8px 6px 4px;word-break:break-all}
      .cc-session{display:flex;align-items:center;gap:8px;width:100%;text-align:left;border:0;background:transparent;color:inherit;border-radius:var(--dsw-radius-sm);padding:6px 8px;cursor:pointer;font:inherit}
      .cc-session:hover{background:var(--dsw-alias-interactive-bg-hover)}
      .cc-session-on{background:var(--dsw-alias-fill-l2)}
      .cc-session-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .cc-session-meta{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;flex:none}
      .cc-main{flex:1;display:flex;flex-direction:column;min-width:0;min-height:0}
      .cc-conversation{display:flex;flex-direction:column;flex:1;min-height:0;padding:0 16px}
      .cc-scroll{flex:1;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:16px;padding:16px 0 20px;scrollbar-gutter:stable}
      .cc-turn{display:flex;flex-direction:column;gap:12px;width:100%;max-width:var(--dsh-chat-content-width,920px);margin:0 auto}
      .cc-row{display:flex;flex-direction:column;gap:6px}
      .cc-row-user{align-items:flex-end}
      .cc-stack{display:flex;flex-direction:column;align-items:flex-start;gap:6px;min-width:0;max-width:100%}
      .cc-row-user .cc-stack{max-width:min(calc(var(--dsh-chat-content-width,748px) * .702), 82%);align-items:flex-end}
      .cc-bubble{max-width:100%;overflow-wrap:anywhere;white-space:pre-wrap;border-radius:var(--dsw-radius-xl);background:var(--dsw-specific-bubble);color:var(--dsw-alias-label-primary);font-size:var(--dsh-content-font-size,14px);line-height:calc(22px + var(--dsh-content-font-delta,0px));padding:10px 16px}
      .cc-role{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
      .cc-text{white-space:pre-wrap;word-break:break-word;overflow-wrap:anywhere;font-size:var(--dsh-content-font-size,14px);line-height:calc(24px + var(--dsh-content-font-delta,0px))}
      .cc-empty-msg{color:var(--dsw-alias-label-caption)}
      .cc-note{color:var(--dsw-alias-label-caption);font-size:12px;line-height:18px}
      .cc-fold{border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);background:var(--dsw-specific-input-major);overflow:hidden}
      .cc-fold-user{background:var(--dsw-specific-bubble);border-color:transparent;border-radius:var(--dsw-radius-xl);padding:10px 16px}
      .cc-fold-head{display:flex;align-items:center;gap:8px;width:100%;border:0;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;text-align:left;font:inherit;font-size:12px;line-height:18px;padding:7px 10px}
      .cc-fold-user .cc-fold-head{padding:0;color:var(--dsw-alias-label-primary);font-size:var(--dsh-content-font-size,14px)}
      .cc-fold-head:hover{background:var(--dsw-alias-interactive-bg-hover)}
      .cc-fold-user .cc-fold-head:hover{background:transparent}
      .cc-fold-caret{flex:none;color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:1}
      .cc-fold-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .cc-fold-name code{font-family:var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);font-size:12px}
      .cc-fold-tag{flex:none;color:var(--dsw-alias-label-tertiary)}
      .cc-fold-body{margin:0;padding:2px 12px 10px;white-space:pre-wrap;word-break:break-word;overflow-wrap:anywhere;font-family:var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);max-height:280px;overflow:auto;--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l1);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l1)}
      .cc-fold-user .cc-fold-body{padding:8px 0 0;font-family:inherit;font-size:var(--dsh-content-font-size,14px);line-height:calc(22px + var(--dsh-content-font-delta,0px));color:var(--dsw-alias-label-primary);white-space:pre-wrap}
      .cc-fold-error{border-color:color-mix(in srgb, var(--dsw-alias-state-error-primary) 45%, transparent)}
      .cc-fold-error .cc-fold-name{color:var(--dsw-alias-state-error-primary)}
      .cc-fold-running .cc-fold-name{color:var(--dsw-alias-label-primary)}
      .cc-empty{margin:auto;color:var(--dsw-alias-label-tertiary);text-align:center;padding:24px;max-width:460px;line-height:1.6}
      .cc-error{flex:none;display:flex;align-items:center;gap:10px;margin:10px 16px 0;border:.5px solid var(--dsw-alias-state-error-secondary);border-radius:var(--dsw-radius-md);padding:8px 12px;background:var(--dsw-alias-fill-l1);color:var(--dsw-alias-label-secondary)}
      .cc-error-text{flex:1;min-width:0;word-break:break-word;font-size:13px;line-height:20px}
      .cc-composer{flex:none;display:flex;flex-direction:column;align-items:center;padding:0 var(--dsh-composer-side-clearance,16px) 4px}
      .cc-dock{display:flex;align-items:center;justify-content:center;gap:12px;max-width:100%;padding-top:4px}
      .cc-dock:empty{display:none}
      .cc-dock-mode{height:28px;max-width:160px;border:0;outline:none;appearance:none;cursor:pointer;border-radius:var(--dsw-radius-sm);background-color:transparent;color:var(--dsw-alias-label-secondary);font-size:13px;font-weight:500;line-height:20px;padding:0 8px}
      .cc-dock-mode:hover:not(:disabled){background-color:var(--dsw-alias-interactive-bg-hover)}
      .cc-dock-mode:disabled{opacity:.5;cursor:default}
      .cc-card{box-sizing:border-box;position:relative;display:flex;flex-direction:column;gap:12px;width:100%;max-width:var(--dsh-composer-card-max-width,calc(var(--dsh-chat-content-width,748px) + 32px));border-radius:var(--dsw-radius-panel);background:var(--dsw-specific-input-major);box-shadow:var(--dsw-elevation-soft);font-size:var(--dsh-content-font-size,14px);line-height:calc(24px + var(--dsh-content-font-delta,0px));padding-top:8px}
      .cc-input{box-sizing:border-box;display:block;width:100%;min-height:52px;max-height:200px;margin:0;padding:4px 8px 0 14px;resize:none;border:0;outline:none;background:transparent;color:var(--dsw-alias-label-primary);caret-color:var(--dsw-alias-state-business-primary);font:inherit;white-space:pre-wrap;word-break:break-word;overflow-wrap:anywhere}
      .cc-input::placeholder{color:var(--dsw-alias-label-caption)}
      .cc-input:disabled{cursor:not-allowed;color:var(--dsw-alias-label-tertiary)}
      .cc-inputrow{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px;min-width:0;padding:2px 8px 6px}
      .cc-modes{display:flex;align-items:center;gap:12px;min-width:0}
      .cc-pill{display:inline-flex;align-items:center;height:26px;border:0;border-radius:999px;padding:0 10px;cursor:pointer;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:18px}
      .cc-pill:hover{background:var(--dsw-alias-interactive-bg-hover)}
      .cc-pill-on{background:var(--dsw-alias-fill-l2);color:var(--dsw-alias-label-primary)}
      .cc-pill-stop{color:var(--dsw-alias-state-error-primary)}
      .cc-primary{display:grid;place-items:center;flex:none;width:34px;height:34px;border:0;border-radius:999px;cursor:pointer;background:var(--dsw-alias-button-info-fill);color:var(--dsw-alias-label-primary-foreground);transition:background-color .1s}
      .cc-primary:hover:not(:disabled){background:var(--dsw-alias-button-info-hover)}
      .cc-primary:disabled{opacity:.4;cursor:default}
      .cc-hint{width:100%;max-width:var(--dsh-composer-card-max-width,calc(var(--dsh-chat-content-width,748px) + 32px));padding-top:6px;color:var(--dsw-alias-label-caption);font-size:12px;line-height:18px}
    `;

    if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css="dsh-cloud-control/client.js"]') === null) {
      const tag = document.createElement('style');
      tag.dataset.plugin = 'dsh-cloud-control';
      tag.dataset.pluginCss = 'dsh-cloud-control/client.js';
      tag.textContent = CSS;
      document.head.appendChild(tag);
    }

    /**
     * Call one controller route. Every answer is `{ok, ...}` at HTTP 200; the
     * helper turns the failure branch into a typed error for the panel.
     */
    const api = {
      async request(path, options = {}) {
        const url = new URL(API_ROOT + path, document.baseURI);
        for (const [key, value] of Object.entries(options.query ?? {})) {
          if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
        }
        let response;
        try {
          response = await fetch(url, {
            method: options.body === undefined ? 'GET' : 'POST',
            headers: options.body === undefined ? undefined : { 'content-type': 'application/json' },
            body: options.body === undefined ? undefined : JSON.stringify(options.body),
            credentials: 'same-origin',
            signal: options.signal,
            redirect: 'error'
          });
        } catch (error) {
          if (options.signal?.aborted) throw error;
          throw new ApiError('network', String(error && error.message ? error.message : error));
        }
        let body;
        try {
          body = await response.json();
        } catch {
          throw new ApiError('protocol', `HTTP ${response.status}`);
        }
        if (body === null || typeof body !== 'object' || body.ok !== true) {
          const error = body && body.error ? body.error : {};
          throw new ApiError(typeof error.code === 'string' ? error.code : 'failed', typeof error.message === 'string' ? error.message : `HTTP ${response.status}`);
        }
        return body;
      }
    };

    class ApiError extends Error {
      constructor(code, message) {
        super(message);
        this.name = 'ApiError';
        this.code = code;
      }
    }

    /** Icon shown in the sidebar rail. Props: {size, active}. */
    function PanelIcon({ size }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 16 16', 'aria-hidden': true },
        h('circle', { cx: 5.5, cy: 8, r: 3, fill: 'none', stroke: 'currentColor', strokeWidth: 1.4 }),
        h('circle', { cx: 10.5, cy: 8, r: 3, fill: 'none', stroke: 'currentColor', strokeWidth: 1.4 }));
    }

    /** Send glyph for the composer's primary button (artwork, not a themed surface). */
    function SendIcon() {
      return h('svg', { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
        h('path', {
          d: 'M14 8 2.6 2.2a.4.4 0 0 0-.55.47l1.5 5.06a.4.4 0 0 0 .33.27H9a.4.4 0 0 1 0 .8H3.88a.4.4 0 0 0-.33.27l-1.5 5.06a.4.4 0 0 0 .55.47Z',
          stroke: 'currentColor',
          strokeWidth: 1.3,
          strokeLinejoin: 'round'
        }));
    }

    /** Fallback panel-info hook so the component keeps one hook shape. */
    function useFallbackPanelInfo(selector) {
      return React.useMemo(() => selector({ activePanelId: PANEL_ID }), [selector]);
    }

    /**
     * Global panel: peers, their sessions, the transcript of the selected one
     * and a composer. Polling pauses whenever the panel is not the active view.
     */
    function CloudControlPanel(props) {
      const t = props.t;
      const panelHook = typeof props.usePanelInfo === 'function' ? props.usePanelInfo : useFallbackPanelInfo;
      const activePanelId = panelHook((info) => info.activePanelId);
      const panelVisible = activePanelId === PANEL_ID;
      const [documentVisible, setDocumentVisible] = React.useState(() => typeof document === 'undefined' || document.visibilityState !== 'hidden');
      const visible = panelVisible && documentVisible;

      const [state, setState] = React.useState(undefined);
      const [peers, setPeers] = React.useState([]);
      const [peerId, setPeerId] = React.useState(undefined);
      const [sessions, setSessions] = React.useState([]);
      const [sessionId, setSessionId] = React.useState(undefined);
      const [latest, setLatest] = React.useState({ rows: [], throughSeq: undefined, hasMore: false, title: null, running: false });
      const [older, setOlder] = React.useState({ rows: [], hasMore: false, loading: false });
      const [error, setError] = React.useState(undefined);
      const [draft, setDraft] = React.useState('');
      const [mode, setMode] = React.useState('queue');
      const [sending, setSending] = React.useState(false);
      const [notice, setNotice] = React.useState(undefined);
      const [composerExpanded, setComposerExpanded] = React.useState(false);
      const [version, setVersion] = React.useState(0);
      const transcriptRef = React.useRef(null);
      const stickToBottom = React.useRef(true);

      // Stable across renders: effects depend on it, so it must not capture the
      // locale face (whose identity can change when the user switches language).
      const describe = React.useCallback((failure) => {
        const code = failure && failure.code ? failure.code : 'failed';
        const message = failure && failure.message ? failure.message : String(failure);
        return `${code}: ${message}`;
      }, []);

      React.useEffect(() => {
        const onVisibility = () => setDocumentVisible(document.visibilityState !== 'hidden');
        document.addEventListener('visibilitychange', onVisibility);
        return () => document.removeEventListener('visibilitychange', onVisibility);
      }, []);

      const reload = React.useCallback(() => setVersion((value) => value + 1), []);

      // Deployment shape.
      React.useEffect(() => {
        if (!visible) return undefined;
        const controller = new AbortController();
        api.request('state', { signal: controller.signal })
          .then((body) => setState(body))
          .catch((failure) => { if (!controller.signal.aborted) setError(describe(failure)); });
        return () => controller.abort();
      }, [visible, describe, version]);

      // Peers, refreshed on a slow interval.
      React.useEffect(() => {
        if (!visible) return undefined;
        const controller = new AbortController();
        let timer;
        let stopped = false;
        const run = async () => {
          try {
            const body = await api.request('peers', { signal: controller.signal });
            if (stopped || controller.signal.aborted) return;
            setPeers(body.peers ?? []);
            setError(undefined);
            setPeerId((current) => {
              if (current !== undefined && (body.peers ?? []).some((peer) => peer.id === current)) return current;
              return body.peers?.[0]?.id;
            });
          } catch (failure) {
            if (!stopped && !controller.signal.aborted) setError(describe(failure));
          } finally {
            if (!stopped) timer = setTimeout(run, 5000);
          }
        };
        run();
        return () => {
          stopped = true;
          controller.abort();
          clearTimeout(timer);
        };
      }, [visible, describe, version]);

      // Sessions for the selected peer.
      React.useEffect(() => {
        if (!visible || peerId === undefined) {
          setSessions([]);
          return undefined;
        }
        const controller = new AbortController();
        let timer;
        let stopped = false;
        const run = async () => {
          try {
            const body = await api.request('sessions', { query: { peer: peerId }, signal: controller.signal });
            if (stopped || controller.signal.aborted) return;
            setSessions(body.items ?? []);
            setSessionId((current) => {
              if (current !== undefined && (body.items ?? []).some((item) => item.sessionId === current)) return current;
              return body.items?.[0]?.sessionId;
            });
          } catch (failure) {
            if (!stopped && !controller.signal.aborted) setError(describe(failure));
          } finally {
            if (!stopped) timer = setTimeout(run, 5000);
          }
        };
        run();
        return () => {
          stopped = true;
          controller.abort();
          clearTimeout(timer);
        };
      }, [visible, peerId, describe, version]);

      // Transcript of the selected session; this is the fast loop.
      const pollInterval = Math.max(1000, Number(state?.pollIntervalMs) || 2000);
      React.useEffect(() => {
        setOlder({ rows: [], hasMore: false, loading: false });
        stickToBottom.current = true;
        if (!visible || peerId === undefined || sessionId === undefined) {
          setLatest({ rows: [], throughSeq: undefined, hasMore: false, title: null, running: false });
          return undefined;
        }
        const controller = new AbortController();
        let timer;
        let stopped = false;
        const run = async () => {
          try {
            const body = await api.request('history', {
              query: { peer: peerId, sessionId, maxMessages: state?.maxMessages ?? 60 },
              signal: controller.signal
            });
            if (stopped || controller.signal.aborted) return;
            setLatest({
              rows: body.rows ?? [],
              throughSeq: body.throughSeq,
              hasMore: body.hasMore === true,
              title: body.title ?? null,
              running: body.running === true
            });
            setError(undefined);
          } catch (failure) {
            if (!stopped && !controller.signal.aborted) setError(describe(failure));
          } finally {
            if (!stopped) timer = setTimeout(run, pollInterval);
          }
        };
        run();
        return () => {
          stopped = true;
          controller.abort();
          clearTimeout(timer);
        };
      }, [visible, peerId, sessionId, pollInterval, state?.maxMessages, describe, version]);

      // Keep the viewport pinned while new rows arrive, unless the reader scrolled up.
      React.useEffect(() => {
        const node = transcriptRef.current;
        if (node === null || !stickToBottom.current) return;
        node.scrollTop = node.scrollHeight;
      }, [latest.rows, older.rows]);

      const rows = React.useMemo(() => {
        const seen = new Set();
        const merged = [];
        for (const row of [...older.rows, ...latest.rows]) {
          if (seen.has(row.seq)) continue;
          seen.add(row.seq);
          merged.push(row);
        }
        return merged;
      }, [older.rows, latest.rows]);

      const groups = React.useMemo(() => {
        const map = new Map();
        for (const session of sessions) {
          const key = typeof session.cwd === 'string' && session.cwd.length > 0 ? session.cwd : t('noCwd');
          if (!map.has(key)) map.set(key, []);
          map.get(key).push(session);
        }
        return [...map.entries()];
      }, [sessions, t]);

      const loadOlder = React.useCallback(async () => {
        if (older.loading) return;
        const boundary = older.rows[0]?.seq ?? latest.rows[0]?.seq;
        if (boundary === undefined) return;
        setOlder((current) => ({ ...current, loading: true }));
        try {
          const body = await api.request('history', {
            query: {
              peer: peerId,
              sessionId,
              throughSeq: latest.throughSeq,
              beforeSeq: boundary,
              maxMessages: state?.maxMessages ?? 60
            }
          });
          setOlder((current) => ({
            rows: [...(body.rows ?? []), ...current.rows],
            hasMore: body.hasMore === true,
            loading: false
          }));
        } catch (failure) {
          setOlder((current) => ({ ...current, loading: false }));
          setError(describe(failure));
        }
      }, [older.loading, older.rows, latest.rows, latest.throughSeq, peerId, sessionId, state?.maxMessages, describe]);

      const send = React.useCallback(async () => {
        const text = draft.trim();
        if (text.length === 0 || sending || peerId === undefined || sessionId === undefined) return;
        setSending(true);
        setNotice(undefined);
        try {
          const body = await api.request('prompt', {
            query: { peer: peerId },
            body: { sessionId, text, mode, requestId: randomId() }
          });
          if (body.accepted !== true) throw new ApiError('refused', 'the remote Host did not accept the prompt');
          setDraft('');
          setNotice(mode === 'steer' ? t('steerMode') : t('queueMode'));
          reload();
        } catch (failure) {
          setError(`${t('sendFailed')}: ${describe(failure)}`);
        } finally {
          setSending(false);
        }
      }, [draft, sending, peerId, sessionId, mode, describe, reload, t]);

      const stop = React.useCallback(async () => {
        if (peerId === undefined || sessionId === undefined) return;
        try {
          await api.request('cancel', { query: { peer: peerId }, body: { sessionId } });
          setNotice(t('stopped'));
        } catch (failure) {
          setError(describe(failure));
        }
      }, [peerId, sessionId, describe, t]);

      const onComposerKey = (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          void send();
        }
      };

      const onTranscriptScroll = () => {
        const node = transcriptRef.current;
        if (node === null) return;
        stickToBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 48;
      };

      const selectedPeer = peers.find((peer) => peer.id === peerId);
      const selectedSession = sessions.find((session) => session.sessionId === sessionId);
      const heading = selectedSession?.title || latest.title || t('selectSession');
      const running = selectedSession?.running === true || latest.running === true;

      return h('div', { className: 'cc-root cc-pad' },
        h('div', { className: 'cc-head' },
          h('h1', null, t('title')),
          h('span', { className: 'cc-sub' }, state?.displayName ? `${state.displayName} · ${t('subtitle')}` : t('subtitle')),
          h('span', { className: 'cc-spacer' }),
          h('button', { className: 'cc-btn', type: 'button', onClick: reload }, t('refresh'))),
        error !== undefined
          ? h('div', { className: 'cc-error' },
              h('span', { className: 'cc-error-text' }, error),
              h('button', { className: 'cc-btn', type: 'button', onClick: () => setError(undefined) }, t('dismiss')))
          : null,
        notice !== undefined
          ? h('div', { className: 'cc-error' }, h('span', { className: 'cc-error-text' }, notice))
          : null,
        peers.length === 0
          ? h('div', { className: 'cc-empty' }, state?.role === 'endpoint' ? t('endpointOnly') : t('peersEmpty'))
          : h(React.Fragment, null,
              h('div', { className: 'cc-tabs' }, peers.map((peer) => h('button', {
                key: peer.id,
                type: 'button',
                className: `cc-tab${peer.id === peerId ? ' cc-tab-on' : ''}`,
                onClick: () => { setPeerId(peer.id); setSessionId(undefined); }
              },
                h('span', { className: `cc-dot${statusClass(peer.status)}` }),
                h('span', null, peer.label),
                peer.status?.ok === false ? h('span', null, statusText(peer.status, peer.kind, t)) : null))),
              h('div', { className: 'cc-body' },
                h('div', { className: 'cc-list' },
                  sessions.length === 0
                    ? h('div', { className: 'cc-empty' }, t('sessionsEmpty'))
                    : groups.map(([cwd, items]) => h('div', { key: cwd },
                        h('div', { className: 'cc-group' }, cwd),
                        items.map((session) => h('button', {
                          key: session.sessionId,
                          type: 'button',
                          className: `cc-session${session.sessionId === sessionId ? ' cc-session-on' : ''}`,
                          onClick: () => setSessionId(session.sessionId)
                        },
                          h('span', { className: `cc-dot${session.running ? ' cc-dot-on' : ''}` }),
                          h('span', { className: 'cc-session-title' }, session.title || t('untitled')),
                          h('span', { className: 'cc-session-meta' }, timeAgo(session.updatedAt, t))))))),
                h('div', { className: 'cc-main' },
                  h('div', { className: 'cc-head' },
                    h('span', { className: 'cc-title' }, heading),
                    running ? h('span', { className: 'cc-sub' }, t('running')) : null,
                    h('span', { className: 'cc-spacer' }),
                    latest.hasMore || older.hasMore
                      ? h('button', { className: 'cc-btn', type: 'button', onClick: loadOlder, disabled: older.loading }, older.loading ? t('loading') : t('loadOlder'))
                      : null),
                  h('div', { className: 'cc-conversation' },
                    h('div', { className: 'cc-scroll', ref: transcriptRef, onScroll: onTranscriptScroll },
                      sessionId === undefined || rows.length === 0
                        ? h('div', { className: 'cc-empty' }, t('selectSession'))
                        : buildTurns(rows).map((turn) => h(Turn, { key: turn.key, turn, t })))),
                  h('div', { className: 'cc-composer' },
                    h('div', { className: 'cc-dock' },
                      h('button', {
                        type: 'button',
                        className: `cc-dock-mode${mode === 'steer' ? ' cc-pill-on' : ''}`,
                        title: t('composerPlaceholder'),
                        onClick: () => setMode(mode === 'queue' ? 'steer' : 'queue'),
                        disabled: sessionId === undefined
                      }, mode === 'steer' ? t('steerMode') : t('queueMode'))),
                    h('div', { className: 'cc-card' },
                      h('textarea', {
                        className: 'cc-input',
                        value: draft,
                        placeholder: t('composerPlaceholder'),
                        rows: 2,
                        onChange: (event) => {
                          setDraft(event.target.value);
                          setComposerExpanded(event.target.value.trim().length > 0);
                        },
                        onKeyDown: onComposerKey,
                        onFocus: () => setComposerExpanded(true),
                        disabled: sessionId === undefined
                      }),
                      h('div', { className: 'cc-inputrow' },
                        h('div', { className: 'cc-modes' },
                          running
                            ? h('button', { type: 'button', className: 'cc-pill cc-pill-stop', onClick: () => void stop() }, t('stop'))
                            : null),
                        h('div', { className: 'cc-modes' },
                          h('button', {
                            type: 'button',
                            className: 'cc-primary',
                            'aria-label': t('send'),
                            title: t('send'),
                            onClick: () => void send(),
                            disabled: sending || sessionId === undefined || draft.trim().length === 0
                          }, h(SendIcon)))),
                      composerExpanded || running || sending
                        ? h('div', { className: 'cc-hint' }, sessionId === undefined ? t('selectSession') : t('publicHint'))
                        : null))))));
    }

    /**
     * One conversation turn: the user message that opened it plus every row the
     * remote Host produced while answering. Mirrors the native Conversation
     * page, where a turn is the unit the reader follows.
     */
    function Turn({ turn, t }) {
      return h('div', { className: 'cc-turn', 'data-cc-turn': turn.key },
        turn.rows.map((row) => h(Row, { key: row.seq, row, t })));
    }

    /**
     * One non-user transcript row: an assistant message (optionally carrying its
     * reasoning) or a collapsible tool record. Tool results pair with the
     * preceding call through the shared name, so they start collapsed.
     */
    function Row({ row, t }) {
      if (row.role === 'tool') {
        const result = row.kind === 'result';
        const classes = ['cc-fold'];
        if (row.error) classes.push('cc-fold-error');
        if (result) classes.push('cc-fold-running');
        return h('details', { className: classes.join(' '), 'data-cc-row': 'tool' },
          h('summary', { className: 'cc-fold-head' },
            h('span', { className: 'cc-fold-caret', 'aria-hidden': true }, '▸'),
            h('span', { className: 'cc-fold-name' }, h('code', null, row.name ?? t('tool'))),
            h('span', { className: 'cc-fold-tag' }, `${result ? t('toolResult') : t('tool')}${row.error ? ` · ${t('error')}` : ''}`)),
          h('pre', { className: 'cc-fold-body' }, row.text.length > 0 ? row.text : t('emptyMessage')));
      }
      const assistant = row.role === 'assistant';
      return h('div', { className: `cc-row cc-row-${row.role}`, 'data-cc-row': row.role },
        h('div', { className: 'cc-stack' },
          assistant
            ? h('div', { className: 'cc-text' }, row.reasoning
                ? h('details', { className: 'cc-fold', 'data-cc-row': 'reasoning' },
                    h('summary', { className: 'cc-fold-head' },
                      h('span', { className: 'cc-fold-caret', 'aria-hidden': true }, '▸'),
                      h('span', { className: 'cc-fold-name' }, t('reasoning'))),
                    h('pre', { className: 'cc-fold-body' }, row.reasoning))
                : null,
              row.text.length > 0 ? row.text : h('span', { className: 'cc-empty-msg' }, t('emptyMessage')),
              row.interrupted ? h('span', { className: 'cc-note' }, t('cancelled')) : null)
            : h('div', { className: 'cc-bubble' },
                h('span', { className: 'cc-role' }, `${t('user')} · `),
                row.text.length > 0 ? row.text : h('span', { className: 'cc-empty-msg' }, t('emptyMessage')))));
    }

    /**
     * Group rows into turns: each user message opens a turn, and rows that
     * arrive before any user message (truncated history) form their own leading
     * turn.
     *
     * @param {Array<{seq: number, role: string}>} rows - chronological rows.
     * @returns {Array<{key: number|string, rows: Array<object>}>} the turns.
     */
    function buildTurns(rows) {
      const turns = [];
      let current;
      for (const row of rows) {
        if (current === undefined || row.role === 'user') {
          current = { key: row.role === 'user' ? row.seq : `pre-${String(row.seq)}`, rows: [] };
          turns.push(current);
        }
        current.rows.push(row);
      }
      return turns;
    }

    /**
     * @param {{ok?: boolean, code?: string} | undefined} status - peer status.
     * @returns {string} a dot class suffix.
     */
    function statusClass(status) {
      if (status === undefined) return '';
      if (status.ok === true) return ' cc-dot-on';
      return ' cc-dot-err';
    }

    /**
     * @param {{ok?: boolean, code?: string}} status - peer status.
     * @param {string} kind - peer kind.
     * @param {(key: string) => string} t - translator.
     * @returns {string} a short badge.
     */
    function statusText(status, kind, t) {
      if (status.ok === true) return ' ✓';
      if (status.code === 'no-spoke') return ` ${t('statusWaiting')}`;
      if (status.code === 'unauthorized') return ` ${t('statusError')}: 401`;
      return ` ${t('statusError')}`;
    }

    /**
     * @param {number} timestamp - epoch milliseconds.
     * @param {(key: string) => string} t - translator.
     * @returns {string} a relative label.
     */
    function timeAgo(timestamp, t) {
      if (!Number.isFinite(timestamp) || timestamp <= 0) return '';
      const delta = Date.now() - timestamp;
      if (delta < 60000) return t('now');
      const minutes = Math.floor(delta / 60000);
      if (minutes < 60) return t('minutesAgo').replace('{n}', String(minutes));
      const hours = Math.floor(minutes / 60);
      if (hours < 24) return t('hoursAgo').replace('{n}', String(hours));
      return t('daysAgo').replace('{n}', String(Math.floor(hours / 24)));
    }

    /**
     * @returns {string} a fresh idempotency key for one prompt.
     */
    function randomId() {
      try {
        return crypto.randomUUID();
      } catch {
        return `req-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      }
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'cloud-control: dictionaries');
        const t = ctx.locale.bind(NS);
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: PANEL_ID,
          order: 40,
          label: () => t('panel'),
          locale: NS
        }, PanelIcon));
        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: PANEL_ID,
          locale: NS
        }, CloudControlPanel));
      }
    };
  }
});
