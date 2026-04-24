import dotenv from 'dotenv';

dotenv.config();

const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';
const isProduction = NODE_ENV === 'production';

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
  sessionSecret: process.env.SESSION_SECRET || '',
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
};

export { hasMetaCritical };
