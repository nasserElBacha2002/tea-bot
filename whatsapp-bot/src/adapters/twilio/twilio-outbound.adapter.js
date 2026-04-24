function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function buildTwimlMessage(message) {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(
    message ?? '',
  )}</Message></Response>`;
}

export function buildEmptyTwimlResponse() {
  return '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';
}
