/**
 * dsh-cloud-control — host half.
 *
 * One bundle, two roles:
 *
 * - **endpoint** (remote side): a bearer-token HTTP surface under
 *   `/cloud-control/v1` that forwards official DSH Remote unary calls to this
 *   process's own `/api`, plus the relay hub for spokes that cannot be reached
 *   directly.
 * - **controller** (local side): same-origin `/api/cloud-control/*` routes the
 *   browser panel calls, backed by peer clients and the official Session Remote
 *   API, plus an optional relay spoke that dials out to a hub.
 *
 * The plugin imports nothing outside Node built-ins: it stays loadable across
 * Harness releases that move or reshape their internal packages. All wiring is
 * effect-scoped, so disabling the row removes every route, timer and socket.
 */
import { createLocalRpc } from './lib/local-rpc.mjs';
import { createRelayHub } from './lib/relay-hub.mjs';
import { createPeers } from './lib/peer.mjs';
import { createSessionApi } from './lib/session-api.mjs';
import { registerControllerRoutes } from './lib/controller.mjs';
import { registerEndpoint } from './lib/endpoint.mjs';
import { startRelaySpoke } from './lib/relay-spoke.mjs';
import { normalizeConfig } from './lib/config.mjs';

/** Stable plugin name used by Loader diagnostics. */
export const name = 'cloud-control';

/**
 * The Host services this plugin needs. Both exist in the Web and Desktop
 * profiles (Desktop runs the same Web Host on loopback); a profile without them
 * keeps the row waiting instead of activating.
 */
export const inject = ['connection', 'webServer'];

/**
 * Mount the plugin.
 *
 * @param {{
 *   effect(dispose: () => (() => void) | void, label: string): () => void,
 *   connection: {fetch: {register(route: object): () => void}, authenticatedUrl(base: string): string},
 *   webServer: {register(route: object): () => void, getOrigin(): string},
 * }} ctx - the Cordis plugin context.
 * @param {unknown} config - this row's configuration.
 * @returns {void}
 */
export function apply(ctx, config) {
  const normalized = normalizeConfig(config);
  const localRpc = createLocalRpc(ctx, { timeoutMs: normalized.requestTimeoutMs });
  const relayHub = createRelayHub({
    maxQueue: normalized.relay.maxQueue,
    requestTtlMs: normalized.relay.requestTtlMs,
  });
  ctx.effect(() => () => relayHub.dispose(), 'cloud-control: relay hub');

  if (normalized.endpoint.enabled) {
    registerEndpoint(ctx, normalized, { localRpc, relayHub });
  }

  const peers = createPeers(normalized, { relayHub });
  const sessionApi = createSessionApi(peers);
  registerControllerRoutes(ctx, normalized, { peers, sessionApi });

  startRelaySpoke(ctx, normalized, { localRpc });
}
