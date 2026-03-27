import * as vscode from 'vscode';
import { CustomThemeConfig, CustomMascotPackConfig } from '../themes/index.js';
import { CustomSoundPackConfig } from '../sounds/types.js';

export type AiTool =
  | 'github-copilot'
  | 'cursor'
  | 'windsurf'
  | 'antigravity'
  | 'continue'
  | 'claude-code'
  | 'other';

export type LightBrand = 'tapo' | 'yeelight' | 'philips-hue' | 'lifx' | 'govee';

export class Settings {
  private globalState: vscode.Memento | null = null;

  private get config() {
    return vscode.workspace.getConfiguration('vibeSync');
  }

  /** Call once during activation to enable globalState storage */
  setGlobalState(state: vscode.Memento): void {
    this.globalState = state;
  }

  get enabled(): boolean {
    return this.config.get<boolean>('enabled', true);
  }

  get aiTool(): AiTool {
    return this.config.get<AiTool>('aiTool', 'claude-code');
  }

  get lightBrand(): LightBrand {
    return this.config.get<LightBrand>('lightBrand', 'tapo');
  }

  get tapoIp(): string {
    return this.config.get<string>('tapoIp', '');
  }

  get tapoEmail(): string {
    return this.config.get<string>('tapoEmail', '');
  }

  get tapoPassword(): string {
    return this.config.get<string>('tapoPassword', '');
  }

  get theme(): string {
    return this.config.get<string>('theme', 'default');
  }

  // Hardcoded defaults — removed from user-facing settings
  get aiBurstThreshold(): number { return 50; }
  get aiCompleteTimeoutMs(): number { return 5000; }
  get aiWaitingTimeoutMs(): number { return 2500; }
  get idleTimeoutMs(): number { return 10000; }

  isConfigured(): boolean {
    return (
      this.tapoIp.trim() !== '' &&
      this.tapoEmail.trim() !== '' &&
      this.tapoPassword.trim() !== ''
    );
  }

  async toggle(): Promise<void> {
    await this.config.update('enabled', !this.enabled, vscode.ConfigurationTarget.Global);
  }

  onDidChange(callback: () => void): vscode.Disposable {
    return vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('vibeSync')) {
        callback();
      }
    });
  }

  // ─── Custom Theme Storage (globalState) ──────────────────────────────────

  getCustomThemes(): CustomThemeConfig[] {
    if (!this.globalState) return [];
    return this.globalState.get<CustomThemeConfig[]>('vibeSync.customThemes', []);
  }

  async saveCustomThemes(themes: CustomThemeConfig[]): Promise<void> {
    if (!this.globalState) return;
    await this.globalState.update('vibeSync.customThemes', themes);
  }

  async addCustomTheme(theme: CustomThemeConfig): Promise<void> {
    const themes = this.getCustomThemes();
    const idx = themes.findIndex(t => t.id === theme.id);
    if (idx >= 0) {
      themes[idx] = theme; // Update existing
    } else {
      themes.push(theme);
    }
    await this.saveCustomThemes(themes);
  }

  async deleteCustomTheme(id: string): Promise<void> {
    const themes = this.getCustomThemes().filter(t => t.id !== id);
    await this.saveCustomThemes(themes);
    // If the deleted theme was active, switch to default
    if (this.theme === id) {
      await this.config.update('theme', 'default', vscode.ConfigurationTarget.Global);
    }
  }

  // ─── Screen Glow ──────────────────────────────────────────────────────

  get screenGlowEnabled(): boolean {
    return this.config.get<boolean>('screenGlowEnabled', false);
  }

  // ─── Sound Settings ────────────────────────────────────────────────────

  get soundEnabled(): boolean {
    return this.config.get<boolean>('soundEnabled', true);
  }

  get soundPack(): string {
    return this.config.get<string>('soundPack', 'default');
  }

  // ─── Mascot Settings ──────────────────────────────────────────────────

  get mascotEnabled(): boolean {
    return this.config.get<boolean>('mascotEnabled', true);
  }

  get mascotTheme(): string {
    return this.config.get<string>('mascotTheme', 'default');
  }

  // ─── Custom Sound Pack Storage (globalState) ──────────────────────────

  getCustomSoundPacks(): CustomSoundPackConfig[] {
    if (!this.globalState) return [];
    return this.globalState.get<CustomSoundPackConfig[]>('vibeSync.customSoundPacks', []);
  }

  async saveCustomSoundPacks(packs: CustomSoundPackConfig[]): Promise<void> {
    if (!this.globalState) return;
    await this.globalState.update('vibeSync.customSoundPacks', packs);
  }

  async addCustomSoundPack(pack: CustomSoundPackConfig): Promise<void> {
    const packs = this.getCustomSoundPacks();
    const idx = packs.findIndex(p => p.id === pack.id);
    if (idx >= 0) {
      packs[idx] = pack;
    } else {
      packs.push(pack);
    }
    await this.saveCustomSoundPacks(packs);
  }

  async deleteCustomSoundPack(id: string): Promise<void> {
    const packs = this.getCustomSoundPacks().filter(p => p.id !== id);
    await this.saveCustomSoundPacks(packs);
    if (this.soundPack === id) {
      await this.config.update('soundPack', 'default', vscode.ConfigurationTarget.Global);
    }
  }

  // ─── Custom Mascot Pack Storage (globalState) ──────────────────────────

  getCustomMascotPacks(): CustomMascotPackConfig[] {
    if (!this.globalState) return [];
    return this.globalState.get<CustomMascotPackConfig[]>('vibeSync.customMascotPacks', []);
  }

  async saveCustomMascotPacks(packs: CustomMascotPackConfig[]): Promise<void> {
    if (!this.globalState) return;
    await this.globalState.update('vibeSync.customMascotPacks', packs);
  }

  async addCustomMascotPack(pack: CustomMascotPackConfig): Promise<void> {
    const packs = this.getCustomMascotPacks();
    const idx = packs.findIndex(p => p.id === pack.id);
    if (idx >= 0) {
      packs[idx] = pack;
    } else {
      packs.push(pack);
    }
    await this.saveCustomMascotPacks(packs);
  }

  async deleteCustomMascotPack(id: string): Promise<void> {
    const packs = this.getCustomMascotPacks().filter(p => p.id !== id);
    await this.saveCustomMascotPacks(packs);
    if (this.mascotTheme === id) {
      await this.config.update('mascotTheme', 'default', vscode.ConfigurationTarget.Global);
    }
  }
}
