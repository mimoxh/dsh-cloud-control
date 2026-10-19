import { randomUUID } from 'node:crypto';
import { CloudError } from './errors.mjs';

/** `webServer` members the origin resolver reads, in probe order. */
const WEBSERVER_MEMBERS = ['getOrigin', 'protocol', 'port', 'host', 'register'];

/**
 * The Host-side bridge to this process's own DSH API.
 *
 * Every outbound peer call ultimately becomes one official Remote unary
 * invocation against a real DSH Host. On the endpoint side that Host is this
 * process, so the plugin mints the same browser-grade API credential the Web
 * shell would receive (`GET /connect?token=…&interactions=none`) and then posts
 * official `client-request` envelopes to the loopback `/api/<endpoint>` route.
 *
 * The credential never leaves the process: peers only ever see the plugin's own
 * bearer-token surface.
 *
 * @param {{webServer: {getOrigin?: () => string, protocol?: string, port?: number, host?: string}, connection: {authenticatedUrl(base: string): string}}} ctx
 *   the Host context owning the services (read through Cordis so the binding
 *   follows the caller's fiber).
 * @param {{timeoutMs?: number}} [options] - per-call budget.
 * @returns {{call(method: string, payload: unknown, options?: {signal?: AbortSignal}): Promise<{rpcId: string, result: unknown}>}}
 *   the caller.
 */
export function createLocalRpc(ctx, options = {}) {
  const timeoutMs = options.timeoutMs ?? 30000;
  /** @type {string | undefined} */
  let cookie;
  /** @type {Promise<string> | undefined} */
  let minting;

  /**
   * Read the bound listener origin, failing with a diagnostic when the
   * webserver is not ready yet.
   *
   * @returns {{origin: string, via: string, reasons: string[], cause?: unknown}} the resolution.
   * @throws {CloudError} `not-ready` naming every reason the lookup failed.
   */
  function resolveOrigin() {
    const resolved = inspectWebServerOrigin(ctx.webServer);
    if (resolved.origin === undefined) {
      throw new CloudError('not-ready', `the DSH webserver origin is unavailable: ${resolved.reasons.join('; ')}`, resolved.cause);
    }
    return resolved;
  }

  /**
   * Exchange this process's launch token for an API cookie bound to the
   * loopback authority. One cookie is reused for the lifetime of the plugin.
   *
   * @param {ReturnType<typeof resolveOrigin>} resolved - the origin resolution.
   * @returns {Promise<string>} the `Cookie` header value.
   */
  async function mintCookie(resolved) {
    const base = resolved.origin;
    const suffix = fallbackNote(resolved);
    const tokenized = new URL(ctx.connection.authenticatedUrl(base));
    const token = tokenized.searchParams.get('token');
    if (typeof token !== 'string' || token.length === 0) {
      throw new CloudError('internal', `the Host did not expose a launch token for ${base}${suffix}`);
    }
    const connect = new URL(`/connect?token=${encodeURIComponent(token)}&interactions=none`, base);
    const response = await fetch(connect, {
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
    const header = response.headers.get('set-cookie');
    if (typeof header !== 'string' || header.length === 0) {
      /** @type {string} */
      let text = '';
      try {
        text = await response.text();
      } catch {
        /* an unreadable body leaves the status as the diagnosis */
      }
      throw new CloudError('internal',
        `the Host refused the API credential exchange: POST ${connect.pathname} on ${base} returned HTTP ${response.status}${suffix}${text === '' ? '' : `: ${preview(text)}`}`);
    }
    await response.body?.cancel();
    const value = header.split(';', 1)[0];
    if (typeof value !== 'string' || value.length === 0) {
      throw new CloudError('internal', 'the Host returned an unusable API credential');
    }
    return value;
  }

  /**
   * @param {boolean} force - discard any cached credential first.
   * @param {ReturnType<typeof resolveOrigin>} resolved - the origin resolution.
   * @returns {Promise<string>} the cookie header value.
   */
  async function ensureCookie(force, resolved) {
    if (force) cookie = undefined;
    if (cookie !== undefined) return cookie;
    minting ??= mintCookie(resolved).then((value) => {
      cookie = value;
      return value;
    }).finally(() => {
      minting = undefined;
    });
    return minting;
  }

  /**
   * Invoke one official Remote endpoint on this process.
   *
   * @param {string} method - `<namespace>/<name>` endpoint.
   * @param {unknown} payload - the official `{args: …}` payload.
   * @param {{signal?: AbortSignal}} [callOptions] - caller cancellation.
   * @returns {Promise<{rpcId: string, result: unknown}>} the decoded envelope.
   * @throws {CloudError} `not-ready`, `internal`, `upstream-http`, `protocol`, or `timeout`.
   */
  async function call(method, payload, callOptions = {}) {
    const resolved = resolveOrigin();
    const base = resolved.origin;
    const suffix = fallbackNote(resolved);
    const signal = callOptions.signal === undefined
      ? AbortSignal.timeout(timeoutMs)
      : AbortSignal.any([callOptions.signal, AbortSignal.timeout(timeoutMs)]);
    const rpcId = randomUUID();
    const body = JSON.stringify({ type: 'client-request', rpcId, method, payload });
    const url = new URL(`/api/${method}`, base);
    const send = async (header) => fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: header },
      body,
      signal,
      redirect: 'error',
    });
    let response;
    try {
      response = await send(await ensureCookie(false, resolved));
      if (response.status === 401) {
        await response.body?.cancel();
        response = await send(await ensureCookie(true, resolved));
      }
    } catch (error) {
      if (signal.aborted) throw new CloudError('timeout', `local ${method} on ${base} timed out`, error);
      throw new CloudError('internal', `local ${method} on ${base} could not be reached${suffix}: ${errorName(error)}`, error);
    }
    const text = await response.text();
    if (!response.ok) {
      const hint = response.status === 404 || response.status === 405
        ? ` (the Host serves no POST ${url.pathname})`
        : '';
      throw new CloudError('upstream-http', `local ${method} on ${base} returned HTTP ${response.status}${hint}${suffix}: ${preview(text)}`);
    }
    let envelope;
    try {
      envelope = JSON.parse(text);
    } catch (error) {
      throw new CloudError('protocol', `local ${method} on ${base} returned a non-JSON body (HTTP ${response.status}): ${preview(text)}`, error);
    }
    if (envelope === null || typeof envelope !== 'object' || envelope.type !== 'server-response') {
      throw new CloudError('protocol', `local ${method} on ${base} returned an unexpected envelope: ${preview(text)}`);
    }
    if (envelope.rpcId !== rpcId) {
      throw new CloudError('protocol', `local ${method} correlated the wrong rpcId`);
    }
    return { rpcId: envelope.rpcId, result: envelope.result };
  }

  return { call };
}

/**
 * Resolve the origin of the Host's bound webserver listener without throwing.
 *
 * `ctx.webServer.getOrigin()` is the official accessor, but it throws until the
 * listener has bound its port, and a Host build without it (an older or a
 * re-shaped carrier) fails the call outright. The `protocol`/`port`/`host`
 * properties are the same public surface DSH itself uses to assemble loopback
 * URLs (`${protocol}//127.0.0.1:${port}`), so they back the official accessor
 * here. Nothing is swallowed: a failure names the accessor's own error and the
 * carrier members that were actually visible.
 *
 * @param {{getOrigin?: () => string, protocol?: unknown, port?: unknown, host?: unknown}} webServer
 *   the Host's `webServer` service; it may be missing or a foreign shape.
 * @returns {{origin?: string, via: 'getOrigin' | 'protocol/port' | 'webServer.server' | 'none', reasons: string[], cause?: unknown}}
 *   the resolved origin, how it was found, and every observed failure.
 */
export function inspectWebServerOrigin(webServer) {
  /** @type {string[]} */
  const reasons = [];
  /** @type {unknown} */
  let cause;

  const accessor = member(webServer, 'getOrigin');
  if (typeof accessor === 'function') {
    try {
      const value = accessor.call(webServer);
      if (typeof value !== 'string' || value.length === 0) {
        reasons.push(`getOrigin() returned ${describe(value)}`);
      } else if (isUrl(value)) {
        return { origin: value, via: 'getOrigin', reasons };
      } else {
        reasons.push(`getOrigin() returned a non-URL string ${JSON.stringify(value)}`);
      }
    } catch (error) {
      cause = error;
      reasons.push(`getOrigin() failed: ${errorName(error)}`);
    }
  } else {
    reasons.push(`getOrigin is not a function (${describe(accessor)})`);
  }

  const composed = composeOrigin(webServer, reasons);
  if (composed !== undefined) return { origin: composed, via: 'protocol/port', reasons, cause };

  const bound = composeFromServer(webServer, reasons);
  if (bound !== undefined) return { origin: bound, via: 'webServer.server', reasons, cause };

  reasons.push(`webServer members [${WEBSERVER_MEMBERS.map((key) => `${key}: ${describeMember(webServer, key)}`).join(', ')}]`);
  reasons.push(`webServer own keys [${ownKeys(webServer).join(', ')}]`);
  return { via: 'none', reasons, cause };
}

/**
 * Resolve the origin, or fail with the complete diagnosis.
 *
 * @param {{getOrigin?: () => string, protocol?: unknown, port?: unknown, host?: unknown}} webServer
 *   the Host's `webServer` service.
 * @returns {string} the origin text, for example `http://127.0.0.1:3080`.
 * @throws {CloudError} `not-ready` listing every reason the lookup failed.
 */
export function resolveWebServerOrigin(webServer) {
  const resolved = inspectWebServerOrigin(webServer);
  if (resolved.origin === undefined) {
    throw new CloudError('not-ready', `the DSH webserver origin is unavailable: ${resolved.reasons.join('; ')}`, resolved.cause);
  }
  return resolved.origin;
}

/**
 * Assemble the origin from the carrier's `protocol`/`port`/`host` properties.
 *
 * @param {unknown} webServer - the Host's `webServer` service.
 * @param {string[]} reasons - collector for why a part was unusable.
 * @returns {string | undefined} the origin, when the parts describe a listener.
 */
function composeOrigin(webServer, reasons) {
  const protocol = member(webServer, 'protocol');
  const port = member(webServer, 'port');
  const host = member(webServer, 'host');
  const scheme = schemeOf(protocol);
  const bound = isTcpPort(port) ? Number(port) : undefined;
  if (scheme === undefined) reasons.push(`protocol is ${describe(protocol)}, not "http:" or "https:"`);
  if (bound === undefined) reasons.push(`port is ${describe(port)}, not a bound TCP port`);
  if (scheme === undefined || bound === undefined) return undefined;
  return `${scheme}//${urlHost(host)}:${String(bound)}`;
}

/**
 * Last resort for a carrier that hides its port but exposes the Node listener:
 * read the socket's own bound address. This never invents a port — it reports
 * the one the listener actually holds, and only runs after the documented
 * surface has failed.
 *
 * @param {unknown} webServer - the Host's `webServer` service.
 * @param {string[]} reasons - collector for why a part was unusable.
 * @returns {string | undefined} the origin, when a bound socket is visible.
 */
function composeFromServer(webServer, reasons) {
  const server = member(webServer, 'server');
  if (server === null || typeof server !== 'object' || typeof server.address !== 'function') return undefined;
  const scheme = schemeOf(member(webServer, 'protocol'));
  if (scheme === undefined) return undefined;
  /** @type {unknown} */
  let address;
  try {
    address = server.address();
  } catch (error) {
    reasons.push(`webServer.server.address() threw: ${errorName(error)}`);
    return undefined;
  }
  const port = address !== null && typeof address === 'object' ? address.port : undefined;
  if (!isTcpPort(port)) {
    reasons.push(`webServer.server.address() is ${describe(address)}, not a bound TCP port`);
    return undefined;
  }
  const boundHost = address !== null && typeof address === 'object' ? address.address : undefined;
  return `${scheme}//${urlHost(typeof boundHost === 'string' && boundHost.length > 0 ? boundHost : member(webServer, 'host'))}:${String(Number(port))}`;
}

/**
 * @param {unknown} protocol - the carrier's `protocol` member.
 * @returns {string | undefined} `http:` or `https:`, when recognizable.
 */
function schemeOf(protocol) {
  if (typeof protocol !== 'string') return undefined;
  const text = protocol.trim().toLowerCase();
  return /^https?:?$/u.test(text) ? `${text.replace(/:$/u, '')}:` : undefined;
}

/**
 * @param {unknown} value - the carrier's `port` member.
 * @returns {boolean} whether it names a usable listening port.
 */
function isTcpPort(value) {
  if (typeof value === 'number') return Number.isInteger(value) && value > 0 && value <= 65535;
  if (typeof value !== 'string' || !/^\d{1,5}$/u.test(value)) return false;
  return Number(value) > 0 && Number(value) <= 65535;
}

/**
 * One line naming why an origin came from a fallback instead of the official
 * accessor, so a later failure still shows the NAS-side environment.
 *
 * @param {{origin?: string, via: string, reasons: string[]}} resolved - the origin resolution.
 * @returns {string} the suffix, or `''` for the official path.
 */
function fallbackNote(resolved) {
  if (resolved.origin === undefined || resolved.via === 'getOrigin' || resolved.reasons.length === 0) return '';
  return ` (origin from the ${resolved.via} fallback because ${resolved.reasons.join('; ')})`;
}

/**
 * Read one member of the carrier.
 *
 * @param {unknown} webServer - the Host's `webServer` service.
 * @param {string} key - member name.
 * @returns {unknown} the value, or `undefined` when it cannot be read.
 */
function member(webServer, key) {
  if (webServer === null || (typeof webServer !== 'object' && typeof webServer !== 'function')) return undefined;
  try {
    return Reflect.get(webServer, key);
  } catch {
    return undefined;
  }
}

/**
 * Describe one member for the diagnostic line, keeping a throwing getter visible.
 *
 * @param {unknown} webServer - the Host's `webServer` service.
 * @param {string} key - member name.
 * @returns {string} its value description.
 */
function describeMember(webServer, key) {
  if (webServer === null || (typeof webServer !== 'object' && typeof webServer !== 'function')) return describe(undefined);
  try {
    return describe(Reflect.get(webServer, key));
  } catch (error) {
    return `getter threw ${errorName(error)}`;
  }
}

/**
 * The URL host form of a bind address: IPv6 text is bracketed, a loopback zone
 * id is dropped, and a wildcard or unusable address falls back to IPv4
 * loopback, which any bound listener accepts.
 *
 * @param {unknown} host - the carrier's configured bind address.
 * @returns {string} the URL host text.
 */
function urlHost(host) {
  if (typeof host !== 'string' || host.length === 0) return '127.0.0.1';
  const zoneAt = host.indexOf('%');
  const bare = zoneAt === -1 ? host : host.slice(0, zoneAt);
  if (bare === '0.0.0.0' || bare === '::' || bare === '*' || bare === '') return '127.0.0.1';
  return bare.includes(':') ? `[${bare}]` : bare;
}

/**
 * @param {string} value - candidate origin.
 * @returns {boolean} whether it parses as an absolute URL.
 */
function isUrl(value) {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {unknown} value - member value.
 * @returns {string} its type, plus the value itself for primitives.
 */
function describe(value) {
  const type = typeof value;
  if (type === 'string') return `string ${JSON.stringify(value)}`;
  if (type === 'number' || type === 'boolean' || type === 'bigint') return `${type} ${String(value)}`;
  return type;
}

/**
 * @param {unknown} error - a thrown value.
 * @returns {string} `Name: message`, safe for any value type.
 */
function errorName(error) {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  try {
    return `${typeof error} ${String(error)}`;
  } catch {
    return typeof error;
  }
}

/**
 * @param {unknown} webServer - the Host's `webServer` service.
 * @returns {string[]} its own enumerable member names, capped for one line.
 */
function ownKeys(webServer) {
  if (webServer === null || (typeof webServer !== 'object' && typeof webServer !== 'function')) return [];
  try {
    return Object.keys(webServer).slice(0, 12);
  } catch {
    return ['<unreadable>'];
  }
}

/**
 * Shorten a response body for one error line.
 *
 * @param {string} text - body text.
 * @returns {string} the preview.
 */
function preview(text) {
  const compact = text.replace(/\s+/gu, ' ').trim();
  return compact.length > 200 ? `${compact.slice(0, 200)}…` : compact;
}
