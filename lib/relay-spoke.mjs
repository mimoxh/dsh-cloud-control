import { CloudError } from './errors.mjs';

/** Upper bound on the reconnect backoff. */
const MAX_BACKOFF_MS = 60000;

/**
 * Spoke half of the relay: dial a hub and answer the requests it queues.
 *
 * The DSH Desktop Host listens on loopback, so another machine cannot reach it.
 * A spoke deployment therefore dials out to the hub the user can reach and
 * long-polls for work; each request is executed against this Host's own `/api`
 * and the outcome is posted back. No inbound port is opened on the spoke.
 *
 * @param {{effect(dispose: () => () => void, label: string): () => void}} ctx - Host context.
 * @param {ReturnType<import('./config.mjs').normalizeConfig>} config - normalized configuration.
 * @param {{localRpc: ReturnType<import('./local-rpc.mjs').createLocalRpc>}} deps - local Host bridge.
 * @returns {boolean} whether a spoke loop was started.
 */
export function startRelaySpoke(ctx, config, deps) {
  const hubUrl = config.relay.hubUrl;
  if (hubUrl === undefined) return false;
  const token = config.relay.token;
  const allowed = new Set(config.endpoint.allowMethods);
  const controller = new AbortController();
  let stopped = false;

  /**
   * Execute one hub request against this Host.
   *
   * @param {{method: string, payload: unknown}} request - queued request.
   * @returns {Promise<Record<string, unknown>>} endpoint-shaped outcome.
   */
  async function execute(request) {
    if (typeof request.method !== 'string' || !allowed.has(request.method)) {
      return { ok: false, error: { code: 'method-not-allowed', message: `${String(request.method)} is not in endpoint.allowMethods` } };
    }
    try {
      const envelope = await deps.localRpc.call(request.method, request.payload, { signal: controller.signal });
      return {
        ok: true,
        response: { type: 'server-response', rpcId: envelope.rpcId, result: envelope.result },
      };
    } catch (error) {
      return {
        ok: false,
        error: {
          code: error instanceof CloudError ? error.code : 'internal',
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  /**
   * @param {Record<string, unknown>} outcome - endpoint-shaped outcome.
   * @param {string} id - request id.
   * @returns {Promise<void>} settles after the hub acknowledged the outcome.
   */
  async function postResult(id, outcome) {
    const response = await fetch(`${hubUrl}/result`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ id, ...outcome }),
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
      redirect: 'error',
    });
    await response.body?.cancel();
    if (!response.ok) throw new CloudError('hub-http', `hub returned HTTP ${response.status} for the result`);
  }

  /**
   * One poll: take at most one request, execute it, post the outcome.
   *
   * @returns {Promise<void>} settles when the poll cycle finished.
   */
  async function pollOnce() {
    const url = new URL(`${hubUrl}/poll`);
    url.searchParams.set('spoke', config.displayName);
    url.searchParams.set('wait', String(config.relay.waitMs));
    const response = await fetch(url, {
      headers: { authorization: `Bearer ${token}` },
      signal: controller.signal,
      redirect: 'error',
    });
    if (response.status === 401) {
      await response.body?.cancel();
      throw new CloudError('unauthorized', 'the hub rejected the shared token');
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new CloudError('hub-http', `hub returned HTTP ${response.status}`);
    }
    const body = await response.json();
    if (body === null || typeof body !== 'object' || body.ok !== true) {
      throw new CloudError('protocol', 'hub returned an unexpected poll body');
    }
    const request = body.request;
    if (request === null || request === undefined) return;
    const outcome = await execute(request);
    await postResult(request.id, outcome);
  }

  /**
   * Poll until the plugin unloads, backing off on transport failures.
   *
   * @returns {Promise<void>} settles when the loop stops.
   */
  async function loop() {
    let backoff = config.relay.errorBackoffMs;
    while (!stopped) {
      try {
        await pollOnce();
        backoff = config.relay.errorBackoffMs;
      } catch (error) {
        if (stopped || controller.signal.aborted) return;
        await wait(backoff + jitter(backoff), controller.signal);
        backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
        void error;
      }
    }
  }

  void loop().catch(() => {});

  ctx.effect(() => () => {
    stopped = true;
    controller.abort();
  }, 'cloud-control: relay spoke');

  return true;
}

/**
 * Sleep for one bounded interval, waking early on cancellation.
 *
 * @param {number} ms - delay.
 * @param {AbortSignal} signal - cancellation.
 * @returns {Promise<void>} settles after the delay or abort.
 */
function wait(ms, signal) {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(finish, ms);
    timer.unref?.();
    function finish() {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    }
    signal.addEventListener('abort', finish, { once: true });
  });
}

/**
 * @param {number} base - base interval.
 * @returns {number} a bounded random jitter.
 */
function jitter(base) {
  return Math.floor(Math.random() * Math.min(base, 5000));
}
