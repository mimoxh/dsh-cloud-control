import test from 'node:test';
import assert from 'node:assert/strict';
import { createRelayHub } from '../lib/relay-hub.mjs';

test('delivers a queued request to a polling spoke and settles it', async () => {
  const hub = createRelayHub({ maxQueue: 4, requestTtlMs: 1000 });
  const pending = hub.enqueue({ method: 'session/list', payload: { args: { _request: {} } } });
  const request = await hub.take(1000);
  assert.equal(request.method, 'session/list');
  assert.ok(hub.lastPollAt() > 0);
  assert.equal(hub.settle(request.id, { ok: true, response: { rpcId: 'r', result: { ok: true, value: { items: [] } } } }), true);
  assert.deepEqual(await pending, { ok: true, response: { rpcId: 'r', result: { ok: true, value: { items: [] } } } });
  assert.equal(hub.settle(request.id, { ok: true }), false);
  hub.dispose();
});

test('answers a poll with null when nothing is queued', async () => {
  const hub = createRelayHub({ requestTtlMs: 1000 });
  const started = Date.now();
  assert.equal(await hub.take(30), null);
  assert.ok(Date.now() - started >= 25);
  hub.dispose();
});

test('times out a request whose spoke never answers', async () => {
  const hub = createRelayHub({ requestTtlMs: 30 });
  const outcome = await hub.enqueue({ method: 'session/list', payload: {} });
  assert.deepEqual(outcome, { ok: false, error: { code: 'relay-timeout', message: 'no connected spoke answered in time' } });
  hub.dispose();
});

test('bounds the queue', async () => {
  const hub = createRelayHub({ maxQueue: 1, requestTtlMs: 1000 });
  const first = hub.enqueue({ method: 'a/b', payload: {} });
  assert.throws(() => hub.enqueue({ method: 'a/c', payload: {} }), /relay already holds/u);
  const request = await hub.take(100);
  hub.settle(request.id, { ok: true, response: {} });
  await first;
  hub.dispose();
});

test('dispose releases an idle waiter and fails pending callers', async () => {
  const idle = createRelayHub({ requestTtlMs: 5000 });
  const waiting = idle.take(5000);
  idle.dispose();
  assert.equal(await waiting, null);

  const busy = createRelayHub({ requestTtlMs: 5000 });
  const pending = busy.enqueue({ method: 'a/b', payload: {} });
  busy.dispose();
  assert.deepEqual(await pending, { ok: false, error: { code: 'relay-disposed', message: 'the relay hub shut down' } });
});

test('cancellation ends a long poll without leaving a waiter behind', async () => {
  const hub = createRelayHub({ requestTtlMs: 5000 });
  const abort = new AbortController();
  const waiting = hub.take(5000, abort.signal);
  abort.abort();
  assert.equal(await waiting, null);
  // A later enqueue must still be delivered: the aborted waiter is gone.
  const pending = hub.enqueue({ method: 'a/b', payload: {} });
  const request = await hub.take(100);
  assert.equal(request.method, 'a/b');
  hub.settle(request.id, { ok: true, response: {} });
  await pending;
  hub.dispose();
});
