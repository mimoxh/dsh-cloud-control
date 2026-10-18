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

    const CSS = `
      .cc-root{box-sizing:border-box;display:flex;flex-direction:column;height:100%;min-height:0;color:var(--dsw-alias-label-primary);background:transparent;font-size:13px}
      .cc-head{display:flex;align-items:center;gap:10px;padding:14px 18px 10px;border-bottom:.5px solid var(--dsw-alias-border-l1);flex-wrap:wrap}
      .cc-head h1{font-size:15px;font-weight:600;margin:0}
      .cc-sub{color:var(--dsw-alias-label-tertiary);font-size:12px}
      .cc-spacer{flex:1}
      .cc-btn{border:0;border-radius:6px;padding:5px 11px;cursor:pointer;background:var(--dsw-alias-fill-l2);color:var(--dsw-alias-label-primary);font-size:12px}
      .cc-btn:hover{background:var(--dsw-alias-fill-l1)}
      .cc-btn:disabled{opacity:.5;cursor:default}
      .cc-btn-primary{background:var(--dsw-alias-fill-l2)}
      .cc-tabs{display:flex;gap:6px;flex-wrap:wrap;padding:10px 18px;border-bottom:.5px solid var(--dsw-alias-border-l1)}
      .cc-tab{border:.5px solid var(--dsw-alias-border-l1);border-radius:999px;padding:4px 12px;cursor:pointer;background:transparent;color:var(--dsw-alias-label-secondary);font-size:12px;display:flex;align-items:center;gap:6px}
      .cc-tab-on{background:var(--dsw-alias-fill-l1);color:var(--dsw-alias-label-primary)}
      .cc-dot{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-label-tertiary);display:inline-block;flex:none}
      .cc-dot-on{background:#3fb950}
      .cc-dot-err{background:#d29922}
      .cc-body{display:flex;flex:1;min-height:0}
      .cc-list{width:280px;flex:none;border-right:.5px solid var(--dsw-alias-border-l1);overflow:auto;padding:8px}
      .cc-group{color:var(--dsw-alias-label-tertiary);font-size:11px;padding:8px 6px 4px;word-break:break-all}
      .cc-session{display:flex;align-items:center;gap:8px;width:100%;text-align:left;border:0;background:transparent;color:inherit;border-radius:6px;padding:7px 8px;cursor:pointer}
      .cc-session:hover{background:var(--dsw-alias-fill-l1)}
      .cc-session-on{background:var(--dsw-alias-fill-l2)}
      .cc-session-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .cc-session-meta{color:var(--dsw-alias-label-tertiary);font-size:11px;flex:none}
      .cc-main{flex:1;display:flex;flex-direction:column;min-width:0;min-height:0}
      .cc-transcript{flex:1;overflow:auto;padding:14px 18px;display:flex;flex-direction:column;gap:12px}
      .cc-msg{max-width:860px;border-radius:8px;padding:8px 12px;background:var(--dsw-alias-fill-l1)}
      .cc-msg-user{background:var(--dsw-alias-fill-l2);align-self:flex-end;max-width:640px}
      .cc-role{color:var(--dsw-alias-label-tertiary);font-size:11px;margin-bottom:4px}
      .cc-text{white-space:pre-wrap;word-break:break-word;line-height:1.55}
      .cc-tool{border-left:2px solid var(--dsw-alias-border-l1);padding-left:10px;color:var(--dsw-alias-label-secondary)}
      .cc-tool summary{cursor:pointer;font-size:12px}
      .cc-tool pre{margin:6px 0 0;white-space:pre-wrap;word-break:break-word;font-size:11px;max-height:260px;overflow:auto}
      .cc-reasoning{color:var(--dsw-alias-label-tertiary);font-size:12px;margin-top:6px}
      .cc-reasoning pre{white-space:pre-wrap;margin:4px 0 0}
      .cc-empty{margin:auto;color:var(--dsw-alias-label-tertiary);text-align:center;padding:24px;max-width:460px;line-height:1.6}
      .cc-error{margin:10px 18px 0;border-radius:6px;padding:8px 12px;background:var(--dsw-alias-fill-l2);color:var(--dsw-alias-label-secondary);display:flex;gap:10px;align-items:center}
      .cc-error-text{flex:1;min-width:0;word-break:break-word}
      .cc-composer{border-top:.5px solid var(--dsw-alias-border-l1);padding:10px 18px 14px;display:flex;flex-direction:column;gap:8px}
      .cc-composer-row{display:flex;gap:8px;align-items:flex-end}
      .cc-input{flex:1;min-height:56px;max-height:200px;resize:vertical;border:.5px solid var(--dsw-alias-border-l1);border-radius:8px;padding:8px 10px;background:var(--dsw-alias-fill-l1);color:var(--dsw-alias-label-primary);font-family:inherit;font-size:13px;line-height:1.5}
      .cc-modes{display:flex;gap:6px;align-items:center;color:var(--dsw-alias-label-tertiary);font-size:11px}
      .cc-pill{border:.5px solid var(--dsw-alias-border-l1);border-radius:999px;padding:3px 10px;cursor:pointer;background:transparent;color:var(--dsw-alias-label-secondary);font-size:11px}
      .cc-pill-on{background:var(--dsw-alias-fill-l1);color:var(--dsw-alias-label-primary)}
      .cc-foot{display:flex;gap:8px;align-items:center}
      .cc-hint{color:var(--dsw-alias-label-tertiary);font-size:11px;flex:1}
      .cc-title{font-weight:600}
      .cc-running{color:#3fb950;font-size:11px}
      .cc-pad{padding-top:var(--dsh-frame-top-clearance,0px)}
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
                    running ? h('span', { className: 'cc-running' }, t('running')) : null,
                    h('span', { className: 'cc-spacer' }),
                    latest.hasMore || older.hasMore
                      ? h('button', { className: 'cc-btn', type: 'button', onClick: loadOlder, disabled: older.loading }, older.loading ? t('loading') : t('loadOlder'))
                      : null),
                  h('div', { className: 'cc-transcript', ref: transcriptRef, onScroll: onTranscriptScroll },
                    sessionId === undefined
                      ? h('div', { className: 'cc-empty' }, t('selectSession'))
                      : rows.length === 0
                        ? h('div', { className: 'cc-empty' }, t('selectSession'))
                        : rows.map((row) => h(Row, { key: row.seq, row, t }))),
                  h('div', { className: 'cc-composer' },
                    h('div', { className: 'cc-composer-row' },
                      h('textarea', {
                        className: 'cc-input',
                        value: draft,
                        placeholder: t('composerPlaceholder'),
                        onChange: (event) => setDraft(event.target.value),
                        onKeyDown: onComposerKey,
                        disabled: sessionId === undefined
                      }),
                      h('button', { className: 'cc-btn cc-btn-primary', type: 'button', onClick: () => void send(), disabled: sending || sessionId === undefined }, sending ? t('sending') : t('send'))),
                    h('div', { className: 'cc-foot' },
                      h('div', { className: 'cc-modes' },
                        h('button', { type: 'button', className: `cc-pill${mode === 'queue' ? ' cc-pill-on' : ''}`, onClick: () => setMode('queue') }, t('queueMode')),
                        h('button', { type: 'button', className: `cc-pill${mode === 'steer' ? ' cc-pill-on' : ''}`, onClick: () => setMode('steer') }, t('steerMode')),
                        running
                          ? h('button', { type: 'button', className: 'cc-pill', onClick: () => void stop() }, t('stop'))
                          : null),
                      h('span', { className: 'cc-hint' }, t('publicHint'))))))));
    }

    /**
     * One transcript row: user/assistant message or a collapsible tool record.
     */
    function Row({ row, t }) {
      if (row.role === 'tool') {
        const label = row.kind === 'result' ? t('toolResult') : t('tool');
        return h('details', { className: 'cc-tool' },
          h('summary', null, `${label}: ${row.name}${row.error ? ' (error)' : ''}`),
          h('pre', null, row.text));
      }
      return h('div', { className: `cc-msg cc-msg-${row.role}` },
        h('div', { className: 'cc-role' }, row.role === 'user' ? t('user') : t('assistant')),
        row.reasoning
          ? h('details', { className: 'cc-reasoning' }, h('summary', null, t('reasoning')), h('pre', null, row.reasoning))
          : null,
        h('div', { className: 'cc-text' }, row.text.length > 0 ? row.text : t('emptyMessage')));
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
