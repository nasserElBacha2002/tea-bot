import test from 'node:test';
import assert from 'node:assert/strict';
import { detectGlobalCommand } from './global-commands.js';

test('detecta comando menu con acentos y variantes', () => {
  assert.equal(detectGlobalCommand('menú').type, 'menu');
  assert.equal(detectGlobalCommand('volver al menu').type, 'menu');
  assert.equal(detectGlobalCommand('inicio').type, 'menu');
});

test('detecta comando atras', () => {
  assert.equal(detectGlobalCommand('atras').type, 'back');
  assert.equal(detectGlobalCommand('volver atrás').type, 'back');
});

test('detecta comando humano', () => {
  assert.equal(detectGlobalCommand('humano').type, 'human');
  assert.equal(detectGlobalCommand('asesora').type, 'human');
});

test('detecta pedido explícito de humano en frases', () => {
  assert.equal(detectGlobalCommand('quiero hablar con una persona').type, 'human');
  assert.equal(detectGlobalCommand('Quiero hablar con un humano').type, 'human');
  assert.equal(detectGlobalCommand('pasame con un asesor').type, 'human');
  assert.equal(detectGlobalCommand('necesito atención humana').type, 'human');
  assert.equal(detectGlobalCommand('quiero hablar con alguien').type, 'human');
});

test('retorna null para texto normal', () => {
  assert.equal(detectGlobalCommand('hola').type, null);
  assert.equal(
    detectGlobalCommand('Hola, quería saber si todavía están abiertas las inscripciones').type,
    null,
  );
});
