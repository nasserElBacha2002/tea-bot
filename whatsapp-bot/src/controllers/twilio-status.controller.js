import { buildEmptyTwimlResponse } from '../adapters/twilio/twilio-outbound.adapter.js';
import monitoringService from '../monitoring/monitoring.service.js';

export async function receiveTwilioStatus(req, res) {
  try {
    await monitoringService.recordDeliveryStatus(req.body || {});
  } catch (error) {
    console.error(`[Monitoring] delivery status failed: ${error.message}`);
  }
  return res.status(200).type('text/xml').send(buildEmptyTwimlResponse());
}
