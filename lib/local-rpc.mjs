import { randomUUID } from 'node:crypto';
import { CloudError } from './errors.mjs';

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
 * @param {{webServer: {getOrigin(): string}, connection: {authenticatedUrl(base: string): string}}} ctx
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
   * @returns {string} the origin text.
   */
  function origin() {
    try {
      return ctx.webServer.getOrigin();
    } catch (error) {
      throw new CloudError('not-ready', 'the DSH webserver is not listening yet', error);
    }
  }

  /**
   * Exchange this process's launch token for an API cookie bound to the
   * loopback authority. One cookie is reused for the lifetime of the plugin.
   *
   * @returns {Promise<string>} the `Cookie` header value.
   */
  async function mintCookie() {
    const base = origin();
    const tokenized = new URL(ctx.connection.authenticatedUrl(base));
    const token = tokenized.searchParams.get('token');
    if (typeof token !== 'string' || token.length === 0) {
      throw new CloudError('internal', 'the Host did not expose a launch token');
    }
    const response = await fetch(new URL(`/connect?token=${encodeURIComponent(token)}&interactions=none`, base), {
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
    const header = response.headers.get('set-cookie');
    await response.body?.cancel();
    if (typeof header !== 'string' || header.length === 0) {
      throw new CloudError('internal', `the Host refused the API credential exchange (HTTP ${response.status})`);
    }
    const value = header.split(';', 1)[0];
    if (typeof value !== 'string' || value.length === 0) {
      throw new CloudError('internal', 'the Host returned an unusable API credential');
    }
    return value;
  }

  /**
   * @param {boolean} force - discard any cached credential first.
   * @returns {Promise<string>} the cookie header value.
   */
  async function ensureCookie(force) {
    if (force) cookie = undefined;
    if (cookie !== undefined) return cookie;
    minting ??= mintCookie().then((value) => {
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
    const base = origin();
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
      response = await send(await ensureCookie(false));
      if (response.status === 401) {
        await response.body?.cancel();
        response = await send(await ensureCookie(true));
      }
    } catch (error) {
      if (signal.aborted) throw new CloudError('timeout', `local ${method} timed out`, error);
      throw new CloudError('internal', `local ${method} could not be reached: ${String(error)}`, error);
    }
    const text = await response.text();
    if (!response.ok) {
      throw new CloudError('upstream-http', `local ${method} returned HTTP ${response.status}: ${preview(text)}`);
    }
    let envelope;
    try {
      envelope = JSON.parse(text);
    } catch (error) {
      throw new CloudError('protocol', `local ${method} returned a non-JSON body`, error);
    }
    if (envelope === null || typeof envelope !== 'object' || envelope.type !== 'server-response') {
      throw new CloudError('protocol', `local ${method} returned an unexpected envelope`);
    }
    if (envelope.rpcId !== rpcId) {
      throw new CloudError('protocol', `local ${method} correlated the wrong rpcId`);
    }
    return { rpcId: envelope.rpcId, result: envelope.result };
  }

  return { call };
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
