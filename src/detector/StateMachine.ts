import { Settings } from '../config/Settings.js';
import { log } from '../utils/logger.js';

// The 9 vibe states (v3 Evidence-Based Architecture)
export type VibeState =
  | 'idle'
  | 'userCoding'
  | 'userPrompting'
  | 'aiThinking'
  | 'aiGenerating'
  | 'aiWaitingForInput'
  | 'aiNeedsInput'
  | 'userAccepted'
  | 'userDeclined'
  | 'aiComplete';

/** Priority hierarchy — higher-priority states cannot be overridden by lower ones */
const STATE_PRIORITY: Record<VibeState, number> = {
  idle: 0,
  userPrompting: 1,
  userCoding: 2,
  aiThinking: 3,
  aiGenerating: 4,
  aiNeedsInput: 5,   // Highest — user MUST see this (Claude is asking a question)
  aiWaitingForInput: 2,
  userAccepted: 2,
  userDeclined: 2,
  aiComplete: 1,
};

const STATE_EMOJI: Record<VibeState, string> = {
  idle:              '⚪ Grey',
  userCoding:        '🔵 Blue',
  userPrompting:     '🟠 Orange',
  aiThinking:        '🔵 Blue Pulse',
  aiGenerating:      '🟣 Purple',
  aiWaitingForInput: '🟡 Yellow',
  aiNeedsInput:      '🔴 RED ALERT',
  userAccepted:      '✅ Accepted',
  userDeclined:      '❌ Declined',
  aiComplete:        '🟢 DONE Flash',
};

export interface StateChangeEvent {
  previous: VibeState;
  current: VibeState;
  timestamp: number;
}

type StateChangeListener = (event: StateChangeEvent) => void;

/**
 * Core state machine — v3 Evidence-Based Architecture.
 *
 * Key concepts:
 * - Evidence-Based Detection: typing without code change = prompting, with code change = coding
 * - Persistent Busy Lock: isAgentBusy stays true until hard finish or 10s safety timeout
 * - Priority: aiGenerating(4) > aiThinking(3) > userCoding(2) > userPrompting(1) > idle(0)
 */
export class StateMachine {
  private state: VibeState = 'idle';
  private listeners: StateChangeListener[] = [];

  // Timers
  private idleTimer: NodeJS.Timeout | null = null;
  private waitingTimer: NodeJS.Timeout | null = null;
  private completeTimer: NodeJS.Timeout | null = null;
  private transientTimer: NodeJS.Timeout | null = null;
  private safetyTimer: NodeJS.Timeout | null = null;

  // Persistent Busy Lock — while true, idle timer is DISABLED for AI states
  private _isAgentBusy = false;
  private busySafetyTimer: NodeJS.Timeout | null = null;
  private busyStickyUntil = 0; // Timestamp: busy cannot be cleared before this
  private readonly BUSY_SAFETY_TIMEOUT_MS = 10000; // 10s safety timeout
  private readonly BUSY_STICKY_MS = 5000; // 5s minimum busy duration

  constructor(private readonly settings: Settings) {}

  /** Public getter for EditorSignals to check busy state */
  get isAgentBusy(): boolean {
    return this._isAgentBusy;
  }

  // ─── Public signal ingestion ──────────────────────────────────────────────

  /**
   * Evidence-based: the 100ms evidence window expired with NO code change.
   * This means the user's keystrokes went to a webview/chat, not a code file.
   */
  onKeyboardWithoutCodeChange(): void {
    if (!this.settings.enabled) return;
    if (this._isAgentBusy) return;

    if (this.state === 'idle' || this.state === 'userCoding') {
      this.transition('userPrompting');
      this.startIdleTimer(1000);
    }
  }

  /**
   * Called when the user switches to/from a terminal.
   * Terminal-based AI tools (Antigravity agents, Claude Code CLI) trigger this.
   */
  onTerminalFocusChange(hasTerminal: boolean): void {
    if (!this.settings.enabled) return;
    if (this._isAgentBusy) return;

    if (hasTerminal) {
      if (this.state === 'idle' || this.state === 'userCoding') {
        this.transition('userPrompting');
        this.startIdleTimer(1000);
      }
    }
  }

  /**
   * Called on every text document change (from VelocitySignal).
   * Evidence-based: if this fires, code IS changing → userCoding.
   * @param charsInserted Total characters inserted in this single event
   */
  onTextChange(charsInserted: number): void {
    if (!this.settings.enabled) return;

    const threshold = this.settings.aiBurstThreshold;
    const isAiBurst = charsInserted >= threshold;
    const isHumanTyping = charsInserted > 0 && charsInserted < threshold;

    if (isAiBurst) {
      // Already in aiGenerating from JSONL detection — just refresh busy, skip timer restart
      if (this._isAgentBusy && this.state === 'aiGenerating') {
        this.setBusy(true);
        return;
      }
      // Large burst → AI is generating code
      this.clearAllTimers();
      this.setBusy(true);
      this.transition('aiGenerating');
      this.startWaitingTimer();
    } else if (isHumanTyping) {
      if (this._isAgentBusy) return;

      switch (this.state) {
        case 'idle':
          // Code file changed → evidence of coding
          this.transition('userCoding');
          break;
        case 'aiWaitingForInput':
          this.clearAllTimers();
          this.transition('userAccepted');
          this.scheduleTransientReturn('idle', 1500);
          break;
        case 'aiComplete':
          this.clearAllTimers();
          this.transition('userCoding');
          break;
        case 'userCoding':
        case 'userPrompting':
          // Still typing — if we're in Red and code just changed, switch to Blue
          if (this.state === 'userPrompting') {
            this.transition('userCoding');
          }
          break;
        default:
          break;
      }
      // Snappy 1s return to idle when user stops typing
      this.startIdleTimer(1000);
    }
  }

  /**
   * Called when a VS Code command is executed.
   * Used for tool-specific accept/reject detection.
   */
  onCommandExecuted(commandId: string): void {
    if (!this.settings.enabled) return;

    if (this.isAcceptCommand(commandId)) {
      if (this.state === 'aiWaitingForInput' || this.state === 'aiGenerating') {
        this.clearAllTimers();
        this.setBusy(false);
        this.transition('userAccepted');
        this.scheduleTransientReturn('idle', 1500);
      }
    } else if (this.isRejectCommand(commandId)) {
      if (
        this.state === 'aiWaitingForInput' ||
        this.state === 'aiGenerating' ||
        this.state === 'aiThinking'
      ) {
        this.clearAllTimers();
        this.setBusy(false);
        this.transition('userDeclined');
        this.scheduleTransientReturn('idle', 1000);
      }
    }
  }

  /**
   * Called when Antigravity's log shows an agentic API call.
   * Sets the persistent busy lock.
   */
  onAgentApiCall(): void {
    if (!this.settings.enabled) return;

    this.setBusy(true);

    // Transition from any user/idle state → AI is taking over
    if (this.state === 'idle' || this.state === 'userPrompting' || this.state === 'userCoding') {
      this.clearAllTimers();
      this.transition('aiThinking');
    }

    // AI was in a higher/equal priority state and started working again → force back to thinking
    if (this.state === 'aiWaitingForInput' || this.state === 'aiComplete' || this.state === 'aiNeedsInput' || this.state === 'aiGenerating') {
      this.clearAllTimers();
      this.transition('aiThinking', true); // force — these have higher or equal priority
    }

    // AI is still active — cancel any waiting/complete timers
    if (this.state === 'aiThinking') {
      this.clearWaitingAndCompleteTimers();
    }
  }

  /**
   * Called when Antigravity's log goes silent (no API calls for 3+ seconds).
   * Does NOT unlock busy — only hard finish or safety timeout does that.
   */
  onAgentSilence(): void {
    if (!this.settings.enabled) return;

    if (this.state === 'aiThinking' || this.state === 'aiGenerating') {
      this.transition('aiWaitingForInput', true);

      this.completeTimer = setTimeout(() => {
        this.completeTimer = null;
        if (this.state === 'aiWaitingForInput') {
          this.transition('aiComplete', true);
          this.scheduleSafeReturnToIdle(3000);
        }
      }, this.settings.aiCompleteTimeoutMs);
    }
  }

  /**
   * Called by JSONL-based signals (ClaudeCodeSignal) when AI writes/edits code.
   * Transitions to aiGenerating (purple) WITHOUT starting the waiting timer,
   * because JSONL silence detection handles completion — not generic timers.
   */
  onAgentCodeWrite(): void {
    if (!this.settings.enabled) return;
    this.clearAllTimers();
    this.setBusy(true);
    this.transition('aiGenerating');
    // No startWaitingTimer() — JSONL silence detection handles completion
  }

  /**
   * Called when Claude asks the user a question (AskUserQuestion tool).
   * RED rapid pulse — highest priority, user MUST look at screen.
   */
  onAgentNeedsInput(): void {
    if (!this.settings.enabled) return;

    this.clearAllTimers();
    this.setBusy(true);
    this.transition('aiNeedsInput', true);
  }

  /**
   * Called when log detects "Command completed" / "Finished task".
   * This is the HARD FINISH — unlocks busy, flashes green, returns to idle.
   */
  onAgentHardFinish(): void {
    if (!this.settings.enabled) return;

    this.clearAllTimers();
    // Refresh busy lock — the previous setBusy(true) was 4-6s ago (during silence),
    // so the 10s safety timer might expire during the 5s green phase.
    // This resets the safety timer, giving 10s of protection for the green.
    this.setBusy(true);
    this.transition('aiComplete', true);
    this.scheduleSafeReturnToIdle(5000); // 5s green then idle
  }

  /** Force a specific state — used by the test/demo command. */
  forceState(state: VibeState): void {
    this.clearAllTimers();
    this.setBusy(false, true); // force bypass sticky
    this.transition(state, true);
  }

  get currentState(): VibeState {
    return this.state;
  }

  onStateChange(listener: StateChangeListener): void {
    this.listeners.push(listener);
  }

  dispose(): void {
    this.clearAllTimers();
    if (this.busySafetyTimer) { clearTimeout(this.busySafetyTimer); this.busySafetyTimer = null; }
    this.listeners = [];
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  /**
   * Set/clear the persistent busy lock.
   * When locking: starts a 10s safety timeout AND a 5s sticky buffer.
   * When clearing: respects the sticky buffer (won't clear before 5s elapsed),
   * UNLESS force=true (used by hard finish).
   */
  private setBusy(busy: boolean, force = false): void {
    if (this.busySafetyTimer) {
      clearTimeout(this.busySafetyTimer);
      this.busySafetyTimer = null;
    }

    if (busy) {
      this._isAgentBusy = true;
      this.busyStickyUntil = Date.now() + this.BUSY_STICKY_MS;

      // Safety: auto-unlock after 10s of no activity
      this.busySafetyTimer = setTimeout(() => {
        this.busySafetyTimer = null;
        if (this._isAgentBusy) {
          log('[VIBE] ⏱️ Busy safety timeout (10s) — unlocking');
          this._isAgentBusy = false;
          this.busyStickyUntil = 0;
          // If still in an AI state, transition to complete → idle
          if (this.state === 'aiThinking' || this.state === 'aiGenerating' || this.state === 'aiWaitingForInput') {
            this.transition('aiComplete', true);
            this.scheduleSafeReturnToIdle(500);
          }
        }
      }, this.BUSY_SAFETY_TIMEOUT_MS);
    } else {
      // Respect sticky buffer unless force (hard finish)
      if (!force && Date.now() < this.busyStickyUntil) {
        return; // Can't clear yet — sticky period active
      }
      this._isAgentBusy = false;
      this.busyStickyUntil = 0;
    }
  }

  /**
   * Public method for LogTailSignal's file pulse sensor.
   * Keeps the busy lock alive when log file activity is detected.
   */
  onFilePulse(): void {
    if (!this.settings.enabled) return;
    this.setBusy(true);
  }

  /**
   * Called by ClaudeCodeSignal when we know Claude is still mid-task
   * (expecting more messages after tool execution).
   * Clears all timers and refreshes busy lock to prevent false completion.
   */
  onAgentStillWorking(): void {
    if (!this.settings.enabled) return;
    this.clearAllTimers();
    this.setBusy(true);
  }

  /**
   * Priority-aware transition. Only logs when state actually changes.
   */
  private transition(newState: VibeState, force = false): void {
    if (this.state === newState) return;
    if (!force && STATE_PRIORITY[newState] < STATE_PRIORITY[this.state]) {
      return;
    }

    const prev = this.state;
    this.state = newState;

    log(`[VIBE] ${STATE_EMOJI[prev]} -> ${STATE_EMOJI[newState]}`);

    const event: StateChangeEvent = {
      previous: prev,
      current: newState,
      timestamp: Date.now(),
    };
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  /**
   * Start the "waiting for input" timer.
   * When AI stops generating for `aiWaitingTimeoutMs`, transition to WAITING.
   */
  private startWaitingTimer(): void {
    this.clearWaitingAndCompleteTimers();

    this.waitingTimer = setTimeout(() => {
      this.waitingTimer = null;
      if (this.state === 'aiGenerating') {
        this.transition('aiWaitingForInput', true);
        this.completeTimer = setTimeout(() => {
          this.completeTimer = null;
          if (this.state === 'aiWaitingForInput') {
            this.transition('aiComplete', true);
            this.scheduleSafeReturnToIdle(3000);
          }
        }, this.settings.aiCompleteTimeoutMs);
      }
    }, this.settings.aiWaitingTimeoutMs);
  }

  /**
   * Dedicated safety timer for aiComplete → idle.
   */
  private scheduleSafeReturnToIdle(ms: number): void {
    if (this.safetyTimer) clearTimeout(this.safetyTimer);
    this.safetyTimer = setTimeout(() => {
      this.safetyTimer = null;
      if (this.state === 'aiComplete') {
        this.setBusy(false, true); // force clear — going idle means busy must end
        this.transition('idle', true);
      }
    }, ms);
  }

  /**
   * General idle timer — returns to IDLE after inactivity.
   * CRITICAL: Disabled while isAgentBusy is true.
   */
  private startIdleTimer(ms: number): void {
    if (this._isAgentBusy) return; // Busy lock prevents idle timeout

    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (
        this.state === 'userCoding' ||
        this.state === 'userPrompting' ||
        this.state === 'aiComplete'
      ) {
        this.clearAllTimers();
        this.transition('idle', true);
      }
    }, ms);
  }

  /**
   * Transient state: show a flash state for `durationMs`, then move to `returnState`.
   */
  private scheduleTransientReturn(returnState: VibeState, durationMs: number): void {
    if (this.transientTimer) clearTimeout(this.transientTimer);
    this.transientTimer = setTimeout(() => {
      this.transientTimer = null;
      this.transition(returnState, true);
    }, durationMs);
  }

  private clearWaitingAndCompleteTimers(): void {
    if (this.waitingTimer) { clearTimeout(this.waitingTimer); this.waitingTimer = null; }
    if (this.completeTimer) { clearTimeout(this.completeTimer); this.completeTimer = null; }
  }

  private clearAllTimers(): void {
    if (this.idleTimer)     { clearTimeout(this.idleTimer);     this.idleTimer = null; }
    if (this.waitingTimer)  { clearTimeout(this.waitingTimer);  this.waitingTimer = null; }
    if (this.completeTimer) { clearTimeout(this.completeTimer); this.completeTimer = null; }
    if (this.transientTimer){ clearTimeout(this.transientTimer);this.transientTimer = null; }
    // NOTE: safetyTimer and busySafetyTimer are NOT cleared here
  }

  private isAcceptCommand(cmd: string): boolean {
    const acceptPatterns = [
      'editor.action.inlineSuggest.accept',
      'editor.action.inlineSuggest.acceptNextWord',
      'workbench.action.chat.accept',
      'continue.acceptDiff',
      'codeium.acceptSuggestion',
      'editor.action.acceptInlineEdit',
    ];
    return acceptPatterns.some((p) => cmd.toLowerCase().includes(p.toLowerCase()));
  }

  private isRejectCommand(cmd: string): boolean {
    const rejectPatterns = [
      'editor.action.inlineSuggest.undo',
      'editor.action.inlineSuggest.hide',
      'workbench.action.chat.discard',
      'continue.rejectDiff',
      'codeium.rejectSuggestion',
      'editor.action.revertInlineEdit',
      'editor.action.rejectInlineEdit',
    ];
    return rejectPatterns.some((p) => cmd.toLowerCase().includes(p.toLowerCase()));
  }
}
