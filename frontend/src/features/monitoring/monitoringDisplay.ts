export type BadgeColor = 'success' | 'warning' | 'error' | 'default';

export function monitoringBadgeColor(value: string | null | undefined): BadgeColor {
  const normalized = String(value || '').toUpperCase();
  if (['HEALTHY', 'ONLINE', 'ACTIVE', 'UP', 'CONNECTED', 'SUCCESS', 'RESOLVED', 'BOT_OPERATIONAL', 'PROCESS_UP', 'ENABLED', 'TWILIO_AND_DB_OK'].includes(normalized)) {
    return 'success';
  }
  if (['DEGRADED', 'WARNING', 'NO_ACTIVITY', 'CLEANUP_FAILED', 'RUNNING'].includes(normalized)) {
    return 'warning';
  }
  if (['CRITICAL', 'EMERGENCY', 'FAILED', 'OFFLINE', 'SUSPENDED', 'OPEN', 'DB_ISSUE', 'BACKEND_DEGRADED'].includes(normalized)) {
    return 'error';
  }
  return 'default';
}

export function formatMonitoringTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
}
