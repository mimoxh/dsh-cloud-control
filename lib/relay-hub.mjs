import { randomUUID } from 'node:crypto';
import { CloudError } from './errors.mjs';

/**
 * A small request queue that lets a spoke pull work out of the hub.
 *
 * The hub never opens a port on the spoke and never depends on reaching it:
 * a spoke behind NAT (the DSH Desktop Host listens on loopback) dials the hub
 * and long-polls `take()`. Requests carry a TTL so a vanished spoke produces a
 * prompt `timeout` instead of a hung caller.
 *
 * @param {{maxQueue?: number, requestTtlMs?: number}} [options] - bounds.
 * @returns {{
 *   enqueue(request: {method: string, payload: unknown}): Promise<unknown>,
 *   take(waitMs: number, signal?: AbortSignal): Promise<{id: string, method: string, payload: unknown} | null>,
 *   settle(id: string, outcome: unknown): boolean,
 *   dispose(): void,
 *   lastPollAt(): number,
 *   readonly size: number,
 * }} the hub.
 */
export function createRelayHub(options = {}) {
  const maxQueue = options.maxQueue ?? 32;
  const requestTtlMs = options.requestTtlMs ?? 30000;

  /** @type {{id: string, method: string, payload: unknown}[]} */
  const queue = [];
  /** @type {Array<(request: {id: string, method: string, payload: unknown} | null) => void>} */
  const waiters = [];
  /** @type {Map<string, {resolve: (value: unknown) => void, timer: NodeJS.Timeout}>} */
  const pending = new Map();
  let lastPoll = 0;
  let disposed = false;

  /**
   * Queue one request for the next spoke poll.
   *
   * @param {{method: string, payload: unknown}} request - what the spoke must execute.
   * @returns {Promise<unknown>} the spoke's outcome, shaped like the endpoint `/rpc` body.
   */
  function enqueue(request) {
    if (disposed) throw new CloudError('relay-disposed', 'the relay hub is shutting down');
    if (pending.size >= maxQueue) throw new CloudError('relay-busy', `the relay already holds ${pending.size} requests`);
    const id = randomUUID();
    const queued = { id, method: request.method, payload: request.payload };
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        resolve({ ok: false, error: { code: 'relay-timeout', message: 'no connected spoke answered in time' } });
      }, requestTtlMs);
      timer.unref?.();
      pending.set(id, { resolve, timer });
      const waiter = waiters.shift();
      if (waiter !== undefined) waiter(queued);
      else queue.push(queued);
    });
  }

  /**
   * Hand the next queued request to a polling spoke, waiting up to `waitMs`.
   *
   * @param {number} waitMs - long-poll budget.
   * @param {AbortSignal} [signal] - request cancellation (client disconnect).
   * @returns {Promise<{id: string, method: string, payload: unknown} | null>} the request, or null.
   */
  function take(waitMs, signal) {
    lastPoll = Date.now();
    if (disposed) return Promise.resolve(null);
    const next = queue.shift();
    if (next !== undefined) return Promise.resolve(next);
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        resolve(value);
      };
      const waiter = (request) => {
        finish(request);
      };
      const onAbort = () => {
        const index = waiters.indexOf(waiter);
        if (index >= 0) waiters.splice(index, 1);
        finish(null);
      };
      const timer = setTimeout(() => {
        const index = waiters.indexOf(waiter);
        if (index >= 0) waiters.splice(index, 1);
        finish(null);
      }, waitMs);
      timer.unref?.();
      signal?.addEventListener('abort', onAbort, { once: true });
      waiters.push(waiter);
    });
  }

  /**
   * Deliver one spoke outcome to the waiting caller.
   *
   * @param {string} id - request id.
   * @param {unknown} outcome - the endpoint-shaped `{ok, response|error}` body.
   * @returns {boolean} whether a caller was waiting.
   */
  function settle(id, outcome) {
    const record = pending.get(id);
    if (record === undefined) return false;
    pending.delete(id);
    clearTimeout(record.timer);
    record.resolve(outcome);
    return true;
  }

  /** Release every waiter and pending caller. */
  function dispose() {
    disposed = true;
    for (const waiter of waiters.splice(0)) waiter(null);
    for (const [id, record] of pending) {
      clearTimeout(record.timer);
      record.resolve({ ok: false, error: { code: 'relay-disposed', message: 'the relay hub shut down' } });
      pending.delete(id);
    }
    queue.length = 0;
  }

  return {
    enqueue,
    take,
    settle,
    dispose,
    lastPollAt: () => lastPoll,
    get size() {
      return pending.size;
    },
  };
}
