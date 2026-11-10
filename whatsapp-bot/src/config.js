import dotenv from 'dotenv';
import {
  clampRetentionBatchSize,
  parsePositiveInt,
} from './utils/conversation-retention.js';

dotenv.config();

function envFlag(name, fallback = false) {
  const raw = process.env[name];
  if (raw == null || String(raw).trim() === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(raw).trim().toLowerCase());
}

function parseNonNegativeNumber(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

function monitoringIntervalMinutes(value, fallback) {
  return Math.max(5, parsePositiveInt(value, fallback));
}

const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';
const isProduction = NODE_ENV === 'production';

const TWILIO_SIGNATURE_MODES = new Set(['off', 'log', 'enforce']);

/**
 * off conserva el comportamiento anterior cuando la variable no está.
 * log es el valor de activación. enforce no es el default.
 */
export function resolveTwilioSignatureMode(raw = process.env.TWILIO_SIGNATURE_MODE) {
  if (raw == null || String(raw).trim() === '') {
    return { ok: true, mode: 'off', source: 'default' };
  }
  const mode = String(raw).trim().toLowerCase();
  if (!TWILIO_SIGNATURE_MODES.has(mode)) {
    return { ok: false, mode: null, source: 'env', reason: 'invalid_mode' };
  }
  return { ok: true, mode, source: 'env' };
}

/** Origen público que Twilio firma. No acepta userinfo, query ni fragmentos. */
export function resolveTwilioPublicBase(raw = process.env.APP_BASE_URL) {
  const explicit = String(raw ?? '').trim().replace(/\/$/, '');
  if (!explicit) return { ok: false, reason: 'public_url_unconfigured', base: null };
  let parsed;
  try {
    parsed = new URL(explicit);
  } catch {
    return { ok: false, reason: 'public_url_invalid', base: null };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: 'public_url_invalid', base: null };
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    return { ok: false, reason: 'public_url_invalid', base: null };
  }
  return { ok: true, reason: null, base: explicit };
}

/** Prefijo externo. Vacío si no está configurado. No se infiere del request. */
export function resolveTwilioPublicPathPrefix(raw = process.env.TWILIO_PUBLIC_PATH_PREFIX) {
  const value = String(raw ?? '').trim();
  if (!value) return { ok: true, prefix: '', reason: null };
  if (/[?#]|:\/\/|\.\./.test(value)) {
    return { ok: false, prefix: '', reason: 'public_path_prefix_invalid' };
  }
  const withSlash = value.startsWith('/') ? value : `/${value}`;
  const prefix = withSlash.replace(/\/$/, '');
  if (!prefix || prefix === '/') return { ok: true, prefix: '', reason: null };
  return { ok: true, prefix, reason: null };
}

/**
 * Contrato de URL pública. No mira el request ni los headers forwarded.
 * El pathname de APP_BASE_URL y TWILIO_PUBLIC_PATH_PREFIX no se combinan:
 * los dos juntos son ambiguos y no sirven para log ni para enforce.
 * Si Nginx conserva el prefijo, la base es solo el origen y el prefijo va vacío:
 * la ruta que recibe Express ya es la ruta pública.
 */
export function planTwilioPublicUrl(env = process.env) {
  const base = resolveTwilioPublicBase(env.APP_BASE_URL);
  const prefixState = resolveTwilioPublicPathPrefix(env.TWILIO_PUBLIC_PATH_PREFIX);
  if (!base.ok) {
    return {
      ok: false,
      reason: base.reason,
      origin: null,
      publicPrefix: '',
      prefixSource: null,
      basePath: '',
    };
  }
  if (!prefixState.ok) {
    return {
      ok: false,
      reason: prefixState.reason,
      origin: null,
      publicPrefix: '',
      prefixSource: null,
      basePath: '',
    };
  }
  const parsed = new URL(base.base);
  const basePath = parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/$/, '');
  const origin = `${parsed.protocol}//${parsed.host}`;
  if (basePath && prefixState.prefix) {
    return {
      ok: false,
      reason: 'public_prefix_ambiguous',
      origin,
      publicPrefix: '',
      prefixSource: 'ambiguous',
      basePath,
    };
  }
  const publicPrefix = prefixState.prefix || basePath;
  let prefixSource = 'none';
  if (prefixState.prefix) prefixSource = 'prefix';
  else if (basePath) prefixSource = 'base';
  return {
    ok: true,
    reason: null,
    origin,
    publicPrefix,
    prefixSource,
    basePath,
  };
}

export function assessTwilioSignatureReadiness(
  env = process.env,
  authToken = config.twilioAuthToken,
) {
  const modeState = resolveTwilioSignatureMode(env.TWILIO_SIGNATURE_MODE);
  const base = resolveTwilioPublicBase(env.APP_BASE_URL);
  const prefixState = resolveTwilioPublicPathPrefix(env.TWILIO_PUBLIC_PATH_PREFIX);
  const plan = planTwilioPublicUrl(env);
  const authTokenConfigured = Boolean(String(authToken ?? '').trim());
  const mode = modeState.ok ? modeState.mode : null;
  const logBlocking = [];
  if (!authTokenConfigured) logBlocking.push('missing_auth_token');
  if (!base.ok) logBlocking.push(base.reason);
  if (!prefixState.ok) logBlocking.push(prefixState.reason);
  if (base.ok && prefixState.ok && plan.reason === 'public_prefix_ambiguous') {
    logBlocking.push('public_prefix_ambiguous');
  }
  const configComplete = logBlocking.length === 0;
  const startupBlocking = [];
  if (!modeState.ok) startupBlocking.push('invalid_mode');
  else if ((mode === 'log' || mode === 'enforce') && !configComplete) {
    startupBlocking.push(...logBlocking);
  }
  let configurationState = 'insecure';
  if (configComplete && mode === 'log') configurationState = 'observing';
  if (configComplete && mode === 'enforce') configurationState = 'enforcing';
  const logReady = configComplete;
  return {
    event: 'twilio_signature_preflight',
    mode,
    modeSource: modeState.ok ? modeState.source : 'env',
    modeValid: modeState.ok,
    authTokenConfigured,
    appBaseUrlValid: base.ok,
    appBaseUrlReason: base.ok ? null : base.reason,
    publicPrefixValid: prefixState.ok && plan.reason !== 'public_prefix_ambiguous',
    publicPrefixReason: !prefixState.ok
      ? prefixState.reason
      : (plan.reason === 'public_prefix_ambiguous' ? 'public_prefix_ambiguous' : null),
    prefixSource: plan.prefixSource,
    publicOrigin: plan.origin,
    publicPrefix: plan.publicPrefix,
    configurationState,
    secure: configurationState === 'enforcing',
    activated: configurationState === 'observing' || configurationState === 'enforcing',
    ready: configurationState === 'observing',
    logReady,
    logDisruptive: mode === 'log' && !configComplete,
    enforceConfigurable: configComplete,
    enforceReady: false,
    productionUrlVerified: false,
    startup: startupBlocking.length > 0 ? 'refuse' : 'boot',
    startupBlocking,
    logBlocking,
  };
}

export function twilioSignatureStartupDecision(report) {
  return {
    allowBoot: report.startup !== 'refuse',
    reasons: report.startupBlocking || [],
  };
}

export const config = {
  port: PORT,
  nodeEnv: NODE_ENV,
  isProduction,
  metaVerifyToken: process.env.META_VERIFY_TOKEN,
  metaAccessToken: process.env.META_ACCESS_TOKEN,
  metaPhoneNumberId: process.env.META_PHONE_NUMBER_ID,
  twilioAccountSid: process.env.TWILIO_ACCOUNT_SID,
  twilioAuthToken: process.env.TWILIO_AUTH_TOKEN,
  twilioWhatsappFrom: process.env.TWILIO_WHATSAPP_FROM,
  appBaseUrl: process.env.APP_BASE_URL || `http://localhost:${PORT}`,
  /** Lista CSV de orígenes permitidos (CORS). Vacío en dev → solo localhost. */
  corsOrigin: process.env.CORS_ORIGIN || '',
  adminUsername: (process.env.ADMIN_USERNAME || '').trim(),
  adminPasswordHash: (process.env.ADMIN_PASSWORD_HASH || '').trim().toLowerCase(),
  conversationsOperatorUsername: (process.env.CONVERSATIONS_OPERATOR_USERNAME || '').trim(),
  conversationsOperatorPasswordHash: (
    process.env.CONVERSATIONS_OPERATOR_PASSWORD_HASH || ''
  ).trim().toLowerCase(),
  sessionSecret: process.env.SESSION_SECRET || '',
  googleSheetsEnabled: ['1', 'true', 'yes', 'on'].includes(
    String(process.env.GOOGLE_SHEETS_ENABLED || '').trim().toLowerCase()
  ),
  googleSheetsSpreadsheetId: (process.env.GOOGLE_SHEETS_SPREADSHEET_ID || '').trim(),
  googleSheetsTabName: (process.env.GOOGLE_SHEETS_TAB_NAME || 'Conversaciones').trim(),
  googleSheetsRawTabName: (process.env.GOOGLE_SHEETS_RAW_TAB_NAME || '').trim(),
  googleServiceAccountEmail: (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '').trim(),
  googlePrivateKey: process.env.GOOGLE_PRIVATE_KEY || '',
  abandonTrackingEnabled: ['1', 'true', 'yes', 'on'].includes(
    String(process.env.ABANDON_TRACKING_ENABLED || '').trim().toLowerCase()
  ),
  abandonTimeoutMinutes: Number(process.env.ABANDON_TIMEOUT_MINUTES || 30),
  abandonSweepIntervalSeconds: Number(process.env.ABANDON_SWEEP_INTERVAL_SECONDS || 300),
  abandonIncludeSimulator: ['1', 'true', 'yes', 'on'].includes(
    String(process.env.ABANDON_INCLUDE_SIMULATOR || '').trim().toLowerCase()
  ),
  exportInfoProvidedEvents: ['1', 'true', 'yes', 'on'].includes(
    String(process.env.CONVERSATION_EXPORT_INFO_PROVIDED_EVENTS || '').trim().toLowerCase()
  ),
  conversationDbEnabled: ['1', 'true', 'yes', 'on'].includes(
    String(process.env.CONVERSATION_DB_ENABLED || '').trim().toLowerCase(),
  ),
  conversationRetentionEnabled: ['1', 'true', 'yes', 'on'].includes(
    String(process.env.CONVERSATION_RETENTION_ENABLED || 'false').trim().toLowerCase(),
  ),
  conversationRetentionDays: parsePositiveInt(process.env.CONVERSATION_RETENTION_DAYS, 30),
  conversationRetentionIntervalHours: parsePositiveInt(
    process.env.CONVERSATION_RETENTION_INTERVAL_HOURS,
    24,
  ),
  conversationRetentionBatchSize: clampRetentionBatchSize(
    process.env.CONVERSATION_RETENTION_BATCH_SIZE,
  ),
  monitoringEnabled: envFlag('MONITORING_ENABLED', false),
  monitoringTwilioEnabled: envFlag('MONITORING_TWILIO_ENABLED', false),
  monitoringTwilioIntervalMinutes: monitoringIntervalMinutes(
    process.env.MONITORING_TWILIO_INTERVAL_MINUTES,
    10,
  ),
  monitoringReconciliationIntervalMinutes: monitoringIntervalMinutes(
    process.env.MONITORING_RECONCILIATION_INTERVAL_MINUTES,
    15,
  ),
  twilioBalanceWarningUsd: parseNonNegativeNumber(process.env.TWILIO_BALANCE_WARNING_USD, 20),
  twilioBalanceCriticalUsd: parseNonNegativeNumber(process.env.TWILIO_BALANCE_CRITICAL_USD, 10),
  twilioBalanceEmergencyUsd: parseNonNegativeNumber(process.env.TWILIO_BALANCE_EMERGENCY_USD, 5),
  inboundAnomalyEnabled: envFlag('INBOUND_ANOMALY_ENABLED', false),
  inboundAnomalyWindowMinutes: parsePositiveInt(process.env.INBOUND_ANOMALY_WINDOW_MINUTES, 30),
  inboundAnomalyMinExpected: parsePositiveInt(process.env.INBOUND_ANOMALY_MIN_EXPECTED, 5),
  twilioReconciliationEnabled: envFlag('TWILIO_RECONCILIATION_ENABLED', false),
  twilioReconciliationLookbackMinutes: parsePositiveInt(
    process.env.TWILIO_RECONCILIATION_LOOKBACK_MINUTES,
    60,
  ),
  webhookMaxProcessingAttempts: parsePositiveInt(process.env.WEBHOOK_MAX_PROCESSING_ATTEMPTS, 3),
  // A PROCESSING row older than this may be reclaimed. The clock is updated_at,
  // refreshed on every ownership change. Default 120s.
  webhookProcessingStaleSeconds: parsePositiveInt(process.env.WEBHOOK_PROCESSING_STALE_SECONDS, 120),
  monitoringAlertsEnabled: envFlag('MONITORING_ALERTS_ENABLED', false),
  monitoringAlertCooldownMinutes: parsePositiveInt(process.env.MONITORING_ALERT_COOLDOWN_MINUTES, 60),
  conversationClassificationMode: (() => {
    const raw = String(process.env.CONVERSATION_CLASSIFICATION_MODE || 'legacy').trim().toLowerCase();
    return ['legacy', 'shadow', 'enabled'].includes(raw) ? raw : 'legacy';
  })(),
  conversationClassificationLoggingEnabled: ['1', 'true', 'yes', 'on'].includes(
    String(process.env.CONVERSATION_CLASSIFICATION_LOGGING_ENABLED || 'true').trim().toLowerCase(),
  ),
  conversationClassificationMetricsEnabled: ['1', 'true', 'yes', 'on'].includes(
    String(process.env.CONVERSATION_CLASSIFICATION_METRICS_ENABLED || 'true').trim().toLowerCase(),
  ),
  conversationClassificationTextRulesEnabled: ['1', 'true', 'yes', 'on'].includes(
    String(process.env.CONVERSATION_CLASSIFICATION_TEXT_RULES_ENABLED || 'false').trim().toLowerCase(),
  ),
  conversationClassificationSheetUpdateEnabled: ['1', 'true', 'yes', 'on'].includes(
    String(process.env.CONVERSATION_CLASSIFICATION_SHEET_UPDATE_ENABLED || 'false').trim().toLowerCase(),
  ),
  conversationClassificationReconciliationEnabled: ['1', 'true', 'yes', 'on'].includes(
    String(process.env.CONVERSATION_CLASSIFICATION_RECONCILIATION_ENABLED || 'false').trim().toLowerCase(),
  ),
  dbServer: (process.env.DB_SERVER || '').trim(),
  dbPort: Number(process.env.DB_PORT || 1433),
  dbName: (process.env.DB_NAME || 'tea_bot').trim(),
  dbUser: (process.env.DB_USER || '').trim(),
};

function hasMetaCritical() {
  return Boolean(
    process.env.META_VERIFY_TOKEN
      && process.env.META_ACCESS_TOKEN
      && process.env.META_PHONE_NUMBER_ID,
  );
}

export const validateConfig = () => {
  const adminKeys = ['ADMIN_USERNAME', 'ADMIN_PASSWORD_HASH', 'SESSION_SECRET'];
  const missingAdmin = adminKeys.filter((key) => !process.env[key] || !String(process.env[key]).trim());
  if (missingAdmin.length > 0) {
    console.error('❌ Faltan variables de administración obligatorias:', missingAdmin.join(', '));
    process.exit(1);
  }
  if (!/^[a-f0-9]{64}$/.test(config.adminPasswordHash)) {
    console.error('❌ ADMIN_PASSWORD_HASH debe ser SHA-256 en hexadecimal (64 caracteres).');
    process.exit(1);
  }
  if (String(config.sessionSecret).length < 32) {
    console.error('❌ SESSION_SECRET debe tener al menos 32 caracteres.');
    process.exit(1);
  }

  const signatureReadiness = assessTwilioSignatureReadiness();
  console.log(JSON.stringify(signatureReadiness));
  const signatureStartup = twilioSignatureStartupDecision(signatureReadiness);
  if (!signatureStartup.allowBoot) {
    console.error(
      `❌ Firma Twilio: el proceso no arranca (${signatureStartup.reasons.join(', ')}). No se degrada a off.`,
    );
    if (signatureReadiness.logDisruptive) {
      console.error(
        '❌ TWILIO_SIGNATURE_MODE=log no es una activación inocua con esta configuración. El inbound respondería 403. Dejá off hasta que el preflight marque logReady.',
      );
    }
    process.exit(1);
  }
  if (signatureReadiness.mode === 'off') {
    console.warn(
      '⚠️ Firma Twilio inactiva (off). ready=false. El inbound no exige firma. El callback de estado sí la exige.',
    );
  }

  if (config.conversationsOperatorUsername || config.conversationsOperatorPasswordHash) {
    if (!config.conversationsOperatorUsername || !config.conversationsOperatorPasswordHash) {
      console.error(
        '❌ CONVERSATIONS_OPERATOR_USERNAME y CONVERSATIONS_OPERATOR_PASSWORD_HASH deben definirse juntos.',
      );
      process.exit(1);
    }
    if (!/^[a-f0-9]{64}$/.test(config.conversationsOperatorPasswordHash)) {
      console.error(
        '❌ CONVERSATIONS_OPERATOR_PASSWORD_HASH debe ser SHA-256 en hexadecimal (64 caracteres).',
      );
      process.exit(1);
    }
    if (
      config.adminUsername
      && config.conversationsOperatorUsername.toLowerCase() === config.adminUsername.toLowerCase()
    ) {
      console.error(
        '❌ CONVERSATIONS_OPERATOR_USERNAME no puede ser igual a ADMIN_USERNAME.',
      );
      process.exit(1);
    }
  }

  const metaKeys = ['META_VERIFY_TOKEN', 'META_ACCESS_TOKEN', 'META_PHONE_NUMBER_ID'];
  const missingMeta = metaKeys.filter((key) => !process.env[key]);

  if (config.isProduction) {
    if (missingMeta.length > 0) {
      console.error('❌ Producción: faltan variables Meta obligatorias:', missingMeta.join(', '));
      process.exit(1);
    }
    if (!process.env.CORS_ORIGIN || !String(process.env.CORS_ORIGIN).trim()) {
      console.error('❌ Producción: CORS_ORIGIN es obligatorio (origen del editor o frontend, CSV).');
      process.exit(1);
    }
    if (config.googleSheetsEnabled) {
      const requiredSheets = [
        ['GOOGLE_SHEETS_SPREADSHEET_ID', config.googleSheetsSpreadsheetId],
        ['GOOGLE_SHEETS_TAB_NAME', config.googleSheetsTabName],
        ['GOOGLE_SERVICE_ACCOUNT_EMAIL', config.googleServiceAccountEmail],
        ['GOOGLE_PRIVATE_KEY', config.googlePrivateKey],
      ].filter(([, value]) => !value);
      if (requiredSheets.length > 0) {
        console.warn(
          `⚠️ Google Sheets habilitado pero faltan variables: ${requiredSheets
            .map(([key]) => key)
            .join(', ')}`
        );
      }
    }
    return;
  }

  if (missingMeta.length > 0) {
    console.warn('⚠️  Advertencia: faltan variables Meta:', missingMeta.join(', '));
    console.warn('El webhook y el envío de mensajes fallarán hasta completar el .env');
  }

  if (!process.env.CORS_ORIGIN || !String(process.env.CORS_ORIGIN).trim()) {
    console.log('ℹ️  CORS_ORIGIN no definido: en desarrollo se permiten solo orígenes localhost.');
  }

  const missingTwilio = ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_WHATSAPP_FROM']
    .filter((key) => !process.env[key]);
  if (missingTwilio.length > 0) {
    console.log(
      `ℹ️  Variables Twilio no definidas (${missingTwilio.join(
        ', ',
      )}). Son opcionales en V1 TwiML y requeridas para envío async futuro.`,
    );
  }

  if (config.conversationDbEnabled) {
    const missingDb = ['DB_SERVER', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'].filter(
      (key) => !process.env[key] || !String(process.env[key]).trim(),
    );
    if (missingDb.length > 0) {
      console.warn(
        `⚠️ CONVERSATION_DB_ENABLED=true pero faltan: ${missingDb.join(', ')}`,
      );
    }
  }

  if (config.googleSheetsEnabled) {
    const requiredSheets = [
      ['GOOGLE_SHEETS_SPREADSHEET_ID', config.googleSheetsSpreadsheetId],
      ['GOOGLE_SHEETS_TAB_NAME', config.googleSheetsTabName],
      ['GOOGLE_SERVICE_ACCOUNT_EMAIL', config.googleServiceAccountEmail],
      ['GOOGLE_PRIVATE_KEY', config.googlePrivateKey],
    ].filter(([, value]) => !value);
    if (requiredSheets.length > 0) {
      console.warn(
        `⚠️ Google Sheets habilitado pero faltan variables: ${requiredSheets
          .map(([key]) => key)
          .join(', ')}`
      );
    }
  }
};

export { hasMetaCritical };
