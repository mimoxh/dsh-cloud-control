import { randomUUID } from 'node:crypto';
import { CloudError } from './errors.mjs';
import { failureResponse, jsonResponse } from './http.mjs';
import { toRows } from './transcript.mjs';

/** How long one peer's session listing is reused by both controller routes. */
const DIRECTORY_TTL_MS = 4000;

/** Maximum accepted prompt size, in characters. */
const MAX_PROMPT_CHARS = 32000;

/**
 * Mount the controller half: the same-origin `/api/cloud-control/*` routes the
 * browser panel calls.
 *
 * These are exact Connection Fetch routes, so DSH authenticates the caller and
 * refuses every non-owner Peer with 403 before the handler runs. The panel calls
 * them with plain relative `fetch()` in both Web and Desktop, because the
 * Desktop shell forwards non-asset paths to the same Host with its cookie.
 *
 * @param {{connection: {fetch: {register(route: object): () => void}}}} ctx - Host context.
 * @param {ReturnType<import('./config.mjs').normalizeConfig>} config - normalized configuration.
 * @param {{
 *   peers: ReturnType<import('./peer.mjs').createPeers>,
 *   sessionApi: ReturnType<import('./session-api.mjs').createSessionApi>,
 * }} deps - peer registry and session API.
 * @returns {Array<() => void>} the per-route disposers.
 */
export function registerControllerRoutes(ctx, config, deps) {
  const { peers, sessionApi } = deps;
  const directory = createDirectory(sessionApi);
  const disposers = [];
  const mount = (route) => {
    disposers.push(ctx.effect(
      () => ctx.connection.fetch.register(route),
      `cloud-control: ${route.path}`,
    ));
  };

  mount({
    path: '/api/cloud-control/state',
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: guard(async () => ({
      ok: true,
      role: config.role,
      displayName: config.displayName,
      pollIntervalMs: config.pollIntervalMs,
      maxMessages: config.maxMessages,
      relay: { hub: config.relay.enabled, spoke: config.relay.hubUrl !== undefined },
    })),
  });

  mount({
    path: '/api/cloud-control/peers',
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: guard(async (request) => {
      const configured = peers.list();
      const items = await Promise.all(configured.map(async (peer) => ({
        ...peer,
        status: await peers.health(peer.id, { signal: request.signal }),
      })));
      return { ok: true, peers: items };
    }),
  });

  mount({
    path: '/api/cloud-control/sessions',
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: guard(async (request) => {
      const query = new URL(request.url).searchParams;
      const peerId = requiredPeer(query);
      const items = await directory.items(peerId, request.signal);
      return { ok: true, peer: peerId, items };
    }),
  });

  mount({
    path: '/api/cloud-control/history',
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: guard(async (request) => {
      const query = new URL(request.url).searchParams;
      const peerId = requiredPeer(query);
      const sessionId = query.get('sessionId');
      if (typeof sessionId !== 'string' || sessionId.length === 0) {
        throw new CloudError('bad-request', 'sessionId is required');
      }
      const maxMessages = clampInteger(query.get('maxMessages'), 1, 200, config.maxMessages);
      const beforeSeq = optionalInteger(query.get('beforeSeq'), 0);
      let throughSeq = optionalInteger(query.get('throughSeq'), -1);
      let projection;
      if (throughSeq === undefined) {
        projection = await sessionApi.projections(peerId, sessionId, request.signal);
        throughSeq = Number.isInteger(projection?.asOfSeq) ? projection.asOfSeq : undefined;
      }
      const known = directory.find(peerId, sessionId);
      if (throughSeq === undefined) throughSeq = known?.asOfSeq;
      if (throughSeq === undefined) {
        if (known?.blank === true) {
          return { ok: true, peer: peerId, sessionId, title: known?.title ?? null, running: known?.running === true, throughSeq: -1, hasMore: false, rows: [] };
        }
        throw new CloudError('no-cursor', 'this session has no readable history cursor yet');
      }
      const page = await sessionApi.page(peerId, { sessionId, throughSeq, beforeSeq, maxMessages }, request.signal);
      return {
        ok: true,
        peer: peerId,
        sessionId,
        title: known?.title ?? titleOf(projection) ?? null,
        running: known?.running === true,
        throughSeq,
        hasMore: page.hasMore,
        rows: toRows(page.records),
      };
    }),
  });

  mount({
    path: '/api/cloud-control/prompt',
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: guard(async (request) => {
      const query = new URL(request.url).searchParams;
      const peerId = requiredPeer(query);
      const body = await readJsonBody(request);
      const sessionId = typeof body.sessionId === 'string' && body.sessionId.length > 0 ? body.sessionId : undefined;
      const text = typeof body.text === 'string' ? body.text : '';
      const mode = body.mode === 'steer' ? 'steer' : 'queue';
      const requestId = typeof body.requestId === 'string' && body.requestId.length > 0 && body.requestId.length <= 128
        ? body.requestId
        : randomUUID();
      if (sessionId === undefined) throw new CloudError('bad-request', 'sessionId is required');
      if (text.trim().length === 0) throw new CloudError('bad-request', 'text is required');
      if (text.length > MAX_PROMPT_CHARS) throw new CloudError('bad-request', `text exceeds ${MAX_PROMPT_CHARS} characters`);
      const accepted = await sessionApi.prompt(peerId, {
        sessionId,
        text,
        mode,
        requestId,
        clientTimeZone: timeZone(),
      }, request.signal);
      directory.invalidate(peerId);
      return { ok: true, peer: peerId, sessionId, requestId, accepted: accepted.accepted };
    }),
  });

  mount({
    path: '/api/cloud-control/cancel',
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: guard(async (request) => {
      const query = new URL(request.url).searchParams;
      const peerId = requiredPeer(query);
      const body = await readJsonBody(request);
      const sessionId = typeof body.sessionId === 'string' && body.sessionId.length > 0 ? body.sessionId : undefined;
      if (sessionId === undefined) throw new CloudError('bad-request', 'sessionId is required');
      const accepted = await sessionApi.cancel(peerId, sessionId, request.signal);
      return { ok: true, peer: peerId, sessionId, accepted: accepted.accepted };
    }),
  });

  return disposers;
}

/**
 * Wrap one controller handler with the shared failure convention: every answer
 * is HTTP 200 with either `{ok: true, …}` or `{ok: false, error}`.
 *
 * @param {(request: Request) => Promise<Record<string, unknown>>} handler - business handler.
 * @returns {(request: Request) => Promise<Response>} the route handler.
 */
function guard(handler) {
  return async (request) => {
    try {
      return jsonResponse(await handler(request));
    } catch (error) {
      const code = error instanceof CloudError ? error.code : 'internal';
      const message = error instanceof Error ? error.message : String(error);
      return failureResponse(code, message);
    }
  };
}

/**
 * Read one Connection Fetch route's JSON body.
 *
 * @param {Request} request - incoming request.
 * @returns {Promise<Record<string, unknown>>} the parsed object.
 * @throws {CloudError} `body-invalid` when the body is not a JSON object.
 */
async function readJsonBody(request) {
  let body;
  try {
    body = await request.json();
  } catch (error) {
    throw new CloudError('body-invalid', 'request body is not valid JSON', error);
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new CloudError('body-invalid', 'request body must be a JSON object');
  }
  return body;
}

/**
 * @param {URLSearchParams} query - request query.
 * @returns {string} the peer id.
 * @throws {CloudError} `bad-request` when it is absent.
 */
function requiredPeer(query) {
  const peer = query.get('peer');
  if (typeof peer !== 'string' || peer.length === 0) throw new CloudError('bad-request', 'peer is required');
  return peer;
}

/**
 * @param {string | null} value - query value.
 * @param {number} fallback - default when absent.
 * @returns {number} the clamped integer.
 */
function clampInteger(value, min, max, fallback) {
  const parsed = value === null ? Number.NaN : Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

/**
 * @param {string | null} value - query value.
 * @param {number} min - lower bound.
 * @returns {number | undefined} the integer, or undefined when absent/invalid.
 */
function optionalInteger(value, min) {
  if (value === null || value === '') return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min) return undefined;
  return parsed;
}

/**
 * @param {unknown} projection - `session/projections` value.
 * @returns {string | undefined} the projected title.
 */
function titleOf(projection) {
  const title = projection?.values?.title;
  return typeof title === 'string' && title.length > 0 ? title : undefined;
}

/**
 * @returns {string | undefined} this process's IANA time zone, for prompt attribution.
 */
function timeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Per-peer session listing cache, so one panel refresh costs one remote call
 * for the list and one for the transcript page.
 *
 * @param {ReturnType<import('./session-api.mjs').createSessionApi>} sessionApi - session API.
 * @returns {{
 *   items(peerId: string, signal?: AbortSignal): Promise<Array<Record<string, unknown>>>,
 *   find(peerId: string, sessionId: string): Record<string, unknown> | undefined,
 *   invalidate(peerId: string): void,
 * }} the directory.
 */
function createDirectory(sessionApi) {
  /** @type {Map<string, {at: number, items: Array<Record<string, unknown>>}>} */
  const cache = new Map();

  /**
   * @param {string} peerId - peer id.
   * @param {AbortSignal} [signal] - caller cancellation.
   * @returns {Promise<Array<Record<string, unknown>>>} the visible, non-subagent sessions.
   */
  async function items(peerId, signal) {
    const cached = cache.get(peerId);
    if (cached !== undefined && Date.now() - cached.at < DIRECTORY_TTL_MS) return cached.items;
    const raw = await sessionApi.list(peerId, signal);
    const items = raw
      .filter((item) => item !== null && typeof item === 'object' && typeof item.sessionId === 'string')
      .filter((item) => item.parentSessionId === undefined && item.origin !== 'subagent')
      .map((item) => ({
        sessionId: item.sessionId,
        title: typeof item.projections?.values?.title === 'string' ? item.projections.values.title : null,
        running: item.running === true,
        blank: item.blank === true,
        agentAvailable: item.agentAvailable === true,
        updatedAt: Number.isFinite(item.updatedAt) ? item.updatedAt : 0,
        cwd: typeof item.cwd === 'string' ? item.cwd : null,
        asOfSeq: Number.isInteger(item.projections?.asOfSeq) ? item.projections.asOfSeq : undefined,
      }))
      .sort((left, right) => right.updatedAt - left.updatedAt);
    cache.set(peerId, { at: Date.now(), items });
    return items;
  }

  return {
    items,
    find: (peerId, sessionId) => cache.get(peerId)?.items.find((item) => item.sessionId === sessionId),
    invalidate: (peerId) => {
      cache.delete(peerId);
    },
  };
}
