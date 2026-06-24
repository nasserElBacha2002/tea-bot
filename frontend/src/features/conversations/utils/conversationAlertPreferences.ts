const ENABLED_KEY = 'tea:conversation-alerts-enabled';

export function getConversationAlertsEnabled(): boolean {
  try {
    const stored = localStorage.getItem(ENABLED_KEY);
    if (stored === null) return true;
    return stored === 'true';
  } catch {
    return true;
  }
}

export function setConversationAlertsEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(ENABLED_KEY, enabled ? 'true' : 'false');
  } catch {
    // ignore storage failures
  }
}
