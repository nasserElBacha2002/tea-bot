/**
 * Una base de pruebas tiene que declararse. Que el nombre contenga "test"
 * no alcanza: "contest" o un túnel hacia otro servidor también lo cumplirían.
 *
 * Exige las tres condiciones:
 * - servidor local (localhost, 127.0.0.1 o el hostname sqlserver del compose)
 * - nombre tea_bot_test_<sufijo>, sin "prod" y distinto de tea-bot
 * - TB_SQL_TEST_CONFIRM=tea_bot_test
 */
const TEST_NAME = /^tea_bot_test_[a-z0-9_]+$/;
const LOCAL_SERVERS = new Set(['localhost', '127.0.0.1', 'sqlserver']);

export function isolatedTestDatabaseReason() {
  const name = String(process.env.DB_NAME || '').trim().toLowerCase();
  const server = String(process.env.DB_SERVER || '').trim().toLowerCase();
  const confirm = String(process.env.TB_SQL_TEST_CONFIRM || '').trim();

  if (!LOCAL_SERVERS.has(server)) {
    return 'SQL TEST aislado no configurado: DB_SERVER debe ser localhost, 127.0.0.1 o sqlserver';
  }
  if (!name || name === 'tea-bot' || name.includes('prod') || !TEST_NAME.test(name)) {
    return 'SQL TEST aislado no configurado: DB_NAME debe ser tea_bot_test_<sufijo>';
  }
  if (confirm !== 'tea_bot_test') {
    return 'SQL TEST aislado no configurado: falta TB_SQL_TEST_CONFIRM=tea_bot_test';
  }
  return null;
}
