import { ILightController } from './ILightController.js';
import { LightEffect } from '../themes/index.js';
import { log, logError } from '../utils/logger.js';

/**
 * General-purpose effect animator for Tapo lights.
 *
 * Handles: pulse, colorCycle, colorShift, strobe, breathe.
 * Static and flash are handled directly by LightOrchestrator (no animation loop).
 *
 * Limitations:
 * - Each Tapo API call has ~50-200ms network latency
 * - We prevent concurrent calls with a `busy` flag
 * - On state change, `stop()` is called before the new effect begins
 */
export class PulseAnimator {
  private timer: NodeJS.Timeout | null = null;
  private phase = 0;
  private busy = false;
  private active = false;
  private generation = 0; // Incremented on each start/stop to invalidate in-flight ticks

  start(controller: ILightController, effect: LightEffect): void {
    this.stop();
    this.active = true;
    this.phase = 0;
    const gen = ++this.generation; // Capture current generation for this animation

    const cycleMs = effect.cycleMs ?? 1600;
    const halfCycle = Math.max(300, cycleMs / 2);
    const hue = effect.hue ?? 0;
    const sat = effect.saturation ?? 100;
    const bri = effect.brightness;
    const minBri = effect.minBrightness ?? 20;
    const hue2 = effect.hue2 ?? ((hue + 180) % 360); // default: complementary color

    const tick = async () => {
      // Generation check: if stop() or a new start() was called, this tick is stale
      if (!this.active || gen !== this.generation) return;
      if (this.busy) {
        this.scheduleNext(halfCycle, tick);
        return;
      }

      this.busy = true;
      try {
        // Re-check generation BEFORE applying color (in case stop() was called while we waited)
        if (gen !== this.generation) return;

        switch (effect.type) {
          case 'pulse': {
            // Alternate brightness between max and min
            const pBri = this.phase === 0 ? bri : minBri;
            this.phase = (this.phase + 1) % 2;
            await controller.setColor(hue, sat, pBri);
            break;
          }

          case 'colorCycle': {
            // Rotate through hue spectrum — step by ~30° each tick
            const stepSize = Math.max(10, Math.round(360 / Math.max(6, cycleMs / halfCycle)));
            const currentHue = (hue + this.phase * stepSize) % 360;
            this.phase = (this.phase + 1) % Math.ceil(360 / stepSize);
            await controller.setColor(currentHue, sat, bri);
            break;
          }

          case 'colorShift': {
            // Alternate between hue and hue2
            const shiftHue = this.phase === 0 ? hue : hue2;
            this.phase = (this.phase + 1) % 2;
            await controller.setColor(shiftHue, sat, bri);
            break;
          }

        }
      } catch (err) {
        logError('EffectAnimator tick failed', err);
      } finally {
        this.busy = false;
      }

      // Final generation check before scheduling next tick
      if (this.active && gen === this.generation) {
        this.scheduleNext(halfCycle, tick);
      }
    };

    log(`EffectAnimator: starting ${effect.type} (${cycleMs}ms cycle)`);
    // Set initial color before the loop
    void controller.setColor(hue, sat, bri).catch(() => { });
    this.scheduleNext(halfCycle, tick);
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.generation++; // Invalidate any in-flight async ticks
    this.active = false;
    this.busy = false;
  }

  get isRunning(): boolean {
    return this.active;
  }

  private scheduleNext(ms: number, tick: () => Promise<void>): void {
    this.timer = setTimeout(() => { void tick(); }, ms);
  }
}
