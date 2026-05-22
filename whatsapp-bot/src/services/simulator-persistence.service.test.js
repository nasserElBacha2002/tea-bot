import test from 'node:test';
import assert from 'node:assert/strict';
import simulatorPersistenceService, {
  simulatorExternalUserId,
  displayNameForSimulatorStatus,
} from './simulator-persistence.service.js';

test('simulatorExternalUserId usa prefijo estable por sesión', () => {
  assert.equal(simulatorExternalUserId('abc'), 'simulator:abc');
});

test('displayNameForSimulatorStatus refleja estado operativo', () => {
  assert.match(displayNameForSimulatorStatus('waiting_human'), /Esperando humano/i);
  assert.match(displayNameForSimulatorStatus('bot'), /Bot activo/i);
});

test('persistUserInputBeforeEngine y persistEngineResponseAfter están expuestos', () => {
  assert.equal(typeof simulatorPersistenceService.persistUserInputBeforeEngine, 'function');
  assert.equal(typeof simulatorPersistenceService.persistEngineResponseAfter, 'function');
  assert.equal(typeof simulatorPersistenceService.emitUserInbound, 'function');
});
