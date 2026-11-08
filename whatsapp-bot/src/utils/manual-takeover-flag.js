export function isManualTakeoverEnabled() {
  const raw = process.env.MANUAL_TAKEOVER_ENABLED;
  if (raw == null || String(raw).trim() === '') return false;
  return ['1', 'true', 'yes', 'on'].includes(String(raw).trim().toLowerCase());
}
