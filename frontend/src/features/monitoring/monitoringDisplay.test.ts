import { describe, expect, it } from 'vitest';
import { formatMonitoringTime, monitoringBadgeColor } from './monitoringDisplay';

describe('monitoring badges', () => {
  it('mapea estados operativos a colores', () => {
    expect(monitoringBadgeColor('HEALTHY')).toBe('success');
    expect(monitoringBadgeColor('ONLINE')).toBe('success');
    expect(monitoringBadgeColor('DEGRADED')).toBe('warning');
    expect(monitoringBadgeColor('CRITICAL')).toBe('error');
    expect(monitoringBadgeColor('UNKNOWN')).toBe('default');
  });

  it('no inventa una fecha vacía', () => {
    expect(formatMonitoringTime(null)).toBe('—');
  });
});
