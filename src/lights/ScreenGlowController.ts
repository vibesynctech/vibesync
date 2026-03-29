import * as vscode from 'vscode';
import { ILightController } from './ILightController.js';

/**
 * Software alternative to physical RGB lights.
 * Changes VS Code's status bar and border colors based on AI state.
 * Implements ILightController so it can be driven by LightOrchestrator.
 */
export class ScreenGlowController implements ILightController {
  private connected = false;
  private originalColors: Record<string, string> = {};

  /** The keys we manage — used for cleanup */
  private static readonly GLOW_KEYS = [
    'statusBar.background',
    'statusBar.foreground',
    'activityBar.activeBorder',
    'focusBorder',
    'editorGroup.border',
    'sideBar.border',
    'panel.border',
  ];

  async connect(): Promise<void> {
    const config = vscode.workspace.getConfiguration('workbench');
    const current = config.get<Record<string, string>>('colorCustomizations') || {};
    // Save only the keys we'll overwrite, so restore is precise
    this.originalColors = {};
    for (const key of ScreenGlowController.GLOW_KEYS) {
      if (key in current) {
        this.originalColors[key] = current[key];
      }
    }
    this.connected = true;
  }

  async setColor(hue: number, saturation: number, brightness: number): Promise<void> {
    if (!this.connected) return;
    const hex = hslToHex(hue, saturation, brightness);
    const dimHex = hslToHex(hue, saturation, Math.max(10, brightness * 0.3));
    await this.applyGlow(hex, dimHex);
  }

  async setColorTemperature(kelvin: number, brightness?: number): Promise<void> {
    if (!this.connected) return;
    const hue = 30 + ((kelvin - 2500) / 4000) * 180;
    const bri = brightness ?? 50;
    await this.setColor(hue, 20, bri);
  }

  async setBrightness(_brightness: number): Promise<void> {
    // No-op — brightness is handled in setColor
  }

  async setPower(on: boolean): Promise<void> {
    if (!on) await this.clearGlow();
  }

  isConnected(): boolean {
    return this.connected;
  }

  disconnect(): void {
    void this.clearGlow();
    this.connected = false;
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  private async applyGlow(primaryHex: string, dimHex: string): Promise<void> {
    const config = vscode.workspace.getConfiguration('workbench');
    const existing = config.get<Record<string, string>>('colorCustomizations') || {};
    const merged = {
      ...existing,
      'statusBar.background': primaryHex,
      'statusBar.foreground': '#ffffff',
      'activityBar.activeBorder': primaryHex,
      'focusBorder': primaryHex,
      'editorGroup.border': dimHex,
      'sideBar.border': dimHex,
      'panel.border': dimHex,
    };
    // Try workspace-level first (scoped to this window), fall back to global
    try {
      await config.update('colorCustomizations', merged, vscode.ConfigurationTarget.Workspace);
    } catch {
      try {
        await config.update('colorCustomizations', merged, vscode.ConfigurationTarget.Global);
      } catch { /* glow not supported in this editor */ }
    }
  }

  private async clearGlow(): Promise<void> {
    const config = vscode.workspace.getConfiguration('workbench');
    const current = config.get<Record<string, string>>('colorCustomizations') || {};
    const restored = { ...current };

    for (const key of ScreenGlowController.GLOW_KEYS) {
      if (key in this.originalColors) {
        restored[key] = this.originalColors[key];
      } else {
        delete restored[key];
      }
    }

    // If restored is empty, set to undefined to remove the key entirely
    const hasKeys = Object.keys(restored).length > 0;
    const value = hasKeys ? restored : undefined;
    try {
      await config.update('colorCustomizations', value, vscode.ConfigurationTarget.Workspace);
    } catch {
      try {
        await config.update('colorCustomizations', value, vscode.ConfigurationTarget.Global);
      } catch { /* ignore */ }
    }
  }
}

// ─── HSL → Hex conversion ────────────────────────────────────────────────────

function hslToHex(h: number, s: number, brightness: number): string {
  // Map brightness (10-100) to lightness (15-60) — never full white
  const l = 15 + (brightness / 100) * 45;
  const sat = s / 100;
  const light = l / 100;

  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = light - c / 2;

  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }

  const toHex = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}
