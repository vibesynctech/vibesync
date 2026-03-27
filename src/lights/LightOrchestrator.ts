import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ILightController } from './ILightController.js';
import { PulseAnimator } from './PulseAnimator.js';
import { LightEffect, VibeTheme, resolveTheme } from '../themes/index.js';
import { VibeState } from '../detector/StateMachine.js';
import { Settings } from '../config/Settings.js';
import { SoundPlayer } from '../sounds/SoundPlayer.js';
import { resolveSoundPack } from '../sounds/types.js';
import { ScreenGlowController } from './ScreenGlowController.js';
import { log, logError } from '../utils/logger.js';

/** Mutable reference so LightOrchestrator always uses the latest controller */
export interface ControllerRef {
  tapo: ILightController;
}

/**
 * Bridges the state machine and the light controller.
 * Receives state changes → looks up theme effect → applies it.
 *
 * Handles:
 * - Static colors
 * - Pulse animations (via PulseAnimator)
 * - Flash effects (temporarily show a color, then revert to idle)
 * - Debouncing (prevents rapid-fire API calls if states flip quickly)
 */
export class LightOrchestrator {
  private animator = new PulseAnimator();
  private flashRevertTimer: NodeJS.Timeout | null = null;
  private lastAppliedState: VibeState | null = null;
  private applyDebounceTimer: NodeJS.Timeout | null = null;
  private readonly DEBOUNCE_MS = 100;
  private soundPlayer: SoundPlayer | null = null;
  private glowController: ScreenGlowController | null = null;

  // Multi-window coordination — only the owner window controls the bulb
  private static readonly LOCK_FILE = path.join(os.homedir(), '.claude', '.vibesync-owner');

  constructor(
    private controllerRef: ControllerRef,
    private readonly settings: Settings,
    private readonly workspacePath: string = ''
  ) { }

  /** Check if this window owns the bulb (or no lock exists) */
  private isOwner(): boolean {
    try {
      const content = fs.readFileSync(LightOrchestrator.LOCK_FILE, 'utf-8');
      const owner = content.trim().split('\n')[0];
      return owner === this.workspacePath;
    } catch {
      return true; // no lock file = anyone can control
    }
  }

  /** Attach a SoundPlayer — sound will play in sync with light changes */
  setSoundPlayer(player: SoundPlayer): void {
    this.soundPlayer = player;
  }

  /** Attach a ScreenGlowController — glow will update in sync with light changes */
  setScreenGlow(controller: ScreenGlowController): void {
    this.glowController = controller;
  }

  /** Preview a specific sound (used by settings webview "Test" button) */
  previewSound(soundId: string, volume: number): void {
    this.soundPlayer?.play(soundId, volume);
  }

  /** Call this when the TapoController is replaced (e.g. settings changed) */
  updateController(ref: ControllerRef): void {
    this.controllerRef = ref;
    this.lastAppliedState = null; // Force re-apply current state on next call
    this.animator.stop();
  }

  private get controller(): ILightController {
    return this.controllerRef.tapo;
  }

  /**
   * Called by StateMachine on every state change.
   * Debounces rapid transitions (e.g. idle→typing→idle in <100ms).
   */
  applyState(state: VibeState): void {
    if (!this.isOwner()) return; // another window owns the bulb
    if (this.applyDebounceTimer) clearTimeout(this.applyDebounceTimer);
    this.applyDebounceTimer = setTimeout(() => {
      this.applyDebounceTimer = null;
      void this.applyStateImmediate(state);
    }, this.DEBOUNCE_MS);
  }

  /**
   * Runs the full 8-state light demo cycle. Used by the test command.
   */
  async runDemo(): Promise<void> {
    const states: VibeState[] = [
      'idle', 'aiThinking', 'aiGenerating', 'aiNeedsInput', 'aiComplete', 'idle',
    ];

    log('Running light demo...');
    for (const state of states) {
      log(`Demo: applying state "${state}"`);
      await this.applyStateImmediate(state);
      await sleep(2500);
    }
    log('Demo complete.');
  }

  /**
   * Preview a single LightEffect for `durationMs` then revert to current state.
   * Handles static, pulse, and flash correctly.
   */
  async previewEffect(effect: LightEffect, durationMs = 3000): Promise<void> {
    // Stop any current animation
    this.animator.stop();
    if (this.flashRevertTimer) {
      clearTimeout(this.flashRevertTimer);
      this.flashRevertTimer = null;
    }

    try {
      switch (effect.type) {
        case 'static':
          await this.applyStatic(effect);
          break;
        case 'pulse':
        case 'colorCycle':
        case 'colorShift':
          await this.applyStatic(effect);
          this.animator.start(this.controller, effect);
          break;
        case 'flash':
          await this.applyStatic(effect);
          break;
      }
    } catch (err) {
      logError('LightOrchestrator: previewEffect failed', err);
    }

    // Revert after duration
    this.flashRevertTimer = setTimeout(() => {
      this.flashRevertTimer = null;
      this.animator.stop();
      this.lastAppliedState = null; // Force re-apply
      void this.applyStateImmediate(
        this.settings.theme ? 'idle' : 'idle'
      );
    }, durationMs);
  }

  dispose(): void {
    this.animator.stop();
    if (this.flashRevertTimer) clearTimeout(this.flashRevertTimer);
    if (this.applyDebounceTimer) clearTimeout(this.applyDebounceTimer);
    this.soundPlayer?.dispose();
    this.glowController?.disconnect();
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  private async applyStateImmediate(state: VibeState): Promise<void> {
    if (state === this.lastAppliedState) return;
    this.lastAppliedState = state;

    // Clear any pending flash revert
    if (this.flashRevertTimer) {
      clearTimeout(this.flashRevertTimer);
      this.flashRevertTimer = null;
    }

    const theme = resolveTheme(this.settings.theme, this.settings.getCustomThemes());
    const effect = this.getEffect(theme, state);

    log(`LightOrchestrator: applying "${state}" (${effect.type})`);

    try {
      // Stop old animation FIRST (generation counter invalidates in-flight ticks),
      // then apply the new color. This prevents race conditions where a stale
      // tick from the old animation overwrites the new state's color.
      this.animator.stop();
      await this.applyStatic(effect);

      switch (effect.type) {
        case 'pulse':
        case 'colorCycle':
        case 'colorShift':
          this.animator.start(this.controller, effect);
          break;
        case 'flash': {
          const idleEffect = this.getEffect(theme, 'idle');
          this.flashRevertTimer = setTimeout(async () => {
            this.flashRevertTimer = null;
            await this.applyStatic(idleEffect).catch(() => { });
          }, effect.flashDurationMs ?? 2000);
          break;
        }
      }
    } catch (err) {
      logError(`LightOrchestrator: failed to apply state "${state}"`, err);
    }

    // Sound — plays at the exact same moment as light change (coupled for perfect sync)
    if (this.soundPlayer && this.settings.soundEnabled) {
      const pack = resolveSoundPack(this.settings.soundPack, this.settings.getCustomSoundPacks());
      const entry = pack.states[state];
      if (entry?.enabled && entry.soundId !== 'builtin:none') {
        this.soundPlayer.play(entry.soundId, entry.volume);
      }
    }

    // Screen glow — static color, applies at the exact same moment (coupled for sync)
    if (this.glowController?.isConnected() && this.settings.screenGlowEnabled) {
      try {
        if (effect.hue !== undefined && effect.saturation !== undefined) {
          await this.glowController.setColor(effect.hue, effect.saturation, effect.brightness);
        } else if (effect.colorTemp !== undefined) {
          await this.glowController.setColorTemperature(effect.colorTemp, effect.brightness);
        }
      } catch (err) {
        logError('LightOrchestrator: screen glow failed', err);
      }
    }
  }

  private async applyStatic(effect: LightEffect): Promise<void> {
    if (effect.colorTemp !== undefined) {
      await this.controller.setColorTemperature(effect.colorTemp, effect.brightness);
    } else if (effect.hue !== undefined && effect.saturation !== undefined) {
      await this.controller.setColor(effect.hue, effect.saturation, effect.brightness);
    }
  }

  private getEffect(theme: VibeTheme, state: VibeState): LightEffect {
    const map: Record<VibeState, LightEffect> = {
      idle: theme.states.idle,
      userCoding: theme.states.userCoding,
      userPrompting: theme.states.userPrompting,
      aiThinking: theme.states.aiThinking,
      aiGenerating: theme.states.aiGenerating,
      aiWaitingForInput: theme.states.aiWaitingForInput,
      aiNeedsInput: theme.states.aiNeedsInput,
      userAccepted: theme.states.userAccepted,
      userDeclined: theme.states.userDeclined,
      aiComplete: theme.states.aiComplete,
    };
    return map[state] ?? theme.states.idle;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
