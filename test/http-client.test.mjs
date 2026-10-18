import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { httpRequest } from '../lib/http-client.mjs';

/** Start one throwaway HTTP server and return its origin plus a stop handle. */
async function withServer(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    origin: `http://127.0.0.1:${port}`,
    async stop() {
      await new Promise((resolve) => server.close(resolve));
    }
  };
}

test('performs a GET and returns status, headers and text', async () => {
  const server = await withServer((request, response) => {
    assert.equal(request.method, 'GET');
    assert.equal(request.headers['x-cloud-control-token'], 'shared');
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ ok: true }));
  });
  try {
    const response = await httpRequest(`${server.origin}/health`, { headers: { 'x-cloud-control-token': 'shared' } });
    assert.equal(response.status, 200);
    assert.equal(response.headers['content-type'], 'application/json');
    assert.deepEqual(JSON.parse(response.text), { ok: true });
  } finally {
    await server.stop();
  }
});

test('sends a POST body with a content length', async () => {
  const server = await withServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => {
      assert.equal(request.headers['content-length'], String(Buffer.byteLength(body)));
      response.writeHead(200);
      response.end(body.toUpperCase());
    });
  });
  try {
    const response = await httpRequest(`${server.origin}/rpc`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"a":1}'
    });
    assert.equal(response.text, '{"A":1}');
  } finally {
    await server.stop();
  }
});

test('reports non-2xx statuses without throwing', async () => {
  const server = await withServer((_request, response) => {
    response.writeHead(401);
    response.end('unauthorized');
  });
  try {
    const response = await httpRequest(`${server.origin}/health`);
    assert.equal(response.status, 401);
    assert.equal(response.text, 'unauthorized');
  } finally {
    await server.stop();
  }
});

test('times out a silent peer', async () => {
  const server = await withServer(() => { /* never answers */ });
  try {
    await assert.rejects(
      () => httpRequest(`${server.origin}/health`, { timeoutMs: 60 }),
      /timed out/u
    );
  } finally {
    await server.stop();
  }
});

test('honours an abort signal', async () => {
  const server = await withServer(() => { /* never answers */ });
  try {
    const abort = new AbortController();
    const pending = httpRequest(`${server.origin}/health`, { signal: abort.signal, timeoutMs: 5000 });
    abort.abort(new Error('caller went away'));
    await assert.rejects(() => pending, /caller went away|aborted/u);
  } finally {
    await server.stop();
  }
});
