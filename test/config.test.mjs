import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig } from '../lib/config.mjs';

test('defaults to a controller with no peers', () => {
  const config = normalizeConfig(undefined);
  assert.equal(config.role, 'controller');
  assert.equal(config.endpoint.enabled, false);
  assert.deepEqual(config.peers, []);
  assert.equal(config.pollIntervalMs, 2000);
  assert.equal(config.maxMessages, 60);
  assert.equal(config.relay.enabled, false);
  assert.equal(config.relay.hubUrl, undefined);
});

test('the endpoint role requires a shared token', () => {
  assert.throws(() => normalizeConfig({ role: 'endpoint' }), /endpoint\.token/u);
  const config = normalizeConfig({ role: 'endpoint', endpoint: { token: 'shared' } });
  assert.equal(config.endpoint.enabled, true);
  assert.equal(config.endpoint.token, 'shared');
  assert.ok(config.endpoint.allowMethods.includes('session/prompt'));
});

test('reads secrets from the environment', () => {
  process.env.CLOUD_CONTROL_TEST_TOKEN = 'from-env';
  const config = normalizeConfig({ endpoint: { enabled: true, tokenEnv: 'CLOUD_CONTROL_TEST_TOKEN' } });
  assert.equal(config.endpoint.token, 'from-env');
  delete process.env.CLOUD_CONTROL_TEST_TOKEN;
});

test('validates peers', () => {
  const config = normalizeConfig({
    peers: [{ id: 'nas', label: 'NAS', baseUrl: 'http://10.0.0.2:3080/', token: 't' }]
  });
  assert.equal(config.peers[0].baseUrl, 'http://10.0.0.2:3080');
  assert.equal(config.peers[0].kind, 'direct');
  assert.throws(() => normalizeConfig({ peers: [{}] }), /id must match/u);
  assert.throws(() => normalizeConfig({ peers: [{ id: 'a', token: 't' }] }), /baseUrl is required/u);
  assert.throws(() => normalizeConfig({ peers: [{ id: 'a', kind: 'relay' }] }), /token or tokenEnv/u);
  assert.throws(() => normalizeConfig({ peers: [{ id: 'a', baseUrl: 'ftp://x', token: 't' }] }), /must be http/u);
  assert.throws(() => normalizeConfig({ peers: [{ id: 'a', kind: 'weird', baseUrl: 'http://x', token: 't' }] }), /must be direct or relay/u);
});

test('separates relay hub from relay spoke', () => {
  const hub = normalizeConfig({ role: 'endpoint', endpoint: { token: 'shared' }, relay: { enabled: true } });
  assert.equal(hub.relay.enabled, true);
  assert.equal(hub.relay.hubUrl, undefined);
  const spoke = normalizeConfig({ relay: { enabled: true, hubUrl: 'http://10.0.0.2:3080/cloud-control/v1/relay/', token: 't' } });
  assert.equal(spoke.relay.hubUrl, 'http://10.0.0.2:3080/cloud-control/v1/relay');
  assert.equal(spoke.relay.token, 't');
  assert.throws(() => normalizeConfig({ relay: { hubUrl: 'http://x' } }), /relay\.token/u);
  assert.throws(() => normalizeConfig({ relay: { enabled: true } }), /requires an enabled endpoint/u);
  assert.throws(() => normalizeConfig({ relay: { hubUrl: 'not-a-url', token: 't' } }), /not a URL/u);
});

test('accepts reverse-proxy Basic auth and self-signed TLS per peer', () => {
  const config = normalizeConfig({
    peers: [{
      id: 'nas',
      baseUrl: 'https://192.168.1.10:10443',
      token: 't',
      basicAuth: { username: 'admin', password: 'secret' },
      allowInsecureTls: true
    }]
  });
  assert.deepEqual(config.peers[0].basicAuth, { user: 'admin', password: 'secret' });
  assert.equal(config.peers[0].allowInsecureTls, true);
  assert.throws(() => normalizeConfig({ peers: [{ id: 'a', baseUrl: 'http://x', token: 't', basicAuth: { user: 'u' } }] }), /requires user and password/u);

  const relay = normalizeConfig({
    relay: { hubUrl: 'https://nas:10443/cloud-control/v1/relay', token: 't', basicAuth: { user: 'u', password: 'p' }, allowInsecureTls: true }
  });
  assert.deepEqual(relay.relay.basicAuth, { user: 'u', password: 'p' });
  assert.equal(relay.relay.allowInsecureTls, true);
});

test('rejects an unknown role', () => {
  assert.throws(() => normalizeConfig({ role: 'server' }), /role must be one of/u);
});
