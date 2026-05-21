import axios from 'axios';
import { config } from '../config.js';
import { normalizeTwilioWhatsappNumber } from '../utils/twilio-phone.js';

/**
 * @param {string | null | undefined} phoneNumber E.164 o whatsapp:+...
 */
export function toTwilioWhatsAppAddress(phoneNumber) {
  const normalized = normalizeTwilioWhatsappNumber(phoneNumber);
  if (!normalized) {
    const err = new Error('Número de teléfono inválido para WhatsApp');
    err.code = 'INVALID_PHONE';
    throw err;
  }
  return `whatsapp:${normalized}`;
}

export class TwilioWhatsAppService {
  assertConfigured() {
    const missing = ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_WHATSAPP_FROM'].filter(
      (key) => !process.env[key] || !String(process.env[key]).trim(),
    );
    if (missing.length > 0) {
      const err = new Error('Twilio no está configurado para envío de mensajes');
      err.code = 'TWILIO_NOT_CONFIGURED';
      err.missing = missing;
      throw err;
    }
  }

  /**
   * @param {{ to: string, body: string }} params
   * @returns {Promise<{ sid: string | null }>}
   */
  async sendWhatsAppMessage({ to, body }) {
    this.assertConfigured();

    const toAddress = String(to).startsWith('whatsapp:')
      ? to
      : toTwilioWhatsAppAddress(to);

    const url = `https://api.twilio.com/2010-04-01/Accounts/${config.twilioAccountSid}/Messages.json`;
    const payload = new URLSearchParams();
    payload.append('To', toAddress);
    payload.append('From', config.twilioWhatsappFrom);
    payload.append('Body', body);

    try {
      const { data } = await axios.post(url, payload.toString(), {
        auth: {
          username: config.twilioAccountSid,
          password: config.twilioAuthToken,
        },
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: Number(process.env.TWILIO_REQUEST_TIMEOUT_MS || 15000),
      });
      return { sid: data?.sid || null };
    } catch (error) {
      const twilioMsg =
        error.response?.data?.message || error.message || 'Error desconocido de Twilio';
      console.error('[TwilioWhatsApp] send failed:', twilioMsg);
      const err = new Error('No se pudo enviar el mensaje por Twilio');
      err.code = 'TWILIO_SEND_FAILED';
      err.cause = twilioMsg;
      throw err;
    }
  }
}

const twilioWhatsAppService = new TwilioWhatsAppService();
export default twilioWhatsAppService;
