import axios from 'axios';
import { config } from '../config.js';

/**
 * Envía un mensaje de texto a través de la API de Meta.
 * @param {Object} params - Objeto con los parámetros de envío.
 * @param {string} params.to - El número de WhatsApp del destinatario (ej. "5491112345678").
 * @param {string} params.message - El texto del mensaje que se desea enviar.
 * @returns {Promise} - La respuesta de la solicitud axios.
 */
export const sendTextMessage = async ({ to, message }) => {
  // Validación de pre-vuelo: asegurar que tenemos los tokens necesarios
  if (!config.metaAccessToken || !config.metaPhoneNumberId) {
    throw new Error('Configuración incompleta: falta META_ACCESS_TOKEN o META_PHONE_NUMBER_ID');
  }

  const META_URL = `https://graph.facebook.com/v22.0/${config.metaPhoneNumberId}/messages`;

  try {
    const payload = {
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: {
        body: message,
      },
    };

    const response = await axios.post(META_URL, payload, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.metaAccessToken}`,
      },
    });

    return response.data;
  } catch (error) {
    const errorStatus = error.response?.status;
    const errorData = error.response?.data;

    console.error(`❌ Error en sendTextMessage: [${errorStatus || 'NETWORK_ERROR'}] ${error.message}`);
    if (errorData) {
      console.error('Detalles de Meta:', JSON.stringify(errorData, null, 2));
    }

    throw error;
  }
};
