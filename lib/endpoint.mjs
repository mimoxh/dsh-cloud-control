import { ENDPOINT_PREFIX } from './config.mjs';
import { sourceAllowed, tokenMatches, tokenOf } from './auth.mjs';
import { CloudError } from './errors.mjs';
import { readNodeJson, requestUrl, writeJson } from './http.mjs';

/** Plugin version reported by `/health`; `test/manifest.test.mjs` keeps it in sync. */
export const PLUGIN_VERSION = '0.1.2';

/**
 * Mount the endpoint half: the small bearer-token HTTP surface another DSH
 * instance calls to read and drive this Host's sessions.
 *
 * Routes live on `ctx.webServer` (a plain Node HTTP server), not on
 * `connection.fetch`, because the caller is a peer Host rather than the local
 * browser: it has no browser cookie, so this plugin owns the whole request
 * policy — constant-time token comparison, optional source allowlist, method
 * allowlist, body budget and per-call timeout.
 *
 * @param {{webServer: {register(route: object): () => void}}} ctx - Host context.
 * @param {ReturnType<import('./config.mjs').normalizeConfig>} config - normalized configuration.
 * @param {{localRpc: ReturnType<import('./local-rpc.mjs').createLocalRpc>, relayHub: ReturnType<import('./relay-hub.mjs').createRelayHub>}} deps
 *   the local Host bridge and relay queue.
 * @returns {() => void} the registration disposer (also owned by `ctx.effect`).
 */
export function registerEndpoint(ctx, config, deps) {
  const { localRpc, relayHub } = deps;
  const prefix = ENDPOINT_PREFIX;
  const allowedMethods = new Set(config.endpoint.allowMethods);
  const relayRoutes = config.relay.enabled;

  /**
   * @param {import('node:http').IncomingMessage} request - incoming request.
   * @param {import('node:http').ServerResponse} response - response to own.
   * @returns {Promise<void>} settles after the response ends.
   */
  async function handle(request, response) {
    const url = requestUrl(request.url);
    if (!tokenMatches(tokenOf(request), config.endpoint.token)) {
      writeJson(response, 401, failure('unauthorized', 'missing or invalid bearer token'));
      return;
    }
    if (!sourceAllowed(request.socket?.remoteAddress, config.endpoint.allowFrom)) {
      writeJson(response, 403, failure('forbidden', 'this source address is not allowed'));
      return;
    }
    const path = url.pathname;
    if (request.method === 'GET' && path === `${prefix}/health`) {
      writeJson(response, 200, {
        ok: true,
        plugin: 'dsh-cloud-control',
        pluginVersion: PLUGIN_VERSION,
        name: config.displayName,
        node: process.version,
        relay: relayRoutes,
        time: Date.now(),
      });
      return;
    }
    if (request.method === 'POST' && path === `${prefix}/rpc`) {
      await handleRpc(request, response);
      return;
    }
    if (relayRoutes && request.method === 'GET' && path === `${prefix}/relay/poll`) {
      await handlePoll(request, response, url);
      return;
    }
    if (relayRoutes && request.method === 'POST' && path === `${prefix}/relay/result`) {
      await handleResult(request, response);
      return;
    }
    writeJson(response, 404, failure('not-found', `no endpoint at ${path}`));
  }

  /**
   * Forward one official Remote invocation to this Host's own `/api`.
   *
   * @param {import('node:http').IncomingMessage} request - incoming request.
   * @param {import('node:http').ServerResponse} response - response to own.
   * @returns {Promise<void>} settles after the response ends.
   */
  async function handleRpc(request, response) {
    const body = await readNodeJson(request, config.endpoint.maxBodyBytes);
    if (body === null || typeof body !== 'object' || typeof body.method !== 'string') {
      writeJson(response, 400, failure('bad-request', 'body must be {method, payload}'));
      return;
    }
    const method = body.method;
    if (!allowedMethods.has(method)) {
      writeJson(response, 403, failure('method-not-allowed', `${method} is not in endpoint.allowMethods`));
      return;
    }
    if (!/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/u.test(method)) {
      writeJson(response, 400, failure('bad-request', 'method must be <namespace>/<name>'));
      return;
    }
    const envelope = await localRpc.call(method, body.payload);
    writeJson(response, 200, { ok: true, response: { type: 'server-response', rpcId: envelope.rpcId, result: envelope.result } });
  }

  /**
   * Hand one request to the connected spoke, waiting up to the poll budget.
   *
   * @param {import('node:http').IncomingMessage} request - incoming request.
   * @param {import('node:http').ServerResponse} response - response to own.
   * @param {URL} url - parsed request URL.
   * @returns {Promise<void>} settles after the response ends.
   */
  async function handlePoll(request, response, url) {
    const requested = Number(url.searchParams.get('wait'));
    const waitMs = Number.isFinite(requested) && requested >= 1000
      ? Math.min(requested, 30000)
      : config.relay.waitMs;
    const abort = new AbortController();
    response.on('close', () => abort.abort());
    const next = await relayHub.take(waitMs, abort.signal);
    if (response.writableEnded || abort.signal.aborted) return;
    writeJson(response, 200, { ok: true, request: next });
  }

  /**
   * Accept one spoke outcome and wake its waiting caller.
   *
   * @param {import('node:http').IncomingMessage} request - incoming request.
   * @param {import('node:http').ServerResponse} response - response to own.
   * @returns {Promise<void>} settles after the response ends.
   */
  async function handleResult(request, response) {
    const body = await readNodeJson(request, config.endpoint.maxBodyBytes);
    if (body === null || typeof body !== 'object' || typeof body.id !== 'string') {
      writeJson(response, 400, failure('bad-request', 'body must be {id, ok, response|error}'));
      return;
    }
    const settled = relayHub.settle(body.id, body.ok === true
      ? { ok: true, response: body.response }
      : { ok: false, error: body.error ?? { code: 'spoke-failed', message: 'the spoke reported a failure' } });
    writeJson(response, 200, { ok: true, settled });
  }

  const handler = (request, response) => {
    handle(request, response).catch((error) => {
      if (response.writableEnded) return;
      const code = error instanceof CloudError ? error.code : 'internal';
      const status = code === 'timeout'
        ? 504
        : code === 'body-too-large'
          ? 413
          : code === 'body-invalid'
            ? 400
            : 500;
      try {
        writeJson(response, status, failure(code, error instanceof Error ? error.message : String(error)));
      } catch {
        response.destroy?.();
      }
    });
  };

  return ctx.effect(
    () => ctx.webServer.register({ kind: 'prefix', path: prefix, handler }),
    'cloud-control: endpoint routes',
  );
}

/**
 * @param {string} code - stable failure code.
 * @param {string} message - explanation.
 * @returns {{ok: false, error: {code: string, message: string}}} the body.
 */
function failure(code, message) {
  return { ok: false, error: { code, message } };
}
