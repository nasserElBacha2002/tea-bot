/** Cola por userId: serializa inbound de la misma conversación en este proceso. */
const tails = new Map();

/**
 * No es un lock distribuido. Varias instancias pueden procesar el mismo userId
 * en paralelo; la idempotencia de Conversation (unique channel+external_user)
 * y currentNodeKey cubren el persistido. Este lock evita dos first-contact
 * en el mismo proceso (webhooks A/B casi simultáneos).
 *
 * @template T
 * @param {string} userId
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
export function withInboundUserLock(userId, fn) {
  const key = String(userId || '');
  const previous = tails.get(key) || Promise.resolve();
  const run = previous.catch(() => undefined).then(fn);
  const tracked = run.finally(() => {
    if (tails.get(key) === tracked) tails.delete(key);
  });
  tails.set(key, tracked);
  return run;
}
