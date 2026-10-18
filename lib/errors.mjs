/**
 * Deployment-shape errors. Every failure the plugin can explain to a user
 * carries a stable `code` so the controller and the panel can branch on it
 * instead of parsing messages.
 */
export class CloudError extends Error {
  /**
   * @param {string} code - stable machine code (`unauthorized`, `unreachable`, ...).
   * @param {string} message - human-readable explanation.
   * @param {unknown} [cause] - underlying failure, when any.
   */
  constructor(code, message, cause) {
    super(message);
    this.name = 'CloudError';
    this.code = code;
    if (cause !== undefined) this.cause = cause;
  }
}

/**
 * Unwrap one official Remote `result` envelope.
 *
 * @param {{ok: true, value: unknown} | {ok: false, error: {code: string, message: string, details?: unknown}}} result
 *   the `result` branch of a `server-response` envelope.
 * @returns the business value.
 * @throws {CloudError} `remote/<code>` carrying the Host's own failure.
 */
export function unwrapRemote(result) {
  if (result === null || typeof result !== 'object') {
    throw new CloudError('protocol', 'remote response carried no result object');
  }
  if (result.ok === true) return result.value;
  const error = result.error ?? {};
  throw new CloudError(
    typeof error.code === 'string' ? `remote/${error.code}` : 'remote/unknown',
    typeof error.message === 'string' ? error.message : 'remote call failed',
  );
}
