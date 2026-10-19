import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

/**
 * Headless smoke test for the browser half.
 *
 * The bundle is a plain script that registers a factory on
 * `window.__ModuleLoader__`. Rather than a browser, this test installs a tiny
 * React-compatible runtime (the subset the panel uses) and a stubbed `fetch`
 * that answers with the controller's real response shapes, then renders the
 * panel until it settles. It catches render-time faults, wrong request URLs and
 * broken data flow without a browser or the Harness runtime.
 */

// The panel schedules polling timers that React cleanups clear on unmount. This
// harness has no unmount phase, so the final pass's timers stay pending and
// would hold the test process open forever: make every timer non-blocking once,
// module-wide. `unref` exists on Node timers and is absent in a browser, so this
// stays a no-op when the same code runs elsewhere.
const nativeSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms, ...rest) => {
  const handle = nativeSetTimeout(fn, ms, ...rest);
  handle?.unref?.();
  return handle;
};

/** Collected builder for the mini runtime. */
function createMiniReact() {
  /** @type {Map<Function, {hooks: unknown[], cursor: number}>} */
  const stores = new Map();
  let current = undefined;
  let dirty = false;
  /** @type {Array<{store: {hooks: unknown[]}, index: number, fn: Function, deps: unknown[] | undefined}>} */
  let pending = [];

  const storeOf = (component) => {
    if (!stores.has(component)) stores.set(component, { hooks: [], cursor: 0 });
    return stores.get(component);
  };

  const slot = (initial) => {
    const store = storeOf(current);
    const index = store.cursor++;
    if (!(index in store.hooks)) store.hooks[index] = initial;
    return { store, index };
  };

  const same = (left, right) => Array.isArray(left) && Array.isArray(right)
    && left.length === right.length && left.every((value, index) => Object.is(value, right[index]));

  const React = {
    Fragment: Symbol('Fragment'),
    createElement(type, props, ...children) {
      const merged = { ...(props ?? {}) };
      if (children.length === 1) merged.children = children[0];
      else if (children.length > 1) merged.children = children;
      return { type, props: merged };
    },
    useState(initial) {
      const { store, index } = slot(typeof initial === 'function' ? initial() : initial);
      return [store.hooks[index], (next) => {
        const value = typeof next === 'function' ? next(store.hooks[index]) : next;
        if (!Object.is(value, store.hooks[index])) {
          store.hooks[index] = value;
          dirty = true;
        }
      }];
    },
    useRef(initial) {
      const { store, index } = slot({ current: initial });
      return store.hooks[index];
    },
    useMemo(factory, deps) {
      const store = storeOf(current);
      const index = store.cursor++;
      const record = store.hooks[index];
      if (record === undefined || !same(record.deps, deps)) store.hooks[index] = { deps, value: factory() };
      return store.hooks[index].value;
    },
    useCallback(fn, deps) {
      const store = storeOf(current);
      const index = store.cursor++;
      const record = store.hooks[index];
      if (record === undefined || !same(record.deps, deps)) store.hooks[index] = { deps, value: fn };
      return store.hooks[index].value;
    },
    useEffect(fn, deps) {
      const { store, index } = slot(undefined);
      pending.push({ store, index, fn, deps });
    }
  };

  /**
   * @param {unknown} node - element tree.
   * @returns {unknown} the expanded tree with function components resolved.
   */
  function expand(node) {
    if (node === null || node === undefined || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map(expand);
    if (typeof node.type === 'function') {
      const previous = current;
      current = node.type;
      storeOf(node.type).cursor = 0;
      const rendered = node.type({ ...node.props, children: node.props.children });
      current = previous;
      return expand(rendered);
    }
    return { type: node.type, props: { ...node.props, children: expand(node.props.children) } };
  }

  return {
    React,
    /** @param {Function} component - root component. @param {object} props - its props. */
    render(component, props) {
      dirty = false;
      pending = [];
      const tree = expand(React.createElement(component, props));
      return { tree, effects: pending };
    },
    /** @param {ReturnType<typeof this.render>['effects']} effects - effects to run. */
    async run(effects) {
      for (const effect of effects) {
        const record = effect.store.hooks[effect.index];
        if (record !== undefined && same(record.deps, effect.deps)) continue;
        // React contract: the previous run's cleanup settles before the body
        // runs again. Without this the polling loops of earlier passes keep
        // their timers, and the test process never drains.
        if (record !== undefined && typeof record.cleanup === 'function') record.cleanup();
        effect.store.hooks[effect.index] = { deps: effect.deps };
        const cleanup = effect.fn();
        if (typeof cleanup === 'function') effect.store.hooks[effect.index].cleanup = cleanup;
      }
      await settle();
    },
    /** Run every mounted effect's cleanup so polling stops deterministically. */
    dispose() {
      for (const store of stores.values()) {
        for (const hook of store.hooks) {
          if (hook !== null && typeof hook === 'object' && typeof hook.cleanup === 'function') {
            hook.cleanup();
            hook.cleanup = undefined;
          }
        }
      }
    },
    get dirty() {
      return dirty;
    }
  };
}

/** Let pending fetch promises and their continuations run. */
async function settle() {
  for (let index = 0; index < 6; index += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

/** @param {unknown} node - expanded tree. @returns {string} all visible text. */
function textOf(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return `${node} `;
  if (Array.isArray(node)) return node.map(textOf).join('');
  return textOf(node.props?.children);
}

/**
 * Collect every element in an expanded tree, so structural claims about the
 * conversation half can be asserted without a DOM.
 *
 * @param {unknown} node - expanded tree.
 * @returns {Array<{type: unknown, props: Record<string, unknown>}>} the elements.
 */
function elementsOf(node) {
  if (node === null || node === undefined || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(elementsOf);
  const self = typeof node.type === 'string' ? [{ type: node.type, props: node.props ?? {} }] : [];
  return [...self, ...elementsOf(node.props?.children)];
}

/** @param {Record<string, unknown>} props - element props. @returns {string} its class list. */
function classOf(props) {
  return typeof props.className === 'string' ? props.className : '';
}

test('client bundle renders peer, sessions and transcript from controller answers', async () => {
  const calls = [];
  const responses = {
    state: { ok: true, role: 'controller', displayName: 'Dev Box', pollIntervalMs: 2000, maxMessages: 60, relay: { hub: false, spoke: false } },
    peers: { ok: true, peers: [{ id: 'nas', label: 'NAS', kind: 'direct', status: { ok: true } }] },
    sessions: { ok: true, peer: 'nas', items: [{ sessionId: 's1', title: '修复构建', running: true, updatedAt: Date.now(), cwd: 'D:/proj', blank: false }] },
    history: {
      ok: true,
      peer: 'nas',
      sessionId: 's1',
      title: '修复构建',
      running: true,
      throughSeq: 10,
      hasMore: false,
      rows: [
        { seq: 1, time: 0, role: 'user', kind: 'message', text: '请修复构建' },
        { seq: 2, time: 0, role: 'assistant', kind: 'message', text: '收到，正在检查', reasoning: '先看日志' },
        { seq: 3, time: 0, role: 'tool', kind: 'call', name: 'bash', text: 'npm test' }
      ]
    }
  };

  globalThis.window = {
    __ModuleLoader__: {
      load(registration) {
        globalThis.window.__registration = registration;
      }
    }
  };
  globalThis.document = {
    baseURI: 'http://127.0.0.1:39180/',
    visibilityState: 'visible',
    querySelector: () => ({}),
    createElement: () => ({ dataset: {}, style: {}, set textContent(value) {}, appendChild() {} }),
    head: { appendChild() {} },
    addEventListener() {},
    removeEventListener() {}
  };
  globalThis.fetch = async (url, init) => {
    const target = new URL(url);
    const route = target.pathname.split('/').pop();
    calls.push({ url: target.href, method: init?.method ?? 'GET', body: init?.body });
    const body = responses[route];
    if (body === undefined) throw new Error(`unexpected route ${target.pathname}`);
    return {
      ok: true,
      status: 200,
      async json() {
        return body;
      }
    };
  };

  await import('../client.js');
  const registration = globalThis.window.__registration;
  assert.equal(registration.id, 'dsh-cloud-control');
  const mini = createMiniReact();
  const plugin = registration.factory((id) => {
    if (id === 'react') return mini.React;
    throw new Error(`unexpected require(${id})`);
  });

  // The bundle's public contract.
  assert.deepEqual(plugin.inject, ['slots', 'locale']);
  const registrations = [];
  let localeNamespace;
  const ctx = {
    effect(fn) {
      const cleanup = fn();
      return () => {
        if (typeof cleanup === 'function') cleanup();
      };
    },
    locale: {
      register(namespace, dictionaries) {
        localeNamespace = { namespace, dictionaries };
        return () => {};
      },
      bind() {
        return (key) => localeNamespace.dictionaries.zh[key] ?? key;
      }
    },
    slots: {
      inject(_name, callback) {
        callback();
      },
      register(options, component) {
        registrations.push({ options, component });
        return () => {};
      }
    }
  };
  plugin.apply(ctx);

  assert.equal(localeNamespace.namespace, 'cloudControl');
  assert.ok(localeNamespace.dictionaries.en.panel.length > 0);
  const panel = registrations.find((entry) => entry.options.name === 'main');
  const icon = registrations.find((entry) => entry.options.name === 'sidebar.panellist');
  assert.equal(panel.options.key, 'cloud-control');
  assert.equal(icon.options.id, 'cloud-control');

  const t = (key) => localeNamespace.dictionaries.zh[key] ?? key;
  const props = {
    t,
    usePanelInfo: (selector) => selector({ activePanelId: 'cloud-control' })
  };

  // Settle the data effects: each pass renders the tree, then runs that tree's
  // effects. The data flow is two-step (sessions arrive, that selects a session,
  // then history arrives), so assert on the first render whose data is both
  // present and stable — never on a pre-effect render, which still shows the
  // empty state.
  let tree;
  for (let pass = 0; pass < 8; pass += 1) {
    const rendered = mini.render(panel.component, props);
    await mini.run(rendered.effects);
    const settled = textOf(rendered.tree);
    if (settled.includes('请修复构建') && settled.includes('收到，正在检查')) {
      tree = rendered.tree;
      break;
    }
    tree = rendered.tree;
  }

  const text = textOf(tree);
  assert.match(text, /远程会话/u);
  assert.match(text, /NAS/u);
  assert.match(text, /修复构建/u);
  assert.match(text, /请修复构建/u);
  assert.match(text, /收到，正在检查/u);
  assert.match(text, /bash/u);
  assert.ok(calls.every((call) => call.url.startsWith('http://127.0.0.1:39180/api/cloud-control/')), 'panel must call only its own controller routes');
  assert.ok(calls.some((call) => call.url.includes('/sessions?peer=nas')));
  assert.ok(calls.some((call) => call.url.includes('/history?peer=nas')));

  // The conversation half mirrors the native page: turns group rows, user text
  // sits in a right-aligned bubble, assistant text is plain, and tool records
  // are collapsible rows rather than the old free-form bubbles.
  const elements = elementsOf(tree);
  const classLists = elements.map((element) => classOf(element.props));
  const hasClass = (name) => classLists.some((list) => list.split(/\s+/u).includes(name));
  assert.ok(hasClass('cc-conversation'), 'the conversation column must exist');
  assert.ok(hasClass('cc-scroll'), 'the transcript must be the scroll viewport');
  assert.ok(hasClass('cc-turn'), 'rows must be grouped into turns');
  assert.ok(hasClass('cc-bubble'), 'the user message must render as a bubble');
  assert.ok(hasClass('cc-row-user'), 'the user row must carry its own layout hook');
  assert.ok(hasClass('cc-row-assistant'), 'the assistant row must carry its own layout hook');

  const reasoning = elements.find((element) => element.type === 'details' && classOf(element.props).includes('cc-fold'));
  assert.ok(reasoning !== undefined, 'reasoning must render as a collapsible row');

  const toolRows = elements.filter((element) => element.type === 'details' && element.props['data-cc-row'] === 'tool');
  assert.equal(toolRows.length, 1, 'a tool record must render as one collapsible row');
  assert.ok(
    classOf(toolRows[0].props).split(/\s+/u).includes('cc-fold'),
    'the tool row must use the shared fold chrome'
  );

  // The composer is the native card: one input plus a primary send control.
  assert.ok(hasClass('cc-card'), 'the composer must render as the native card');
  assert.ok(hasClass('cc-primary'), 'the composer must expose a primary send button');
  const send = elements.find((element) => element.type === 'button' && element.props['aria-label'] === '发送');
  assert.ok(send !== undefined, 'the send control must be labelled for assistive tech');
  assert.equal(send.props.disabled, true, 'an empty draft must not submit');
  const textarea = elements.find((element) => element.type === 'textarea');
  assert.ok(textarea !== undefined, 'the composer must keep a text input');
  assert.equal(textarea.props.disabled, false, 'a selected session must accept input');

  mini.dispose();
});

test('panel styles with theme tokens only, never literal colours', async () => {
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8');

  // The plugin authoring contract: literal colours are for artwork only. The two
  // icon components draw the sidebar glyph and the send arrow, so hex/rgb
  // literals may only appear inside their bodies.
  const artwork = source
    .replace(/function PanelIcon[\s\S]*?\n    \}/u, '')
    .replace(/function SendIcon[\s\S]*?\n    \}/u, '');
  const literals = [...artwork.matchAll(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/gu)].map((match) => match[0]);
  assert.deepEqual(literals, [], `theme tokens are required outside artwork, found ${JSON.stringify(literals)}`);

  // The structural mirror depends on these tokens existing; keep the list explicit.
  for (const token of [
    '--dsw-radius-panel',
    '--dsw-radius-xl',
    '--dsw-elevation-soft',
    '--dsw-specific-input-major',
    '--dsw-specific-bubble',
    '--dsw-alias-label-caption',
    '--dsw-alias-interactive-bg-hover'
  ]) {
    assert.ok(source.includes(`var(${token}`), `${token} must style the mirrored chrome`);
  }
  assert.ok(source.includes('--dsh-chat-content-width'), 'the conversation column must follow the host width variable');
});
