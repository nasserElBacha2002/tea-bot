/**
 * Una escritura de prueba tiene que declararse. Que el nombre contenga "test"
 * no alcanza, y localhost solo tampoco: un túnel o una base ambigua quedan afuera.
 *
 * Acepta una de estas dos declaraciones, siempre sobre un servidor local
 * (localhost, 127.0.0.1 o el hostname sqlserver del compose):
 * - DB_NAME=tea-bot y TB_SQL_TEST_CONFIRM=tea-bot
 * - DB_NAME=tea_bot_test_<sufijo> y TB_SQL_TEST_CONFIRM=tea_bot_test
 */
const TEST_NAME = /^tea_bot_test_[a-z0-9_]+$/;
const LOCAL_SERVERS = new Set(['localhost', '127.0.0.1', 'sqlserver']);

export function isolatedTestDatabaseReason(env = process.env) {
  const name = String(env.DB_NAME || '').trim().toLowerCase();
  const server = String(env.DB_SERVER || '').trim().toLowerCase();
  const confirm = String(env.TB_SQL_TEST_CONFIRM || '').trim();

  if (!LOCAL_SERVERS.has(server)) {
    return 'SQL TEST aislado no configurado: DB_SERVER debe ser localhost, 127.0.0.1 o sqlserver';
  }
  if (!name || name.includes('prod')) {
    return 'SQL TEST aislado no configurado: DB_NAME ausente o no es una base de prueba';
  }
  if (name === 'tea-bot') {
    if (confirm !== 'tea-bot') {
      return 'SQL TEST aislado no configurado: tea-bot exige TB_SQL_TEST_CONFIRM=tea-bot';
    }
    return null;
  }
  if (!TEST_NAME.test(name)) {
    return 'SQL TEST aislado no configurado: DB_NAME debe ser tea-bot o tea_bot_test_<sufijo>';
  }
  if (confirm !== 'tea_bot_test') {
    return 'SQL TEST aislado no configurado: falta TB_SQL_TEST_CONFIRM=tea_bot_test';
  }
  return null;
}
