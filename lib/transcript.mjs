/** Per-row text budget; the panel is a reading surface, not an export. */
const MAX_TEXT_CHARS = 32000;

/** Per-row tool preview budget. */
const MAX_PREVIEW_CHARS = 1200;

/**
 * Project one `session/page` response into stable, renderable rows.
 *
 * Only the surface events a conversation actually shows are mapped: user and
 * assistant messages, tool calls and tool results. Log-only events (request
 * headers, route metadata, attempts, titles) are dropped; the panel shows the
 * current conversation, not the raw log.
 *
 * The mapping is intentionally lossy: images and file references become
 * placeholders because v1 carries text only.
 *
 * @param {Array<Record<string, unknown>>} records - `SessionEventEntry` values.
 * @returns {Array<{seq: number, time: number, role: 'user' | 'assistant' | 'tool', kind: string, text: string, reasoning?: string, name?: string, error?: boolean, interrupted?: boolean, source?: string}>}
 *   chronological rows.
 */
export function toRows(records) {
  const rows = [];
  if (!Array.isArray(records)) return rows;
  for (const record of records) {
    if (record === null || typeof record !== 'object') continue;
    const event = record.type === 'event' ? record.event : undefined;
    if (event === null || typeof event !== 'object') continue;
    const seq = Number.isInteger(event.seq) ? event.seq : rows.length;
    const time = typeof event.time === 'number' ? event.time : 0;
    const data = event.data !== null && typeof event.data === 'object' && !Array.isArray(event.data) ? event.data : {};
    switch (event.type) {
      case 'user/message': {
        const message = pickMessage(data);
        rows.push({
          seq,
          time,
          role: 'user',
          kind: 'message',
          text: textOf(message.content),
          ...(typeof data.source?.kind === 'string' ? { source: data.source.kind } : {}),
        });
        break;
      }
      case 'assistant/message': {
        const message = pickMessage(data);
        const reasoning = reasoningOf(message.content);
        rows.push({
          seq,
          time,
          role: 'assistant',
          kind: 'message',
          text: textOf(message.content),
          ...(reasoning.length > 0 ? { reasoning } : {}),
          ...(data.interrupted === true ? { interrupted: true } : {}),
        });
        break;
      }
      case 'tool/call': {
        rows.push({
          seq,
          time,
          role: 'tool',
          kind: 'call',
          name: typeof data.name === 'string' ? data.name : 'tool',
          text: preview(typeof data.arguments === 'string' ? data.arguments : stringify(data.arguments)),
        });
        break;
      }
      case 'tool/result': {
        const message = pickMessage(data.message);
        const error = data.error !== undefined && data.error !== null;
        rows.push({
          seq,
          time,
          role: 'tool',
          kind: 'result',
          name: typeof data.name === 'string' ? data.name : 'tool',
          text: error ? preview(errorText(data.error)) : textOf(message.content),
          ...(error ? { error: true } : {}),
        });
        break;
      }
      default:
        break;
    }
  }
  return rows.sort((left, right) => left.seq - right.seq);
}

/**
 * Pick the message body out of one event's data.
 *
 * @param {Record<string, unknown>} data - event data.
 * @returns {{content?: unknown}} the message, or an empty object.
 */
function pickMessage(data) {
  if (data === null || typeof data !== 'object') return {};
  if (data.message !== null && typeof data.message === 'object') return data.message;
  return data;
}

/**
 * Join the text blocks of one message body.
 *
 * @param {unknown} content - content-block array.
 * @returns {string} the visible text.
 */
function textOf(content) {
  if (typeof content === 'string') return truncate(content);
  if (!Array.isArray(content)) return '';
  const parts = [];
  for (const block of content) {
    if (block === null || typeof block !== 'object') continue;
    if (block.type === 'text' && typeof block.text === 'string') parts.push(block.text);
    else if (block.type === 'reasoning') continue;
    else if (block.type === 'image') parts.push('[image]');
    else if (block.type === 'file') parts.push('[file]');
  }
  return truncate(parts.join('\n').trim());
}

/**
 * Join the reasoning blocks of one message body.
 *
 * @param {unknown} content - content-block array.
 * @returns {string} the reasoning text, empty when none.
 */
function reasoningOf(content) {
  if (!Array.isArray(content)) return '';
  const parts = [];
  for (const block of content) {
    if (block !== null && typeof block === 'object' && block.type === 'reasoning' && typeof block.text === 'string') {
      parts.push(block.text);
    }
  }
  return truncate(parts.join('\n').trim());
}

/**
 * Render an error value as one line.
 *
 * @param {unknown} error - tool error payload.
 * @returns {string} the text.
 */
function errorText(error) {
  if (typeof error === 'string') return error;
  if (error !== null && typeof error === 'object') {
    if (typeof error.message === 'string') return error.message;
    return stringify(error);
  }
  return String(error);
}

/**
 * JSON-stringify a value without throwing.
 *
 * @param {unknown} value - value to render.
 * @returns {string} its text form.
 */
function stringify(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * @param {string} text - text to shorten.
 * @returns {string} the shortened text.
 */
function preview(text) {
  const compact = text.replace(/\s+/gu, ' ').trim();
  return compact.length > MAX_PREVIEW_CHARS ? `${compact.slice(0, MAX_PREVIEW_CHARS)}…` : compact;
}

/**
 * @param {string} text - text to shorten.
 * @returns {string} the shortened text.
 */
function truncate(text) {
  return text.length > MAX_TEXT_CHARS ? `${text.slice(0, MAX_TEXT_CHARS)}…` : text;
}
