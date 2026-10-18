import test from 'node:test';
import assert from 'node:assert/strict';
import { bearerOf, resolveSecret, sourceAllowed, tokenMatches } from '../lib/auth.mjs';

test('reads a bearer token from Node and Web headers', () => {
  assert.equal(bearerOf({ headers: { authorization: 'Bearer abc' } }), 'abc');
  assert.equal(bearerOf({ headers: { authorization: 'bearer  spaced  ' } }), 'spaced');
  assert.equal(bearerOf({ headers: { authorization: ['Bearer first', 'Bearer second'] } }), 'first');
  assert.equal(bearerOf({ headers: new Headers({ authorization: 'Bearer web' }) }), 'web');
  assert.equal(bearerOf({ headers: {} }), undefined);
  assert.equal(bearerOf({ headers: { authorization: 'Basic abc' } }), undefined);
});

test('compares tokens without leaking length', () => {
  assert.equal(tokenMatches('same', 'same'), true);
  assert.equal(tokenMatches('same', 'other'), false);
  assert.equal(tokenMatches('short', 'a-much-longer-token'), false);
  assert.equal(tokenMatches(undefined, 'x'), false);
  assert.equal(tokenMatches('x', ''), false);
  assert.equal(tokenMatches('x', undefined), false);
});

test('resolves secrets from inline values, then environment', () => {
  assert.equal(resolveSecret('inline', 'UNUSED', { UNUSED: 'env' }), 'inline');
  assert.equal(resolveSecret(undefined, 'TOKEN', { TOKEN: 'env' }), 'env');
  assert.equal(resolveSecret('', 'TOKEN', { TOKEN: 'env' }), 'env');
  assert.equal(resolveSecret(undefined, 'MISSING', {}), undefined);
  assert.equal(resolveSecret(undefined, undefined, {}), undefined);
});

test('allows every source when no allowlist is configured', () => {
  assert.equal(sourceAllowed('203.0.113.5', []), true);
  assert.equal(sourceAllowed(undefined, []), true);
});

test('matches exact addresses, CIDR blocks, loopback and IPv4-mapped sources', () => {
  assert.equal(sourceAllowed('10.0.0.5', ['10.0.0.5']), true);
  assert.equal(sourceAllowed('10.0.0.6', ['10.0.0.5']), false);
  assert.equal(sourceAllowed('10.1.2.3', ['10.0.0.0/8']), true);
  assert.equal(sourceAllowed('11.1.2.3', ['10.0.0.0/8']), false);
  assert.equal(sourceAllowed('192.168.1.7', ['192.168.0.0/16']), true);
  assert.equal(sourceAllowed('127.0.0.1', ['loopback']), true);
  assert.equal(sourceAllowed('10.0.0.1', ['loopback']), false);
  assert.equal(sourceAllowed('::ffff:192.168.1.7', ['192.168.0.0/16']), true);
  assert.equal(sourceAllowed(undefined, ['10.0.0.0/8']), false);
  assert.equal(sourceAllowed('not-an-address', ['10.0.0.0/8']), false);
  assert.equal(sourceAllowed('10.0.0.5', ['10.0.0.0/33']), false);
  assert.equal(sourceAllowed('10.0.0.5', ['10.0.0.0/0']), true);
});
