import { createHash, timingSafeEqual } from 'node:crypto';

/** Header carrying this plugin's own credential, kept apart from `Authorization`. */
export const TOKEN_HEADER = 'x-cloud-control-token';

/**
 * Read this plugin's credential from a Node or Web request.
 *
 * The dedicated header is preferred because a reverse proxy in front of the
 * peer (1Panel's Caddy, for example) needs `Authorization` for its own Basic
 * authentication; the bearer form stays supported for direct HTTP peers.
 *
 * @param {{headers: Record<string, unknown> | Headers}} request - either surface.
 * @returns the token text, or `undefined` when neither form is present.
 */
export function tokenOf(request) {
  const headers = request?.headers;
  const read = (name) => (headers instanceof Headers || typeof headers?.get === 'function'
    ? headers.get(name)
    : headers?.[name]);
  const dedicated = read(TOKEN_HEADER);
  const value = Array.isArray(dedicated) ? dedicated[0] : dedicated;
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  return bearerOf(request);
}

/**
 * Build the outgoing credentials for one peer call.
 *
 * @param {string} token - this plugin's shared token.
 * @param {{user: string, password: string} | undefined} basicAuth - reverse-proxy credentials, when any.
 * @returns {Record<string, string>} headers to merge into the request.
 */
export function authHeaders(token, basicAuth) {
  const headers = { [TOKEN_HEADER]: token };
  if (basicAuth !== undefined) {
    headers.authorization = `Basic ${Buffer.from(`${basicAuth.user}:${basicAuth.password}`, 'utf8').toString('base64')}`;
  }
  return headers;
}

/**
 * Read the bearer credential from a Node or Web request.
 *
 * @param {{headers: {authorization?: string | string[]} | Headers}} request - either surface.
 * @returns the token text, or `undefined` when no bearer header is present.
 */
export function bearerOf(request) {
  const headers = request?.headers;
  const raw = headers instanceof Headers || typeof headers?.get === 'function'
    ? headers.get('authorization')
    : headers?.authorization;
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string') return undefined;
  const match = /^Bearer\s+(\S+)\s*$/iu.exec(value);
  return match === null ? undefined : match[1];
}

/**
 * Compare two credentials without leaking their contents through timing.
 * Hashing first keeps the comparison length-independent, so a shorter probe
 * cannot be distinguished from a longer wrong one.
 *
 * @param {string | undefined} presented - credential supplied by the caller.
 * @param {string | undefined} expected - configured credential.
 * @returns whether the two are equal and non-empty.
 */
export function tokenMatches(presented, expected) {
  if (typeof presented !== 'string' || typeof expected !== 'string' || expected.length === 0) return false;
  const digests = [presented, expected].map((value) => createHash('sha256').update(value, 'utf8').digest());
  return timingSafeEqual(digests[0], digests[1]);
}

/**
 * Resolve one secret from an explicit value or the environment.
 *
 * @param {string | undefined} value - inline value, when configured directly.
 * @param {string | undefined} envName - environment variable name.
 * @param {NodeJS.ProcessEnv} [env] - environment to read.
 * @returns the secret text, or `undefined` when neither source supplies one.
 */
export function resolveSecret(value, envName, env = process.env) {
  if (typeof value === 'string' && value.length > 0) return value;
  if (typeof envName === 'string' && envName.length > 0) {
    const fromEnv = env[envName];
    if (typeof fromEnv === 'string' && fromEnv.length > 0) return fromEnv;
  }
  return undefined;
}

/**
 * Match one socket address against a configured allowlist.
 *
 * Entries are exact addresses (`10.0.0.5`), IPv4 CIDR blocks (`10.0.0.0/8`),
 * or the whole-loopback shorthand `loopback`. An empty allowlist accepts every
 * source; DSH's own route layer never reaches this check, so the list is a
 * second gate behind the shared token.
 *
 * @param {string | undefined} remoteAddress - `req.socket.remoteAddress` text.
 * @param {readonly string[]} allowFrom - configured entries.
 * @returns whether the source may call the endpoint.
 */
export function sourceAllowed(remoteAddress, allowFrom) {
  if (!Array.isArray(allowFrom) || allowFrom.length === 0) return true;
  const address = normalizeAddress(remoteAddress);
  if (address === undefined) return false;
  for (const entry of allowFrom) {
    if (typeof entry !== 'string') continue;
    const trimmed = entry.trim();
    if (trimmed.length === 0) continue;
    if (trimmed === 'loopback') {
      if (address === '127.0.0.1' || address.startsWith('127.')) return true;
      continue;
    }
    if (!trimmed.includes('/')) {
      if (address === normalizeAddress(trimmed)) return true;
      continue;
    }
    const match = /^([^/]+)\/(\d{1,2})$/u.exec(trimmed);
    if (match === null) continue;
    const network = toIPv4(match[1]);
    const bits = Number(match[2]);
    const candidate = toIPv4(address);
    if (network === undefined || candidate === undefined || !Number.isInteger(bits) || bits < 0 || bits > 32) continue;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    if ((network & mask) === (candidate & mask)) return true;
  }
  return false;
}

/**
 * Normalize an address literal, dropping an IPv4-mapped IPv6 prefix.
 *
 * @param {string | undefined} address - raw socket or configured address.
 * @returns the normalized text, or `undefined` for an absent value.
 */
function normalizeAddress(address) {
  if (typeof address !== 'string') return undefined;
  const trimmed = address.trim();
  if (trimmed.length === 0) return undefined;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/iu.exec(trimmed);
  return mapped === null ? trimmed : mapped[1];
}

/**
 * Parse one dotted-quad IPv4 address into an unsigned integer.
 *
 * @param {string} address - candidate address.
 * @returns the integer value, or `undefined` when the text is not IPv4.
 */
function toIPv4(address) {
  const parts = normalizeAddress(address)?.split('.');
  if (parts === undefined || parts.length !== 4) return undefined;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/u.test(part)) return undefined;
    const octet = Number(part);
    if (octet > 255) return undefined;
    value = (value << 8) | octet;
  }
  return value >>> 0;
}
