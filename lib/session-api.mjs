import { unwrapRemote } from './errors.mjs';

/**
 * The subset of the official Session Remote surface this plugin needs.
 *
 * Every method sends the official `{args: {<wireName>: value}}` payload the
 * browser client would send, so the peer validates it exactly as it validates
 * its own UI.
 *
 * @param {ReturnType<import('./peer.mjs').createPeers>} peers - peer registry.
 * @returns {{
 *   list(peerId: string, signal?: AbortSignal): Promise<Array<Record<string, unknown>>>,
 *   projections(peerId: string, sessionId: string, signal?: AbortSignal): Promise<Record<string, unknown> | null>,
 *   page(peerId: string, request: {sessionId: string, throughSeq: number, beforeSeq?: number, maxMessages: number}, signal?: AbortSignal): Promise<{records: Array<Record<string, unknown>>, hasMore: boolean}>,
 *   prompt(peerId: string, request: {sessionId: string, text: string, mode: 'queue' | 'steer', requestId: string, clientTimeZone?: string}, signal?: AbortSignal): Promise<{accepted: boolean}>,
 *   cancel(peerId: string, sessionId: string, signal?: AbortSignal): Promise<{accepted: boolean}>,
 * }} the session API.
 */
export function createSessionApi(peers) {
  /**
   * Invoke one endpoint and unwrap its Remote result.
   *
   * @param {string} peerId - peer id.
   * @param {string} method - endpoint.
   * @param {Record<string, unknown>} args - wire-named arguments.
   * @param {AbortSignal} [signal] - caller cancellation.
   * @returns {Promise<unknown>} the business value.
   */
  async function invoke(peerId, method, args, signal) {
    const response = await peers.call(peerId, method, { args }, { signal });
    return unwrapRemote(response.result);
  }

  return {
    /**
     * @param {string} peerId - peer id.
     * @param {AbortSignal} [signal] - caller cancellation.
     * @returns {Promise<Array<Record<string, unknown>>>} every visible Session summary.
     */
    async list(peerId, signal) {
      const value = await invoke(peerId, 'session/list', { _request: {} }, signal);
      return Array.isArray(value?.items) ? value.items : [];
    },

    /**
     * @param {string} peerId - peer id.
     * @param {string} sessionId - target session.
     * @param {AbortSignal} [signal] - caller cancellation.
     * @returns {Promise<Record<string, unknown> | null>} the projection baseline, if any.
     */
    async projections(peerId, sessionId, signal) {
      const value = await invoke(peerId, 'session/projections', { request: { sessionId } }, signal);
      return value !== null && typeof value === 'object' ? value : null;
    },

    /**
     * @param {string} peerId - peer id.
     * @param {{sessionId: string, throughSeq: number, beforeSeq?: number, maxMessages: number}} request - page window.
     * @param {AbortSignal} [signal] - caller cancellation.
     * @returns {Promise<{records: Array<Record<string, unknown>>, hasMore: boolean}>} the page.
     */
    async page(peerId, request, signal) {
      const value = await invoke(peerId, 'session/page', {
        request: {
          address: { kind: 'session', sessionId: request.sessionId },
          throughSeq: request.throughSeq,
          ...(request.beforeSeq === undefined ? {} : { beforeSeq: request.beforeSeq }),
          maxMessages: request.maxMessages,
        },
      }, signal);
      return {
        records: Array.isArray(value?.records) ? value.records : [],
        hasMore: value?.hasMore === true,
      };
    },

    /**
     * @param {string} peerId - peer id.
     * @param {{sessionId: string, text: string, mode: 'queue' | 'steer', requestId: string, clientTimeZone?: string}} request - prompt content.
     * @param {AbortSignal} [signal] - caller cancellation.
     * @returns {Promise<{accepted: boolean}>} the Host acknowledgement.
     */
    async prompt(peerId, request, signal) {
      const value = await invoke(peerId, 'session/prompt', {
        request: {
          requestId: request.requestId,
          sessionId: request.sessionId,
          mode: request.mode,
          content: [{ type: 'text', text: request.text }],
          ...(request.clientTimeZone === undefined ? {} : { clientTimeZone: request.clientTimeZone }),
        },
      }, signal);
      return { accepted: value?.accepted === true };
    },

    /**
     * @param {string} peerId - peer id.
     * @param {string} sessionId - session whose active turn is cancelled.
     * @param {AbortSignal} [signal] - caller cancellation.
     * @returns {Promise<{accepted: boolean}>} the Host acknowledgement.
     */
    async cancel(peerId, sessionId, signal) {
      const value = await invoke(peerId, 'session/cancel', { request: { sessionId } }, signal);
      return { accepted: value?.accepted === true };
    },
  };
}
