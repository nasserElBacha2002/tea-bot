import { afterEach, describe, expect, it } from 'vitest';
import {
  clientRequestIdFor,
  completeClientRequest,
  createClientRequestId,
  resetClientRequestIdsForTests,
} from './clientRequestId';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const originalCrypto = globalThis.crypto;

afterEach(() => {
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: originalCrypto,
  });
  resetClientRequestIdsForTests();
});

function useCrypto(value: Crypto | undefined) {
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value,
  });
}

describe('createClientRequestId', () => {
  it('usa crypto.randomUUID cuando está disponible', () => {
    useCrypto({
      randomUUID: () => '11111111-1111-4111-8111-111111111111',
      getRandomValues: () => {
        throw new Error('no debería usar getRandomValues');
      },
    } as unknown as Crypto);

    expect(createClientRequestId()).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('genera un UUID v4 con getRandomValues cuando randomUUID no existe', () => {
    useCrypto({
      getRandomValues: (bytes: Uint8Array) => {
        bytes.fill(1);
        return bytes;
      },
    } as unknown as Crypto);

    expect(createClientRequestId()).toBe('01010101-0101-4101-8101-010101010101');
  });

  it('falla de forma controlada si no hay una fuente segura', () => {
    useCrypto({} as unknown as Crypto);

    expect(() => createClientRequestId()).toThrow(
      'No hay una fuente segura para generar el identificador de la solicitud.',
    );
  });
});

describe('clientRequestIdFor', () => {
  it('genera identificadores distintos para operaciones distintas', () => {
    const first = clientRequestIdFor('takeover:conversation-a:1');
    const second = clientRequestIdFor('takeover:conversation-b:1');

    expect(first).toMatch(UUID_V4);
    expect(second).toMatch(UUID_V4);
    expect(first).not.toBe(second);
  });

  it('conserva el identificador al reintentar la misma operación', () => {
    const first = clientRequestIdFor('takeover:conversation-a:4');
    const retry = clientRequestIdFor('takeover:conversation-a:4');

    expect(retry).toBe(first);
  });

  it('emite un identificador nuevo después de completar la operación', () => {
    const key = 'takeover:conversation-a:4';
    const first = clientRequestIdFor(key);
    completeClientRequest(key);

    expect(clientRequestIdFor(key)).not.toBe(first);
  });
});
