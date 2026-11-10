import { AsyncLocalStorage } from 'node:async_hooks';
import { query as defaultQuery, withTransaction } from '../db/index.js';

const storage = new AsyncLocalStorage();

export class InboundLeaseLostError extends Error {
  constructor() {
    super('inbound lease lost');
    this.name = 'InboundLeaseLostError';
    this.code = 'INBOUND_LEASE_LOST';
  }
}

export function currentInboundLease() {
  return storage.getStore() || null;
}

/**
 * El attempts adquirido es el fence token. Las escrituras del turno lo ven
 * por el contexto async. No se mantiene una transacción abierta fuera de cada efecto.
 */
export function withInboundLease(lease, fn) {
  if (!lease?.id || lease.attempts == null || Number.isNaN(Number(lease.attempts))) return fn();
  return storage.run(
    { id: String(lease.id), attempts: Number(lease.attempts) },
    fn,
  );
}

export async function fenceInboundLease(transaction, dbQuery = defaultQuery) {
  const lease = currentInboundLease();
  if (!lease) return { owned: true, skipped: true };
  const { rows } = await dbQuery(
    `UPDATE dbo.provider_webhook_events
     SET updated_at = SYSUTCDATETIME()
     OUTPUT INSERTED.id
     WHERE id = $1
       AND status = N'PROCESSING'
       AND attempts = $2`,
    [lease.id, lease.attempts],
    { transaction },
  );
  if (!rows[0]) throw new InboundLeaseLostError();
  return { owned: true, skipped: false };
}

/**
 * Chequeo y escritura en la misma transacción. Sin lease no abre una transacción nueva.
 * Con lease y sin transacción del caller, abre una corta y la cierra antes de volver.
 */
export async function withFencedWrite(transaction, fn) {
  if (!currentInboundLease()) return fn(transaction ?? null);
  if (transaction) {
    await fenceInboundLease(transaction);
    return fn(transaction);
  }
  return withTransaction(async (tx) => {
    await fenceInboundLease(tx);
    return fn(tx);
  });
}
