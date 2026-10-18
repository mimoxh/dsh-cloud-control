import { CloudError } from './errors.mjs';

/**
 * Build a JSON `Response` for a Connection Fetch route (browser half).
 *
 * @param {unknown} value - JSON-serializable body.
 * @param {number} [status] - HTTP status.
 * @returns {Response} the response.
 */
export function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

/**
 * Build a JSON failure response for a Connection Fetch route.
 *
 * @param {string} code - stable failure code.
 * @param {string} message - human-readable explanation.
 * @param {number} [status] - HTTP status.
 * @returns {Response} the response.
 */
export function failureResponse(code, message, status = 200) {
  return jsonResponse({ ok: false, error: { code, message } }, status);
}

/**
 * Write one JSON body on a Node `ServerResponse`.
 *
 * @param {import('node:http').ServerResponse} response - response owned by the caller.
 * @param {number} status - HTTP status.
 * @param {unknown} value - JSON-serializable body.
 * @returns {void}
 */
export function writeJson(response, status, value) {
  const body = Buffer.from(JSON.stringify(value), 'utf8');
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(body.byteLength),
    'cache-control': 'no-store',
  });
  response.end(body);
}

/**
 * Read one Web `Request` body as JSON with a byte budget.
 *
 * @param {Request} request - request to read.
 * @param {number} limit - maximum accepted bytes.
 * @returns {Promise<unknown>} parsed body.
 * @throws {CloudError} `body-too-large` or `body-invalid`.
 */
export async function readRequestJson(request, limit) {
  const text = await request.text();
  return parseJsonBody(text, limit);
}

/**
 * Read one Node `IncomingMessage` body as JSON with a byte budget.
 *
 * @param {import('node:http').IncomingMessage} request - request to read.
 * @param {number} limit - maximum accepted bytes.
 * @returns {Promise<unknown>} parsed body.
 * @throws {CloudError} `body-too-large` or `body-invalid`.
 */
export async function readNodeJson(request, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new CloudError('body-too-large', `request body exceeds ${limit} bytes`);
    chunks.push(chunk);
  }
  return parseJsonBody(Buffer.concat(chunks).toString('utf8'), limit);
}

/**
 * Parse JSON text while enforcing the same budget.
 *
 * @param {string} text - body text.
 * @param {number} limit - maximum accepted bytes.
 * @returns {unknown} parsed value.
 * @throws {CloudError} `body-too-large` or `body-invalid`.
 */
function parseJsonBody(text, limit) {
  if (Buffer.byteLength(text, 'utf8') > limit) throw new CloudError('body-too-large', `request body exceeds ${limit} bytes`);
  if (text.trim().length === 0) return undefined;
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new CloudError('body-invalid', 'request body is not valid JSON', error);
  }
}

/**
 * Build a URL from a request that may carry only a path.
 *
 * @param {string} target - `req.url` or `request.url`.
 * @param {string} [base] - synthetic origin for path-only targets.
 * @returns {URL} the parsed URL.
 */
export function requestUrl(target, base = 'http://cloud-control.invalid') {
  return new URL(target ?? '/', base);
}
