import { getMonitoringStatusView } from '../proctoringStatus';

/**
 * The status-dot contract (Phase 9 redesign): green ONLY for a genuinely
 * monitoring engine; amber for transient states; red only when monitoring
 * cannot do its job; grey for intentional/inactive. If the engine ever adds
 * a status this map doesn't know, it must degrade to grey — never green.
 */
describe('monitoring status dot mapping', () => {
  it('green only when the engine genuinely reports monitoring', () => {
    const view = getMonitoringStatusView('monitoring', null);
    expect(view.tone).toBe('active');
    expect(view.label).toBe('Monitoring active');
  });

  it('amber for starting and paused (transient, monitoring not yet/again active)', () => {
    for (const status of ['idle', 'starting', 'paused'] as const) {
      const view = getMonitoringStatusView(status, null);
      expect(view.tone).toBe('intermediate');
      expect(view.label.toLowerCase()).not.toContain('active');
    }
  });

  it('red only for camera issues monitoring cannot work around; amber for environmental ones', () => {
    for (const issue of ['permission', 'camera-error', 'model'] as const) {
      expect(getMonitoringStatusView('degraded', issue).tone).toBe('failure');
    }
    for (const issue of ['dark', 'frozen', 'camera-startup'] as const) {
      const view = getMonitoringStatusView('degraded', issue);
      expect(view.tone).toBe('intermediate');
      expect(view.detail).toBeTruthy(); // the specific issue is explained
    }
  });

  it('grey for intentional stop and for the not-armed case', () => {
    expect(getMonitoringStatusView('stopped', null).tone).toBe('inactive');
    expect(getMonitoringStatusView('monitoring', null, false).tone).toBe('inactive');
    expect(getMonitoringStatusView('monitoring', null, false).label).toBe('Monitoring off');
  });

  it('an unknown future status degrades to grey, never green', () => {
    const view = getMonitoringStatusView('hyperdrive' as any, null);
    expect(view.tone).toBe('inactive');
  });
});
