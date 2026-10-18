import { ENDPOINT_PREFIX } from './config.mjs';
import { authHeaders } from './auth.mjs';
import { CloudError } from './errors.mjs';
import { httpRequest } from './http-client.mjs';

/** How long one peer health answer is reused before the next probe. */
const HEALTH_TTL_MS = 8000;

/** How recently a spoke must have polled for a relay peer to count as connected. */
const SPOKE_FRESH_MS = 60000;

/**
 * Peer registry: every configured remote DSH instance, reachable either
 * directly over HTTP or through this Host's relay hub.
 *
 * Calls always return the official `{rpcId, result}` envelope so the session
 * API above can unwrap it exactly like the browser client would.
 *
 * @param {ReturnType<import('./config.mjs').normalizeConfig>} config - normalized configuration.
 * @param {{relayHub: ReturnType<import('./relay-hub.mjs').createRelayHub>}} deps - shared relay hub.
 * @returns {{
 *   list(): Array<{id: string, label: string, kind: string}>,
 *   call(peerId: string, method: string, payload: unknown, options?: {signal?: AbortSignal}): Promise<{rpcId: string, result: unknown}>,
 *   health(peerId: string, options?: {signal?: AbortSignal}): Promise<{ok: true, [key: string]: unknown} | {ok: false, code: string, message: string}>,
 * }} the registry.
 */
export function createPeers(config, deps) {
  const byId = new Map(config.peers.map((peer) => [peer.id, peer]));
  /** @type {Map<string, {at: number, value: {ok: true, [key: string]: unknown} | {ok: false, code: string, message: string}}>} */
  const healthCache = new Map();

  /**
   * @returns {{id: string, label: string, kind: string}[]} the configured peers.
   */
  function list() {
    return config.peers.map((peer) => ({ id: peer.id, label: peer.label, kind: peer.kind }));
  }

  /**
   * Invoke one official Remote endpoint on a peer.
   *
   * @param {string} peerId - configured peer id.
   * @param {string} method - `<namespace>/<name>`.
   * @param {unknown} payload - official `{args}` payload.
   * @param {{signal?: AbortSignal}} [options] - caller cancellation.
   * @returns {Promise<{rpcId: string, result: unknown}>} the official envelope.
   * @throws {CloudError} a stable failure for the controller.
   */
  async function call(peerId, method, payload, options = {}) {
    const peer = byId.get(peerId);
    if (peer === undefined) throw new CloudError('unknown-peer', `peer ${JSON.stringify(peerId)} is not configured`);
    if (peer.kind === 'relay') {
      if (config.relay.hubUrl === undefined && !config.relay.enabled) {
        throw new CloudError('relay-unavailable', 'this Host neither hosts nor dials a relay');
      }
      const outcome = await deps.relayHub.enqueue({ method, payload });
      return unwrapOutcome(outcome, peer.id);
    }
    return direct(peer, method, payload, options.signal);
  }

  /**
   * Probe one peer, caching direct answers for a few seconds.
   *
   * @param {string} peerId - configured peer id.
   * @param {{signal?: AbortSignal}} [options] - caller cancellation.
   * @returns {Promise<{ok: true, [key: string]: unknown} | {ok: false, code: string, message: string}>} the status.
   */
  async function health(peerId, options = {}) {
    const peer = byId.get(peerId);
    if (peer === undefined) return { ok: false, code: 'unknown-peer', message: `peer ${peerId} is not configured` };
    if (peer.kind === 'relay') {
      const last = deps.relayHub.lastPollAt();
      if (last > 0 && Date.now() - last < SPOKE_FRESH_MS) return { ok: true, mode: 'relay' };
      return { ok: false, code: 'no-spoke', message: 'no spoke is currently connected to this relay' };
    }
    const cached = healthCache.get(peerId);
    if (cached !== undefined && Date.now() - cached.at < HEALTH_TTL_MS) return cached.value;
    const value = await probe(peer, options.signal);
    healthCache.set(peerId, { at: Date.now(), value });
    return value;
  }

  return { list, call, health };
}

/**
 * Call a directly reachable peer over its endpoint HTTP surface.
 *
 * @param {{id: string, baseUrl: string, token: string, timeoutMs: number}} peer - configured peer.
 * @param {string} method - endpoint name.
 * @param {unknown} payload - official payload.
 * @param {AbortSignal} [signal] - caller cancellation.
 * @returns {Promise<{rpcId: string, result: unknown}>} the official envelope.
 */
async function direct(peer, method, payload, signal) {
  let response;
  try {
    response = await httpRequest(new URL(`${ENDPOINT_PREFIX}/rpc`, peer.baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders(peer.token, peer.basicAuth) },
      body: JSON.stringify({ method, payload }),
      timeoutMs: peer.timeoutMs,
      signal,
      allowInsecureTls: peer.allowInsecureTls,
    });
  } catch (error) {
    if (signal?.aborted) throw new CloudError('timeout', `peer ${peer.id} was cancelled or timed out`, error);
    throw new CloudError('unreachable', `peer ${peer.id} is unreachable: ${String(error)}`, error);
  }
  if (response.status === 401) {
    throw new CloudError('unauthorized', `peer ${peer.id} refused the credential (shared token or reverse-proxy Basic auth)`);
  }
  if (response.status !== 200) {
    throw new CloudError('upstream-http', `peer ${peer.id} returned HTTP ${response.status}`);
  }
  return unwrapOutcome(parseBody(response.text, peer.id), peer.id);
}

/**
 * Probe a direct peer's `/health` endpoint.
 *
 * @param {{id: string, baseUrl: string, token: string, timeoutMs: number}} peer - configured peer.
 * @param {AbortSignal} [signal] - caller cancellation.
 * @returns {Promise<{ok: true, [key: string]: unknown} | {ok: false, code: string, message: string}>} the status.
 */
async function probe(peer, signal) {
  try {
    const response = await httpRequest(new URL(`${ENDPOINT_PREFIX}/health`, peer.baseUrl), {
      headers: authHeaders(peer.token, peer.basicAuth),
      timeoutMs: Math.min(peer.timeoutMs, HEALTH_TTL_MS),
      signal,
      allowInsecureTls: peer.allowInsecureTls,
    });
    if (response.status === 401) return { ok: false, code: 'unauthorized', message: 'peer refused the credential (shared token or reverse-proxy Basic auth)' };
    if (response.status !== 200) return { ok: false, code: `http-${response.status}`, message: `peer returned HTTP ${response.status}` };
    const body = parseBody(response.text, peer.id);
    if (body.ok !== true) return { ok: false, code: 'refused', message: 'peer health reported a failure' };
    return { ok: true, ...body };
  } catch (error) {
    if (signal?.aborted) return { ok: false, code: 'timeout', message: `peer ${peer.id} did not answer in time` };
    return { ok: false, code: 'unreachable', message: `peer ${peer.id} is unreachable: ${String(error)}` };
  }
}

/**
 * Parse one endpoint body.
 *
 * @param {string} text - response text.
 * @param {string} peerId - peer name for diagnostics.
 * @returns {Record<string, unknown>} the parsed object.
 * @throws {CloudError} `protocol` on a malformed body.
 */
function parseBody(text, peerId) {
  let body;
  try {
    body = JSON.parse(text);
  } catch (error) {
    throw new CloudError('protocol', `peer ${peerId} returned a non-JSON body`, error);
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new CloudError('protocol', `peer ${peerId} returned an unexpected body`);
  }
  return body;
}

/**
 * Turn one endpoint/relay outcome into the official envelope.
 *
 * @param {unknown} outcome - `{ok: true, response}` or `{ok: false, error}`.
 * @param {string} peerId - peer name for diagnostics.
 * @returns {{rpcId: string, result: unknown}} the official envelope.
 * @throws {CloudError} `upstream/<code>` carrying the peer's own failure.
 */
function unwrapOutcome(outcome, peerId) {
  if (outcome === null || typeof outcome !== 'object') {
    throw new CloudError('protocol', `peer ${peerId} returned no outcome`);
  }
  if (outcome.ok === true && outcome.response !== null && typeof outcome.response === 'object') return outcome.response;
  const error = typeof outcome.error === 'object' && outcome.error !== null ? outcome.error : {};
  const code = typeof error.code === 'string' ? error.code : 'unknown';
  const message = typeof error.message === 'string' ? error.message : `peer ${peerId} failed the call`;
  throw new CloudError(`upstream/${code}`, message);
}
