const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const pendingIds = new Map<string, string>();

function webCrypto(): Crypto | undefined {
  return globalThis.crypto;
}

function uuidFromBytes(bytes: Uint8Array): string {
  const next = new Uint8Array(bytes);
  next[6] = (next[6] & 0x0f) | 0x40;
  next[8] = (next[8] & 0x3f) | 0x80;
  const hex = Array.from(next, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function createClientRequestId(): string {
  const cryptoApi = webCrypto();
  if (typeof cryptoApi?.randomUUID === 'function') {
    const native = cryptoApi.randomUUID();
    if (UUID_V4.test(native)) return native;
  }
  if (typeof cryptoApi?.getRandomValues !== 'function') {
    throw new Error('No hay una fuente segura para generar el identificador de la solicitud.');
  }
  const bytes = new Uint8Array(16);
  cryptoApi.getRandomValues(bytes);
  const generated = uuidFromBytes(bytes);
  if (!UUID_V4.test(generated)) {
    throw new Error('No se pudo generar un identificador seguro para la solicitud.');
  }
  return generated;
}

export function takeoverRequestKey(conversationId: string, expectedVersion?: number | null): string {
  return `takeover:${conversationId}:${expectedVersion ?? ''}`;
}

export function clientRequestIdFor(operationKey: string): string {
  const current = pendingIds.get(operationKey);
  if (current) return current;
  const created = createClientRequestId();
  pendingIds.set(operationKey, created);
  return created;
}

export function completeClientRequest(operationKey: string): void {
  pendingIds.delete(operationKey);
}

export function resetClientRequestIdsForTests(): void {
  pendingIds.clear();
}
