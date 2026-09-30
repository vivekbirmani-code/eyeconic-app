/**
 * FocusTracker — Phase 4 integrity-signal episode formation (plan §14, §20.5).
 *
 * Pure sibling of episodeTracker.ts (which owns CV conditions and stays
 * untouched): this module turns AppState transitions into APP_BACKGROUND
 * episodes and BackHandler interceptions into EXIT_ATTEMPTED point events,
 * reusing the same episode semantics (interval + duration, never per-event
 * noise) and the same transport (the engine's buffer).
 *
 * Benign-interruption contract (§20.5, D4): an ordinary background event is a
 * RECORDED SIGNAL, never a verdict. Sub-floor excursions are blips — no event
 * at all while within tolerance; beyond tolerance they aggregate into ONE
 * repeated_brief episode. Each qualifying excursion (≥ the frozen
 * focusEvents.minDurationMs floor) produces exactly one duration-bearing
 * episode. Warnings/violations/auto-submit do not exist here — they are the
 * Phase 6 rules engine's job, server-side.
 */

import type { ProctoringEpisodeEvent, ProctoringPolicy } from './types';

/**
 * §20.5 illustrative defaults (plan §20.5 / §36.10): benign-length
 * interruptions within this tolerance are uncounted. Client-side constants —
 * same precedent as episodeTracker's provisional visibility floor; the frozen
 * policy schema carries no knob for them in V1.
 */
export const BENIGN_BLIP_TOLERANCE = 5;
export const BENIGN_BLIP_WINDOW_MS = 5 * 60 * 1000;

/** focusEvents floor default — mirrors the frozen defaults.js value. */
const DEFAULT_FOCUS_MIN_DURATION_MS = 2000;

export interface FocusTrackerOptions {
  policy?: ProctoringPolicy | null;
  now?: () => number;
}

/**
 * Feed one app-state change (`AppState.addEventListener('change')` value).
 * Only 'background' opens an episode — 'inactive' is transient (Android
 * permission dialogs, iOS control-center pulls — plan §14.4) and must never
 * count. Returns the episodes that finished on this transition.
 */
export type FocusAppStateInput = 'active' | 'background' | 'inactive' | string;

export class FocusTracker {
  private readonly policy: ProctoringPolicy | null | undefined;
  private readonly now: () => number;
  private openBackgroundOpenedAt: number | null = null;
  private blips: number[] = [];

  constructor(options: FocusTrackerOptions = {}) {
    this.policy = options.policy ?? null;
    this.now = options.now ?? (() => Date.now());
  }

  /** The frozen focus floor — sub-floor excursions are benign blips (§20.5). */
  get minDurationMs(): number {
    const value = this.policy?.focusEvents?.minDurationMs;
    return typeof value === 'number' && value > 0 ? value : DEFAULT_FOCUS_MIN_DURATION_MS;
  }

  onAppStateChange(nextState: FocusAppStateInput): ProctoringEpisodeEvent[] {
    if (nextState === 'background') {
      if (this.openBackgroundOpenedAt === null) {
        this.openBackgroundOpenedAt = this.now();
      }
      return [];
    }
    if (nextState === 'active') {
      const openedAt = this.openBackgroundOpenedAt;
      this.openBackgroundOpenedAt = null;
      if (openedAt === null) return [];
      return this.finishExcursion(openedAt, this.now());
    }
    // 'inactive' and unknown states: transient/no signal — never an episode.
    return [];
  }

  /** BackHandler interception while proctored — informational point event. */
  onExitAttempted(): ProctoringEpisodeEvent[] {
    const at = this.now();
    return [{ type: 'EXIT_ATTEMPTED', openedAt: at, closedAt: at }];
  }

  /**
   * Close any open excursion (engine teardown). An excursion still open at
   * teardown gets the same blip/floor treatment as a closed one — nothing is
   * invented about when it ended beyond "now".
   */
  closeAll(): ProctoringEpisodeEvent[] {
    const openedAt = this.openBackgroundOpenedAt;
    this.openBackgroundOpenedAt = null;
    if (openedAt === null) return [];
    return this.finishExcursion(openedAt, this.now());
  }

  /**
   * §20.5 tolerance: blips are dropped entirely while within tolerance;
   * once more than BENIGN_BLIP_TOLERANCE land inside the rolling window, the
   * excess aggregates into ONE repeated_brief episode (mirroring the §11.1
   * repeated-brief pattern) and the window resets — one aggregate record per
   * tolerance breach, never a flood of tiny events.
   */
  private recordBlip(openedAt: number, closedAt: number): ProctoringEpisodeEvent[] {
    const windowCutoff = closedAt - BENIGN_BLIP_WINDOW_MS;
    this.blips = this.blips.filter((ts) => ts >= windowCutoff);
    this.blips.push(openedAt);
    if (this.blips.length <= BENIGN_BLIP_TOLERANCE) {
      return []; // recovered within tolerance — uncounted (§20.5)
    }
    const count = this.blips.length;
    const firstBlipAt = this.blips[0];
    this.blips = [];
    return [{
      type: 'APP_BACKGROUND',
      openedAt: firstBlipAt,
      closedAt,
      metadata: { pattern: 'repeated_brief', count, windowMs: BENIGN_BLIP_WINDOW_MS },
    }];
  }

  private finishExcursion(openedAt: number, closedAt: number): ProctoringEpisodeEvent[] {
    if (closedAt - openedAt < this.minDurationMs) {
      return this.recordBlip(openedAt, closedAt);
    }
    // One duration-bearing episode per qualifying excursion (§14.2) — the
    // duration itself is the data reviewers and the Phase 6 rules engine use.
    return [{ type: 'APP_BACKGROUND', openedAt, closedAt }];
  }
}
