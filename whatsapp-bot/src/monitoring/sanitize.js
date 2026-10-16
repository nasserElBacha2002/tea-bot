const SENSITIVE_KEY = /token|password|secret|authorization|private.?key|auth/i;
const ALLOWED_KEYS = [
  'MessageSid',
  'SmsMessageSid',
  'SmsSid',
  'From',
  'To',
  'Body',
  'MessageStatus',
  'SmsStatus',
  'ErrorCode',
  'ErrorMessage',
  'NumMedia',
];

export function sanitizeWebhookPayload(body) {
  if (!body || typeof body !== 'object') return null;
  const payload = {};
  for (const key of ALLOWED_KEYS) {
    if (body[key] == null || body[key] === '') continue;
    if (SENSITIVE_KEY.test(key)) continue;
    const value = String(body[key]);
    payload[key] = key === 'Body' ? value.slice(0, 500) : value.slice(0, 200);
  }
  return payload;
}
