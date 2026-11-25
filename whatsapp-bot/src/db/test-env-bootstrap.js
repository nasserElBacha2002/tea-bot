import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, '../../.env');

dotenv.config({ path: envPath, quiet: true });

export function testEnvBootstrapStatus() {
  const hasUser = Boolean(String(process.env.DB_USER || '').trim());
  const hasPassword = Boolean(String(process.env.DB_PASSWORD || '').trim());
  const server = String(process.env.DB_SERVER || '').trim();
  const name = String(process.env.DB_NAME || '').trim();
  return { hasUser, hasPassword, server, name, envPath };
}