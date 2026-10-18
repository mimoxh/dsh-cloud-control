import test from 'node:test';
import assert from 'node:assert/strict';
import { toRows } from '../lib/transcript.mjs';

/** Wrap one session event the way `session/page` returns it. */
const entry = (type, seq, data, extra = {}) => ({ type: 'event', event: { type, seq, time: seq * 1000, data, ...extra } });

test('maps surface events to chronological rows', () => {
  const rows = toRows([
    entry('user/message', 1, { role: 'user', content: [{ type: 'text', text: '你好' }], source: { kind: 'user' } }),
    entry('assistant/message', 2, {
      turn: 1,
      step: 1,
      message: { role: 'assistant', content: [{ type: 'reasoning', text: '先看日志' }, { type: 'text', text: '收到' }] }
    }),
    entry('tool/call', 3, { callId: 'c1', name: 'bash', arguments: '{"command":"npm test"}' }),
    entry('tool/result', 4, { message: { role: 'tool', content: [{ type: 'text', text: 'PASS' }] }, name: 'bash' }),
    entry('request/header', 5, { reason: 'initial' })
  ]);

  assert.deepEqual(rows.map((row) => [row.seq, row.role, row.kind]), [
    [1, 'user', 'message'],
    [2, 'assistant', 'message'],
    [3, 'tool', 'call'],
    [4, 'tool', 'result']
  ]);
  assert.equal(rows[0].text, '你好');
  assert.equal(rows[0].source, 'user');
  assert.equal(rows[1].text, '收到');
  assert.equal(rows[1].reasoning, '先看日志');
  assert.equal(rows[2].name, 'bash');
  assert.match(rows[2].text, /npm test/u);
  assert.equal(rows[3].text, 'PASS');
});

test('sorts out-of-order pages and keeps one row per sequence', () => {
  const rows = toRows([
    entry('assistant/message', 9, { message: { content: [{ type: 'text', text: 'later' }] } }),
    entry('user/message', 4, { content: [{ type: 'text', text: 'earlier' }] })
  ]);
  assert.deepEqual(rows.map((row) => row.seq), [4, 9]);
});

test('renders non-text blocks as placeholders and flags interrupted turns', () => {
  const rows = toRows([
    entry('user/message', 1, { content: [{ type: 'text', text: '看图' }, { type: 'image', mediaType: 'image/png' }, { type: 'file', receiptId: 'r1' }] }),
    entry('assistant/message', 2, { message: { content: [{ type: 'text', text: 'partial' }] }, interrupted: true })
  ]);
  assert.equal(rows[0].text, '看图\n[image]\n[file]');
  assert.equal(rows[1].interrupted, true);
});

test('marks failed tool results', () => {
  const rows = toRows([entry('tool/result', 1, { error: { message: 'boom' }, name: 'bash' })]);
  assert.equal(rows[0].error, true);
  assert.equal(rows[0].text, 'boom');
});

test('ignores malformed records', () => {
  assert.deepEqual(toRows([null, 42, { type: 'event' }, { type: 'event', event: {} }]), []);
  assert.deepEqual(toRows(undefined), []);
});
