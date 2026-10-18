import { resolveSecret } from './auth.mjs';

/** Roles this bundle can play on one Host. */
export const ROLES = ['controller', 'endpoint', 'both'];

/** Official Remote methods the endpoint may forward by default. */
export const DEFAULT_ALLOW_METHODS = [
  'session/list',
  'session/projections',
  'session/page',
  'session/prompt',
  'session/cancel',
  'session/updateQueue',
];

/** Default URL prefix owned by the endpoint on the remote Host. */
export const ENDPOINT_PREFIX = '/cloud-control/v1';

/**
 * Validate one deployment's configuration and supply every default.
 *
 * The configuration is validated by hand: this plugin imports nothing outside
 * Node built-ins, so it keeps working across Harness releases that move or
 * reshape their Schemastery re-exports. Invalid configuration fails plugin
 * load loudly, as the Harness convention requires.
 *
 * Relay semantics split in two so one shape serves both ends:
 * - `relay.enabled` mounts the hub routes (`/relay/poll`, `/relay/result`),
 * - `relay.hubUrl` makes this Host dial a hub (the spoke side).
 *
 * @param {unknown} raw - the Loader row's `config`.
 * @returns a frozen, complete configuration.
 * @throws {Error} when a value cannot be used.
 */
export function normalizeConfig(raw) {
  const config = isRecord(raw) ? raw : {};
  const role = config.role === undefined ? 'controller' : config.role;
  if (!ROLES.includes(role)) throw new Error(`cloud-control: role must be one of ${ROLES.join(', ')}`);

  const endpoint = isRecord(config.endpoint) ? config.endpoint : {};
  const endpointEnabled = endpoint.enabled === true || role === 'endpoint' || role === 'both';
  const endpointToken = resolveSecret(endpoint.token, endpoint.tokenEnv);
  if (endpointEnabled && endpointToken === undefined) {
    throw new Error('cloud-control: endpoint.token or endpoint.tokenEnv is required when the endpoint role is enabled');
  }

  const peers = Array.isArray(config.peers) ? config.peers : [];
  const normalizedPeers = peers.map((peer, index) => normalizePeer(peer, index));

  const relay = isRecord(config.relay) ? config.relay : {};
  const relayEnabled = relay.enabled === true;
  const relayToken = resolveSecret(relay.token, relay.tokenEnv) ?? endpointToken;
  let hubUrl;
  if (relay.hubUrl !== undefined) {
    if (typeof relay.hubUrl !== 'string' || relay.hubUrl.trim().length === 0) {
      throw new Error('cloud-control: relay.hubUrl must be a non-empty string');
    }
    hubUrl = relay.hubUrl.trim().replace(/\/+$/u, '');
    let parsed;
    try {
      parsed = new URL(hubUrl);
    } catch (error) {
      throw new Error(`cloud-control: relay.hubUrl is not a URL: ${String(relay.hubUrl)}`, { cause: error });
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('cloud-control: relay.hubUrl must be http(s)');
    }
  }
  if (hubUrl !== undefined && relayToken === undefined) {
    throw new Error('cloud-control: relay.token, relay.tokenEnv or endpoint.token is required when relay.hubUrl is set');
  }
  if (relayEnabled && endpointEnabled === false && hubUrl === undefined) {
    throw new Error('cloud-control: relay.enabled requires an enabled endpoint (hub role) or a relay.hubUrl (spoke role)');
  }

  return Object.freeze({
    role,
    displayName: typeof config.displayName === 'string' && config.displayName.trim().length > 0
      ? config.displayName.trim()
      : 'dsh-cloud-control',
    pollIntervalMs: positiveInteger(config.pollIntervalMs, 2000),
    maxMessages: limit(positiveInteger(config.maxMessages, 60), 1, 500),
    requestTimeoutMs: positiveInteger(config.requestTimeoutMs, 30000),
    endpoint: Object.freeze({
      enabled: endpointEnabled,
      token: endpointToken ?? '',
      allowFrom: stringArray(endpoint.allowFrom),
      allowMethods: endpoint.allowMethods === undefined ? DEFAULT_ALLOW_METHODS : stringArray(endpoint.allowMethods),
      maxBodyBytes: positiveInteger(endpoint.maxBodyBytes, 1024 * 1024),
    }),
    peers: Object.freeze(normalizedPeers),
    relay: Object.freeze({
      enabled: relayEnabled,
      hubUrl,
      token: relayToken ?? '',
      waitMs: limit(positiveInteger(relay.waitMs, 25000), 1000, 30000),
      maxQueue: limit(positiveInteger(relay.maxQueue, 32), 1, 256),
      requestTtlMs: positiveInteger(relay.requestTtlMs, 30000),
      errorBackoffMs: positiveInteger(relay.errorBackoffMs, 2000),
    }),
  });
}

/**
 * Normalize one configured peer.
 *
 * @param {unknown} raw - peer entry.
 * @param {number} index - position, for diagnostics.
 * @returns a frozen peer configuration.
 * @throws {Error} when the entry is unusable.
 */
function normalizePeer(raw, index) {
  if (!isRecord(raw)) throw new Error(`cloud-control: peers[${index}] must be an object`);
  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  if (!/^[A-Za-z0-9._-]{1,64}$/u.test(id)) throw new Error(`cloud-control: peers[${index}].id must match [A-Za-z0-9._-]{1,64}`);
  const kind = raw.kind === undefined ? 'direct' : raw.kind;
  if (kind !== 'direct' && kind !== 'relay') throw new Error(`cloud-control: peers[${index}].kind must be direct or relay`);
  const token = resolveSecret(raw.token, raw.tokenEnv);
  if (token === undefined) throw new Error(`cloud-control: peers[${index}].token or tokenEnv is required`);
  let baseUrl;
  if (kind === 'direct') {
    if (typeof raw.baseUrl !== 'string' || raw.baseUrl.trim().length === 0) {
      throw new Error(`cloud-control: peers[${index}].baseUrl is required for a direct peer`);
    }
    baseUrl = raw.baseUrl.trim().replace(/\/+$/u, '');
    let parsed;
    try {
      parsed = new URL(baseUrl);
    } catch (error) {
      throw new Error(`cloud-control: peers[${index}].baseUrl is not a URL: ${String(raw.baseUrl)}`, { cause: error });
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`cloud-control: peers[${index}].baseUrl must be http(s)`);
    }
  }
  return Object.freeze({
    id,
    label: typeof raw.label === 'string' && raw.label.trim().length > 0 ? raw.label.trim() : id,
    kind,
    baseUrl,
    token,
    timeoutMs: positiveInteger(raw.timeoutMs, 30000),
  });
}

/**
 * @param {unknown} value - candidate.
 * @returns {value is Record<string, unknown>} whether the value is a plain object.
 */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * @param {unknown} value - candidate.
 * @param {number} fallback - default when the value is not a positive integer.
 * @returns {number} a positive integer.
 */
function positiveInteger(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

/**
 * @param {number} value - number to clamp.
 * @param {number} min - lower bound.
 * @param {number} max - upper bound.
 * @returns the clamped number.
 */
function limit(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * @param {unknown} value - candidate list.
 * @returns {string[]} the non-empty string entries.
 */
function stringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((entry) => typeof entry === 'string' && entry.trim().length > 0).map((entry) => entry.trim());
}
