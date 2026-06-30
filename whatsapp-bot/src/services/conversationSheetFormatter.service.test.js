import test from 'node:test';
import assert from 'node:assert/strict';
import conversationSheetFormatterService, {
  EMAIL_COLUMN_HEADER,
  findSheetRowMatch,
  formatContactEmailForSheet,
  phonesMatch,
  sheetDatesMatch,
} from './conversationSheetFormatter.service.js';

function baseSession(overrides = {}) {
  return {
    provider: 'simulator',
    phone: 'sim-main-menu-123',
    startedAt: '2026-05-05T15:00:00.000Z',
    updatedAt: '2026-05-05T15:00:10.000Z',
    visitedNodes: ['si_menu', 'si_presenciales_tipo', 'si_pg_menu', 'si_pg_direccion', 'human_handoff'],
    answers: { es_estudiante: 'SI' },
    lastUserMessage: 'humano',
    ...overrides,
  };
}

test('formatHumanRecord produce exactamente 14 columnas alineadas con headers', () => {
  const result = conversationSheetFormatterService.formatHumanRecord({
    session: baseSession(),
    finalStatus: 'human_handoff',
    context: { reason: 'human_handoff', requiresHuman: true },
    nowIso: '2026-05-05T15:00:12.000Z',
    flow: null,
  });
  assert.equal(result.headers.length, 14);
  assert.equal(result.row.length, 14);
  assert.deepEqual(result.headers, conversationSheetFormatterService.humanHeaders());
  assert.equal(result.headers.at(-1), EMAIL_COLUMN_HEADER);
});

test('formatHumanRecord incluye email de contacto', () => {
  const result = conversationSheetFormatterService.formatHumanRecord({
    session: baseSession({ provider: 'meta', phone: 'whatsapp:+5491111111111' }),
    finalStatus: 'completed',
    context: {},
    nowIso: '2026-05-05T15:00:12.000Z',
    flow: null,
    contactEmail: 'user@example.com',
  });
  assert.equal(result.row.at(-1), 'user@example.com');
  assert.equal(formatContactEmailForSheet(null), '—');
});

test('human_handoff con provider simulator formatea campos humanos clave', () => {
  const result = conversationSheetFormatterService.formatHumanRecord({
    session: baseSession(),
    finalStatus: 'human_handoff',
    context: { reason: 'human_handoff', requiresHuman: true },
    nowIso: '2026-05-05T15:00:12.000Z',
    flow: null,
  });
  assert.equal(result.row[2], 'Simulador');
  assert.equal(result.row[6], 'Derivado a humano');
  assert.equal(result.row[7], 'Sí');
  assert.equal(result.row[8], 'El usuario pidió hablar con una persona.');
  assert.equal(result.row[9], 'Contactar al usuario');
});

test('findSheetRowMatch localiza fila por teléfono y fecha de inicio', () => {
  const headers = conversationSheetFormatterService.humanHeaders();
  const formatted = conversationSheetFormatterService.formatHumanRecord({
    session: baseSession({ provider: 'meta', phone: 'whatsapp:+5491111111111' }),
    finalStatus: 'human_handoff',
    context: {},
    nowIso: '2026-05-05T15:00:12.000Z',
    flow: null,
  });
  const sheetRow = findSheetRowMatch(headers, [formatted.row], {
    phoneNumber: '+5491111111111',
    startedAt: '2026-05-05T15:00:00.000Z',
    closedAt: '2026-05-05T15:00:12.000Z',
  });
  assert.equal(sheetRow, 2);
});

test('findSheetRowMatch devuelve null si no hay coincidencia', () => {
  const headers = conversationSheetFormatterService.humanHeaders();
  assert.equal(
    findSheetRowMatch(headers, [], {
      phoneNumber: '+5491111111111',
      startedAt: '2026-05-05T15:00:00.000Z',
    }),
    null,
  );
});

test('phonesMatch ignora prefijo + y formato del sheet', () => {
  assert.equal(phonesMatch('5491136072452', '+5491136072452'), true);
  assert.equal(phonesMatch('5491136072452', 'whatsapp:+5491136072452'), true);
});

test('sheetDatesMatch compara fecha del sheet con timestamp de DB', () => {
  assert.equal(
    sheetDatesMatch('2026-06-25T17:41:20.424Z', '25/6/26, 5:41 p. m.'),
    true,
  );
});

test('findSheetRowMatch localiza fila con teléfono sin + y fecha local del sheet', () => {
  const headers = conversationSheetFormatterService.humanHeaders();
  const row = new Array(headers.length).fill('—');
  row[headers.indexOf('Teléfono')] = '5491136072452';
  row[headers.indexOf('Fecha de inicio')] = '25/6/26, 5:41 p. m.';
  row[headers.indexOf('Fecha de cierre')] = '25/6/26, 6:00 p. m.';
  row[headers.indexOf(EMAIL_COLUMN_HEADER)] = '—';

  const sheetRow = findSheetRowMatch(headers, [row], {
    phoneNumber: '+5491136072452',
    startedAt: '2026-06-25T17:41:20.424Z',
    lastMessageAt: '2026-06-26T15:52:26.163Z',
  });
  assert.equal(sheetRow, 2);
});

test('recorrido conocido usa etiquetas humanas esperadas', () => {
  const result = conversationSheetFormatterService.formatHumanRecord({
    session: baseSession(),
    finalStatus: 'human_handoff',
    context: {},
    nowIso: '2026-05-05T15:00:12.000Z',
    flow: null,
  });
  assert.equal(result.row[10], 'Estudiante/egresado → Presenciales → Posgrado → Dirección → Humano');
});
