import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createLocalRpc, inspectWebServerOrigin, resolveWebServerOrigin } from '../lib/local-rpc.mjs';
import { CloudError } from '../lib/errors.mjs';

/**
 * Start one throwaway HTTP server and return its origin plus a stop handle.
 *
 * @param {import('node:http').RequestListener} handler - request handler.
 * @returns {Promise<{origin: string, port: number, stop(): Promise<void>}>} the running server.
 */
async function withServer(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    origin: `http://127.0.0.1:${port}`,
    port,
    async stop() {
      await new Promise((resolve) => server.close(resolve));
    }
  };
}

/**
 * A Host context stand-in with only the members `createLocalRpc` reads.
 *
 * @param {object} webServer - the `webServer` service stand-in.
 * @param {(base: string) => string} authenticatedUrl - launch-token URL builder.
 * @returns {{webServer: object, connection: {authenticatedUrl(base: string): string}}} the context.
 */
function context(webServer, authenticatedUrl = (base) => `${base}/connect?token=fake`) {
  return { webServer, connection: { authenticatedUrl } };
}

/**
 * Read one request body as text.
 *
 * @param {import('node:http').IncomingMessage} request - incoming request.
 * @returns {Promise<string>} the body.
 */
async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

test('uses the official getOrigin() when the carrier answers', () => {
  const webServer = { getOrigin: () => 'http://127.0.0.1:3080', protocol: 'http:', port: 9, host: '0.0.0.0' };
  assert.equal(resolveWebServerOrigin(webServer), 'http://127.0.0.1:3080');
  const resolved = inspectWebServerOrigin(webServer);
  assert.equal(resolved.via, 'getOrigin');
  assert.deepEqual(resolved.reasons, []);
});

test('falls back to protocol/port when getOrigin() throws', () => {
  const webServer = {
    getOrigin() {
      throw new Error('webserver: origin read before the listener bound a port');
    },
    protocol: 'https:',
    port: 39180,
    host: '127.0.0.1'
  };
  const resolved = inspectWebServerOrigin(webServer);
  assert.equal(resolved.origin, 'https://127.0.0.1:39180');
  assert.equal(resolved.via, 'protocol/port');
  assert.match(resolved.reasons.join(' '), /getOrigin\(\) failed: Error: webserver: origin read before the listener bound a port/u);
});

test('falls back to protocol/port when the carrier has no getOrigin at all', () => {
  const resolved = inspectWebServerOrigin({ protocol: 'http:', port: 3080, host: '192.168.1.10' });
  assert.equal(resolved.origin, 'http://192.168.1.10:3080');
  assert.match(resolved.reasons.join(' '), /getOrigin is not a function \(undefined\)/u);
});

test('accepts a bare protocol spelling and brackets IPv6 hosts', () => {
  const resolved = inspectWebServerOrigin({ protocol: 'https', port: 8443, host: '::1' });
  assert.equal(resolved.origin, 'https://[::1]:8443');
});

test('tolerates a foreign carrier that spells protocol and port differently', () => {
  assert.equal(resolveWebServerOrigin({ protocol: 'HTTPS:', port: 8443, host: '127.0.0.1' }), 'https://127.0.0.1:8443');
  assert.equal(resolveWebServerOrigin({ protocol: 'http', port: '3080', host: '127.0.0.1' }), 'http://127.0.0.1:3080');
  assert.throws(() => resolveWebServerOrigin({ protocol: 'ftp:', port: 3080 }), /protocol is string "ftp:", not "http:" or "https:"/u);
  assert.throws(() => resolveWebServerOrigin({ protocol: 'http:', port: 0 }), /port is number 0, not a bound TCP port/u);
});

test('falls back to IPv4 loopback for a wildcard or unusable bind host', () => {
  assert.equal(resolveWebServerOrigin({ protocol: 'http:', port: 3080, host: '0.0.0.0' }), 'http://127.0.0.1:3080');
  assert.equal(resolveWebServerOrigin({ protocol: 'http:', port: 3080, host: '::1%lo' }), 'http://[::1]:3080');
  assert.equal(resolveWebServerOrigin({ protocol: 'http:', port: 3080 }), 'http://127.0.0.1:3080');
});

test('ignores a getOrigin() that returns something unusable', () => {
  const resolved = inspectWebServerOrigin({ getOrigin: () => '', protocol: 'http:', port: 3080 });
  assert.equal(resolved.origin, 'http://127.0.0.1:3080');
  assert.match(resolved.reasons.join(' '), /getOrigin\(\) returned string ""/u);

  const notAUrl = inspectWebServerOrigin({ getOrigin: () => '127.0.0.1:3080', protocol: 'http:', port: 3080 });
  assert.equal(notAUrl.origin, 'http://127.0.0.1:3080');
  assert.match(notAUrl.reasons.join(' '), /non-URL string "127\.0\.0\.1:3080"/u);
});

test('reports every reason and the carrier members when nothing resolves', () => {
  const webServer = {
    getOrigin() {
      throw new TypeError('ctx.webServer.getOrigin is not a function');
    },
    register: () => () => {}
  };
  const error = (() => {
    try {
      resolveWebServerOrigin(webServer);
      return undefined;
    } catch (thrown) {
      return thrown;
    }
  })();
  assert.ok(error instanceof CloudError, 'expected a CloudError');
  assert.equal(error.code, 'not-ready');
  assert.match(error.message, /getOrigin\(\) failed: TypeError: ctx\.webServer\.getOrigin is not a function/u);
  assert.match(error.message, /protocol is undefined, not "http:" or "https:"/u);
  assert.match(error.message, /port is undefined, not a bound TCP port/u);
  assert.match(error.message, /webServer members \[getOrigin: function, protocol: undefined, port: undefined, host: undefined, register: function\]/u);
  assert.match(error.message, /webServer own keys \[getOrigin, register\]/u);
  assert.ok(error.cause instanceof TypeError, 'the accessor failure stays attached');
});

test('survives a carrier that is missing, foreign, or throws from a getter', () => {
  for (const webServer of [undefined, null, 'http://127.0.0.1:3080', 42]) {
    const error = (() => {
      try {
        resolveWebServerOrigin(webServer);
        return undefined;
      } catch (thrown) {
        return thrown;
      }
    })();
    assert.ok(error instanceof CloudError, `expected a CloudError for ${String(webServer)}`);
    assert.match(error.message, /the DSH webserver origin is unavailable/u);
  }

  const hostile = {
    get getOrigin() {
      throw new Error('getter exploded');
    },
    get protocol() {
      throw new Error('getter exploded');
    }
  };
  const error = (() => {
    try {
      resolveWebServerOrigin(hostile);
      return undefined;
    } catch (thrown) {
      return thrown;
    }
  })();
  assert.ok(error instanceof CloudError);
  assert.match(error.message, /getOrigin is not a function \(undefined\)/u);
  assert.match(error.message, /protocol is undefined/u);
  assert.match(error.message, /getOrigin: getter threw Error: getter exploded/u);
});

test('carries a non-Error throw into the diagnosis', () => {
  const error = (() => {
    try {
      resolveWebServerOrigin({ getOrigin: () => { throw 'no origin'; } });
      return undefined;
    } catch (thrown) {
      return thrown;
    }
  })();
  assert.match(error.message, /getOrigin\(\) failed: string no origin/u);
  assert.equal(error.cause, 'no origin');
});

test('reads the exposed listener socket when the carrier hides its port', () => {
  const resolved = inspectWebServerOrigin({
    protocol: 'http:',
    server: { address: () => ({ address: '127.0.0.1', family: 'IPv4', port: 3081 }) }
  });
  assert.equal(resolved.origin, 'http://127.0.0.1:3081');
  assert.equal(resolved.via, 'webServer.server');
  assert.match(resolved.reasons.join(' '), /port is undefined, not a bound TCP port/u);

  const wildcard = inspectWebServerOrigin({
    protocol: 'http:',
    host: '0.0.0.0',
    server: { address: () => ({ address: '::', family: 'IPv6', port: 3082 }) }
  });
  assert.equal(wildcard.origin, 'http://127.0.0.1:3082');
});

test('falls through a broken listener socket to the full diagnosis', () => {
  let error;
  try {
    resolveWebServerOrigin({
      protocol: 'http:',
      server: {
        address() {
          throw new Error('server is closed');
        }
      }
    });
  } catch (thrown) {
    error = thrown;
  }
  assert.ok(error instanceof CloudError, 'expected a CloudError');
  assert.equal(error.code, 'not-ready');
  assert.match(error.message, /webServer\.server\.address\(\) threw: Error: server is closed/u);
  assert.match(error.message, /webServer members \[/u);
});

test('calls the Host API with a minted cookie when getOrigin() answers', async () => {
  let connects = 0;
  let cookie;
  const server = await withServer(async (request, response) => {
    if (request.url.startsWith('/connect')) {
      connects += 1;
      response.writeHead(302, { 'set-cookie': 'dsh_api=abc123; Path=/; HttpOnly' });
      response.end();
      return;
    }
    assert.equal(request.headers.cookie, 'dsh_api=abc123');
    const envelope = JSON.parse(await readBody(request));
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({
      type: 'server-response',
      rpcId: envelope.rpcId,
      result: { ok: true, value: { sessions: [] } }
    }));
  });
  try {
    const rpc = createLocalRpc(context({ getOrigin: () => server.origin }));
    const first = await rpc.call('session/list', { args: {} });
    assert.deepEqual(first.result, { ok: true, value: { sessions: [] } });
    await rpc.call('session/list', { args: {} });
    assert.equal(connects, 1, 'one cookie is reused for the plugin lifetime');
    assert.ok(cookie === undefined || cookie === 'dsh_api=abc123');
  } finally {
    await server.stop();
  }
});

test('re-mints the credential once after a 401 and reuses it afterwards', async () => {
  let connects = 0;
  let calls = 0;
  /** @type {string[]} */
  const cookies = [];
  const server = await withServer(async (request, response) => {
    if (request.url.startsWith('/connect')) {
      connects += 1;
      response.writeHead(302, { 'set-cookie': `dsh_api=c${connects}; Path=/` });
      response.end();
      return;
    }
    calls += 1;
    cookies.push(String(request.headers.cookie));
    const envelope = JSON.parse(await readBody(request));
    if (calls === 1) {
      response.writeHead(401, { 'content-type': 'application/json' });
      response.end('{"ok":false,"error":{"code":"unauthorized"}}');
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ type: 'server-response', rpcId: envelope.rpcId, result: { ok: true, value: 'fresh' } }));
  });
  try {
    const rpc = createLocalRpc(context({ getOrigin: () => server.origin }));
    const result = await rpc.call('session/list', { args: {} });
    assert.equal(result.result.value, 'fresh');
    assert.equal(calls, 2, 'one retry after the 401');
    assert.equal(connects, 2, 'the retry mints a fresh credential');
    assert.deepEqual(cookies, ['dsh_api=c1', 'dsh_api=c2']);

    await rpc.call('session/list', { args: {} });
    assert.equal(calls, 3);
    assert.equal(connects, 2, 'the re-minted credential is cached');
  } finally {
    await server.stop();
  }
});

test('rejects a server-response correlated to another rpcId', async () => {
  const server = await withServer(async (request, response) => {
    if (request.url.startsWith('/connect')) {
      response.writeHead(302, { 'set-cookie': 'dsh_api=abc123; Path=/' });
      response.end();
      return;
    }
    await readBody(request);
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ type: 'server-response', rpcId: 'someone-else', result: { ok: true, value: 1 } }));
  });
  try {
    const rpc = createLocalRpc(context({ getOrigin: () => server.origin }));
    const error = await rpc.call('session/list', {}).then(() => undefined, (thrown) => thrown);
    assert.ok(error instanceof CloudError, 'expected a CloudError');
    assert.equal(error.code, 'protocol');
    assert.match(error.message, /local session\/list correlated the wrong rpcId/u);
  } finally {
    await server.stop();
  }
});

test('rejects an envelope that is not a server-response', async () => {
  const server = await withServer(async (request, response) => {
    if (request.url.startsWith('/connect')) {
      response.writeHead(302, { 'set-cookie': 'dsh_api=abc123; Path=/' });
      response.end();
      return;
    }
    await readBody(request);
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ type: 'server-event', event: 'session/list' }));
  });
  try {
    const rpc = createLocalRpc(context({ getOrigin: () => server.origin }));
    const error = await rpc.call('session/list', {}).then(() => undefined, (thrown) => thrown);
    assert.ok(error instanceof CloudError, 'expected a CloudError');
    assert.equal(error.code, 'protocol');
    assert.match(error.message, /local session\/list on http:\/\/127\.0\.0\.1:\d+ returned an unexpected envelope: \{"type":"server-event"/u);
  } finally {
    await server.stop();
  }
});

test('keeps the resolved origin and the fallback reason in an HTTP failure', async () => {
  const server = await withServer(async (request, response) => {
    if (request.url.startsWith('/connect')) {
      response.writeHead(302, { 'set-cookie': 'dsh_api=abc123; Path=/' });
      response.end();
      return;
    }
    await readBody(request);
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end('{"ok":false,"error":{"code":"not-found","message":"no such channel"}}');
  });
  try {
    const rpc = createLocalRpc(context({
      getOrigin() {
        throw new TypeError('ctx.webServer.getOrigin is not a function');
      },
      protocol: 'http:',
      port: server.port,
      host: '127.0.0.1'
    }));
    const error = await rpc.call('session/list', {}).then(() => undefined, (thrown) => thrown);
    assert.ok(error instanceof CloudError, 'expected a CloudError');
    assert.equal(error.code, 'upstream-http');
    assert.match(error.message, new RegExp(`local session/list on http://127\\.0\\.0\\.1:${server.port} returned HTTP 404`, 'u'));
    assert.match(error.message, /the Host serves no POST \/api\/session\/list/u);
    assert.match(error.message, /origin from the protocol\/port fallback because getOrigin\(\) failed: TypeError/u);
    assert.match(error.message, /no such channel/u, 'the Host body preview reaches the caller');
  } finally {
    await server.stop();
  }
});

test('names the origin and the reason when the fallback origin is unreachable', async () => {
  // Port 1 is reserved and unbound: the composed origin exists but nothing answers.
  const rpc = createLocalRpc(context({ protocol: 'http:', port: 1, host: '127.0.0.1' }));
  const error = await rpc.call('session/list', {}).then(() => undefined, (thrown) => thrown);
  assert.ok(error instanceof CloudError, 'expected a CloudError');
  assert.equal(error.code, 'internal');
  assert.match(error.message, /local session\/list on http:\/\/127\.0\.0\.1:1 could not be reached/u);
  assert.match(error.message, /origin from the protocol\/port fallback because getOrigin is not a function/u);
});

test('reports a refused credential exchange with the body preview', async () => {
  const server = await withServer((_request, response) => {
    response.writeHead(404, { 'content-type': 'text/plain' });
    response.end('no /connect on this build');
  });
  try {
    const rpc = createLocalRpc(context({ getOrigin: () => server.origin }));
    const error = await rpc.call('session/list', {}).then(() => undefined, (thrown) => thrown);
    assert.ok(error instanceof CloudError, 'expected a CloudError');
    assert.equal(error.code, 'internal');
    assert.match(error.message, /POST \/connect on http:\/\/127\.0\.0\.1:\d+ returned HTTP 404: no \/connect on this build/u);
  } finally {
    await server.stop();
  }
});

test('reports a non-JSON Host body with its status and preview', async () => {
  const server = await withServer(async (request, response) => {
    if (request.url.startsWith('/connect')) {
      response.writeHead(302, { 'set-cookie': 'dsh_api=abc123; Path=/' });
      response.end();
      return;
    }
    await readBody(request);
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end('<html>index</html>');
  });
  try {
    const rpc = createLocalRpc(context({ getOrigin: () => server.origin }));
    const error = await rpc.call('session/list', {}).then(() => undefined, (thrown) => thrown);
    assert.ok(error instanceof CloudError, 'expected a CloudError');
    assert.equal(error.code, 'protocol');
    assert.match(error.message, /returned a non-JSON body \(HTTP 200\): <html>index<\/html>/u);
  } finally {
    await server.stop();
  }
});

test('fails before any network call when the origin cannot be resolved', async () => {
  const error = await createLocalRpc(context({})).call('session/list', {}).then(() => undefined, (thrown) => thrown);
  assert.ok(error instanceof CloudError, 'expected a CloudError');
  assert.equal(error.code, 'not-ready');
  assert.match(error.message, /getOrigin is not a function/u);
});
