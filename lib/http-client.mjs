import http from 'node:http';
import https from 'node:https';

/** Response bodies are small JSON envelopes; this is a safety net, not a budget. */
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;

/**
 * One HTTP(S) request over Node's own transports.
 *
 * The plugin talks to peers through this helper rather than `fetch` because a
 * self-hosted DSH is commonly fronted by a reverse proxy with a private CA:
 * `allowInsecureTls` must be a per-request decision, and Node's global `fetch`
 * cannot express it without disabling TLS verification process-wide.
 *
 * @param {string | URL} target - absolute URL.
 * @param {{
 *   method?: string,
 *   headers?: Record<string, string>,
 *   body?: string,
 *   timeoutMs?: number,
 *   signal?: AbortSignal,
 *   allowInsecureTls?: boolean,
 * }} [options] - request inputs.
 * @returns {Promise<{status: number, headers: Record<string, string | string[] | undefined>, text: string}>} the response.
 * @throws {Error} transport failure, timeout, or `CloudError`-style abort.
 */
export function httpRequest(target, options = {}) {
  const url = target instanceof URL ? target : new URL(target);
  const secure = url.protocol === 'https:';
  if (!secure && url.protocol !== 'http:') throw new Error(`unsupported protocol ${url.protocol}`);
  const transport = secure ? https : http;
  const body = options.body;
  const timeoutMs = options.timeoutMs ?? 30000;
  const signal = options.signal;

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      fn(value);
    };
    const onAbort = () => {
      request.destroy(new Error('request aborted'));
      finish(reject, signal?.reason instanceof Error ? signal.reason : new Error('request aborted'));
    };
    const timer = setTimeout(() => {
      request.destroy(new Error(`request timed out after ${timeoutMs}ms`));
      finish(reject, new Error(`request timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    timer.unref?.();

    const request = transport.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port === '' ? undefined : Number(url.port),
      path: `${url.pathname}${url.search}`,
      method: options.method ?? 'GET',
      headers: {
        ...(body === undefined ? {} : { 'content-length': Buffer.byteLength(body) }),
        ...(options.headers ?? {}),
      },
      rejectUnauthorized: options.allowInsecureTls === true ? false : true,
      ...(secure && isNamedHost(url.hostname) ? { servername: url.hostname } : {}),
    }, (response) => {
      const chunks = [];
      let size = 0;
      response.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_RESPONSE_BYTES) {
          response.destroy(new Error('response body is too large'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('error', (error) => finish(reject, error));
      response.on('end', () => finish(resolve, {
        status: response.statusCode ?? 0,
        headers: response.headers,
        text: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    request.on('error', (error) => finish(reject, error));
    if (signal !== undefined) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }
    if (body !== undefined) request.write(body);
    request.end();
  });
}

/**
 * Whether one URL host is a name rather than an IP literal. TLS SNI must not
 * carry an IP address (RFC 6066), and Node warns when it is asked to.
 *
 * @param {string} hostname - `URL.hostname` (IPv6 keeps its brackets).
 * @returns {boolean} true for a DNS name.
 */
function isNamedHost(hostname) {
  if (hostname.startsWith('[')) return false;
  return !/^\d{1,3}(?:\.\d{1,3}){3}$/u.test(hostname);
}
