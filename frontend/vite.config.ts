/// <reference types="vitest/config" />
import { createLogger, defineConfig, type Logger } from 'vite';
import react from '@vitejs/plugin-react';

const EXPECTED_WS_CLOSE = /EPIPE|ECONNRESET|ECONNREFUSED|ECONNABORTED|socket has been ended by the other party|socket hang up/i;

function isExpectedWsProxyClose(msg: string): boolean {
  return msg.includes('ws proxy error') || msg.includes('ws proxy socket error')
    ? EXPECTED_WS_CLOSE.test(msg)
    : false;
}

function createDevLogger(): Logger {
  const logger = createLogger();
  const logError = logger.error.bind(logger);
  logger.error = (msg, options) => {
    if (isExpectedWsProxyClose(String(msg))) return;
    logError(msg, options);
  };
  return logger;
}

// https://vite.dev/config/
export default defineConfig({
  customLogger: createDevLogger(),
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        ws: true,
      },
    },
  },
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./src/test/setupTests.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
