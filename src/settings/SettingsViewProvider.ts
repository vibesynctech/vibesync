import * as vscode from 'vscode';
import { CustomThemeConfig, LightEffect, getBuiltinThemeInfos, BUILTIN_MASCOT_PACKS, CustomMascotPackConfig } from '../themes/index.js';
import { CustomSoundPackConfig, BUILTIN_SOUNDS, BUILTIN_SOUND_PACKS } from '../sounds/types.js';
import { Settings } from '../config/Settings.js';

const AI_TOOLS = [
  { id: 'claude-code', label: 'Claude Code', icon: 'λ', disabled: false },
  { id: 'github-copilot', label: 'GitHub Copilot', icon: '◎', disabled: true },
  { id: 'cursor', label: 'Cursor', icon: '▲', disabled: true },
  { id: 'windsurf', label: 'Windsurf', icon: '≋', disabled: true },
  { id: 'antigravity', label: 'Antigravity', icon: '◇', disabled: true },
  { id: 'other', label: 'Other', icon: '…', disabled: true },
];

const LIGHT_BRANDS = [
  { id: 'tapo', label: 'TP-Link Tapo' },
  { id: 'yeelight', label: 'Yeelight (coming soon)' },
  { id: 'philips-hue', label: 'Philips Hue (coming soon)' },
  { id: 'lifx', label: 'LIFX (coming soon)' },
  { id: 'govee', label: 'Govee (coming soon)' },
];

const STATE_LABELS = [
  { key: 'idle', label: 'Idle', desc: 'Nothing happening' },
  { key: 'thinking', label: 'Thinking', desc: 'AI is reasoning' },
  { key: 'editing', label: 'Editing', desc: 'AI is writing code' },
  { key: 'waitingForInput', label: 'Waiting for Input', desc: 'AI needs your attention' },
  { key: 'completion', label: 'Completion', desc: 'AI finished the task' },
];

/**
 * Opens a settings webview panel in an editor tab.
 * Reads/writes from vscode.workspace.getConfiguration('vibeSync').
 */
export class SettingsViewProvider {
  private panel: vscode.WebviewPanel | null = null;

  constructor(
    private readonly testConnectionFn: (ip: string, email: string, password: string, hue: number, sat: number) => Promise<boolean>,
    private readonly previewEffectFn: (effect: LightEffect) => Promise<void>,
    private readonly previewSoundFn: (soundId: string, volume: number) => Promise<void>,
    private readonly settings: Settings,
    private readonly globalStorageUri: vscode.Uri,
  ) { }

  show(): void {
    if (this.panel) {
      this.panel.reveal();
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      'vibeSync.settings',
      'VibeSync — Settings',
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true },
    );

    this.panel.webview.html = this.buildHtml();

    this.panel.webview.onDidReceiveMessage(async (msg) => {
      if (msg.type === 'openGuide') {
        vscode.commands.executeCommand('vibeSync.openGuide');
        return;
      } else if (msg.type === 'updateSetting') {
        const config = vscode.workspace.getConfiguration('vibeSync');
        await config.update(msg.key, msg.value, vscode.ConfigurationTarget.Global);
      } else if (msg.type === 'testConnection') {
        let ok = false;
        try {
          ok = await this.testConnectionFn(msg.ip, msg.email, msg.password, msg.hue, msg.sat);
        } catch {
          ok = false;
        }
        if (this.panel) {
          void this.panel.webview.postMessage({ type: 'connectionResult', success: ok });
        }
      } else if (msg.type === 'testGlow') {
        let ok = false;
        try {
          const { ScreenGlowController } = await import('../lights/ScreenGlowController.js');
          const testGlow = new ScreenGlowController();
          await testGlow.connect();
          // Flash a bright blue glow for 3 seconds, then revert
          await testGlow.setColor(220, 90, 80);
          ok = true;
          setTimeout(() => { testGlow.disconnect(); }, 3000);
        } catch { ok = false; }
        if (this.panel) {
          void this.panel.webview.postMessage({ type: 'glowTestResult', success: ok });
        }
      } else if (msg.type === 'resetGlow') {
        try {
          const { ScreenGlowController } = await import('../lights/ScreenGlowController.js');
          await ScreenGlowController.resetAllGlow();
        } catch { /* ignore */ }
        if (this.panel) {
          void this.panel.webview.postMessage({ type: 'glowResetResult' });
        }
      } else if (msg.type === 'saveCustomTheme') {
        await this.settings.addCustomTheme(msg.theme as CustomThemeConfig);
        // Activate the saved theme
        const config = vscode.workspace.getConfiguration('vibeSync');
        await config.update('theme', msg.theme.id, vscode.ConfigurationTarget.Global);
        this.sendCustomThemes();
      } else if (msg.type === 'deleteCustomTheme') {
        await this.settings.deleteCustomTheme(msg.id);
        this.sendCustomThemes();
      } else if (msg.type === 'previewEffect') {
        try {
          await this.previewEffectFn(msg.effect as LightEffect);
        } catch { /* ignore */ }
      } else if (msg.type === 'getCustomThemes') {
        this.sendCustomThemes();
      } else if (msg.type === 'saveSoundPack') {
        await this.settings.addCustomSoundPack(msg.pack as CustomSoundPackConfig);
        const config = vscode.workspace.getConfiguration('vibeSync');
        await config.update('soundPack', msg.pack.id, vscode.ConfigurationTarget.Global);
        this.sendSoundPacks();
      } else if (msg.type === 'deleteSoundPack') {
        await this.settings.deleteCustomSoundPack(msg.id);
        this.sendSoundPacks();
      } else if (msg.type === 'previewSound') {
        try {
          await this.previewSoundFn(msg.soundId, msg.volume);
        } catch { /* ignore */ }
      } else if (msg.type === 'getSoundPacks') {
        this.sendSoundPacks();
      } else if (msg.type === 'uploadSound') {
        try {
          const data = Buffer.from(msg.data, 'base64');
          const safeName = msg.name.replace(/[^a-zA-Z0-9._-]/g, '_');
          const fileUri = vscode.Uri.joinPath(this.globalStorageUri, 'sounds', safeName);
          await vscode.workspace.fs.writeFile(fileUri, data);
          if (this.panel) {
            void this.panel.webview.postMessage({
              type: 'soundUploaded',
              soundId: `custom:${safeName}`,
              label: safeName,
            });
          }
        } catch { /* ignore */ }
      } else if (msg.type === 'saveMascotPack') {
        await this.settings.addCustomMascotPack(msg.pack as CustomMascotPackConfig);
        const config = vscode.workspace.getConfiguration('vibeSync');
        await config.update('mascotTheme', msg.pack.id, vscode.ConfigurationTarget.Global);
        this.sendMascotPacks();
      } else if (msg.type === 'deleteMascotPack') {
        // Delete the animation files from globalStorage
        try {
          const packDir = vscode.Uri.joinPath(this.globalStorageUri, 'mascotPacks', msg.id);
          await vscode.workspace.fs.delete(packDir, { recursive: true });
        } catch { /* ignore if dir doesn't exist */ }
        await this.settings.deleteCustomMascotPack(msg.id);
        this.sendMascotPacks();
      } else if (msg.type === 'getMascotPacks') {
        this.sendMascotPacks();
      } else if (msg.type === 'uploadMascotAnim') {
        try {
          const data = Buffer.from(msg.data, 'base64');
          // Validate it's a Lottie JSON
          const jsonStr = data.toString('utf-8');
          const parsed = JSON.parse(jsonStr);
          if (!parsed.v || !parsed.fr || parsed.ip === undefined || parsed.op === undefined) {
            if (this.panel) {
              void this.panel.webview.postMessage({ type: 'mascotAnimError', state: msg.state, error: 'Invalid Lottie JSON — missing required fields (v, fr, ip, op)' });
            }
            return;
          }
          const packId = msg.packId;
          const state = msg.state; // 'thinking' | 'needsInput' | 'complete'
          const fileUri = vscode.Uri.joinPath(this.globalStorageUri, 'mascotPacks', packId, `${state}.json`);
          await vscode.workspace.fs.writeFile(fileUri, data);
          if (this.panel) {
            void this.panel.webview.postMessage({ type: 'mascotAnimUploaded', state, packId });
          }
        } catch {
          if (this.panel) {
            void this.panel.webview.postMessage({ type: 'mascotAnimError', state: msg.state, error: 'Invalid JSON file' });
          }
        }
      }
    });

    this.panel.onDidDispose(() => { this.panel = null; });
  }

  private sendMascotPacks(): void {
    if (!this.panel) return;
    void this.panel.webview.postMessage({
      type: 'mascotPacks',
      packs: this.settings.getCustomMascotPacks(),
    });
  }

  private sendCustomThemes(): void {
    if (!this.panel) return;
    void this.panel.webview.postMessage({
      type: 'customThemes',
      themes: this.settings.getCustomThemes(),
    });
  }

  private sendSoundPacks(): void {
    if (!this.panel) return;
    void this.panel.webview.postMessage({
      type: 'soundPacks',
      packs: this.settings.getCustomSoundPacks(),
    });
  }

  private getConfig() {
    return vscode.workspace.getConfiguration('vibeSync');
  }

  private buildHtml(): string {
    const cfg = this.getConfig();
    const enabled = cfg.get<boolean>('enabled', true);
    const aiTool = cfg.get<string>('aiTool', 'claude-code');
    const lightBrand = cfg.get<string>('lightBrand', 'tapo');
    const tapoIp = cfg.get<string>('tapoIp', '');
    const tapoEmail = cfg.get<string>('tapoEmail', '');
    const tapoPassword = cfg.get<string>('tapoPassword', '');
    const activeTheme = cfg.get<string>('theme', 'default');
    const customThemes = this.settings.getCustomThemes();
    const screenGlowEnabled = cfg.get<boolean>('screenGlowEnabled', false);
    const soundEnabled = cfg.get<boolean>('soundEnabled', true);
    const activeSoundPack = cfg.get<string>('soundPack', 'default');
    const customSoundPacks = this.settings.getCustomSoundPacks();
    const mascotEnabled = cfg.get<boolean>('mascotEnabled', true);
    const activeMascotPack = cfg.get<string>('mascotTheme', 'default');
    const customMascotPacks = this.settings.getCustomMascotPacks();

    // Build AI tool pills
    const aiPills = AI_TOOLS.map(t =>
      t.disabled
        ? `<button class="pill pill-disabled" title="Coming Soon">
            <span class="pill-icon">${t.icon}</span> ${t.label}
          </button>`
        : `<button class="pill ${t.id === aiTool ? 'active' : ''}" onclick="setSetting('aiTool','${t.id}')">
            <span class="pill-icon">${t.icon}</span> ${t.label}
          </button>`
    ).join('\n');

    // Build light brand options
    const brandOptions = LIGHT_BRANDS.map(b =>
      `<option value="${b.id}" ${b.id === lightBrand ? 'selected' : ''}>${b.label}</option>`
    ).join('');

    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    // Serialize data for JS
    const customThemesJson = JSON.stringify(customThemes).replace(/</g, '\\u003c');
    const customSoundPacksJson = JSON.stringify(customSoundPacks).replace(/</g, '\\u003c');
    const builtinSoundsJson = JSON.stringify(BUILTIN_SOUNDS).replace(/</g, '\\u003c');
    const builtinThemesJson = JSON.stringify(getBuiltinThemeInfos()).replace(/</g, '\\u003c');
    const builtinSoundPacksJson = JSON.stringify(BUILTIN_SOUND_PACKS).replace(/</g, '\\u003c');
    const builtinMascotPacksJson = JSON.stringify(BUILTIN_MASCOT_PACKS).replace(/</g, '\\u003c');
    const customMascotPacksJson = JSON.stringify(customMascotPacks).replace(/</g, '\\u003c');

    return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: var(--vscode-font-family, -apple-system, system-ui, sans-serif);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    padding: 32px 24px 48px;
    max-width: 620px;
    margin: 0 auto;
    line-height: 1.5;
  }

  /* ── Header ── */
  .header { margin-bottom: 28px; }
  .header h1 { font-size: 22px; font-weight: 700; letter-spacing: -0.3px; margin-bottom: 6px; }
  .header-line { height: 2px; width: 48px; border-radius: 1px; background: linear-gradient(90deg, #4ec94e, #007acc); }

  /* ── Cards ── */
  .card {
    background: rgba(255, 255, 255, 0.025);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 12px;
    padding: 22px;
    margin-bottom: 16px;
    transition: border-color 0.2s;
  }
  .card:hover { border-color: rgba(255, 255, 255, 0.1); }
  .card-title {
    font-size: 10px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 1.8px; opacity: 0.4; margin-bottom: 18px;
  }

  /* ── Form rows ── */
  .row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
  .row:last-child { margin-bottom: 0; }
  .row-label { font-size: 12px; font-weight: 500; opacity: 0.8; flex-shrink: 0; }
  .row-2col { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 14px; }

  /* ── Inputs ── */
  .input-group { display: flex; flex-direction: column; gap: 3px; }
  .input-label { font-size: 9px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.8px; opacity: 0.35; }
  .input, .select {
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 6px; padding: 8px 12px;
    color: var(--vscode-foreground);
    font-family: var(--vscode-editor-font-family, 'Menlo', monospace);
    font-size: 12px; width: 100%; transition: border-color 0.15s; outline: none;
  }
  .input:focus, .select:focus { border-color: var(--vscode-focusBorder, #007fd4); }
  .select {
    cursor: pointer; appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23888' d='M3 5l3 3 3-3'/%3E%3C/svg%3E");
    background-repeat: no-repeat; background-position: right 10px center; padding-right: 28px;
  }
  .pw-wrapper { position: relative; }
  .pw-wrapper .input { padding-right: 36px; }
  .pw-toggle {
    position: absolute; right: 8px; top: 50%; transform: translateY(-50%);
    background: none; border: none; color: var(--vscode-foreground);
    opacity: 0.3; cursor: pointer; font-size: 13px; padding: 2px; transition: opacity 0.15s;
  }
  .pw-toggle:hover { opacity: 0.7; }

  /* ── Toggle switch ── */
  .toggle { position: relative; width: 38px; height: 20px; flex-shrink: 0; }
  .toggle input { opacity: 0; width: 0; height: 0; position: absolute; }
  .toggle-track {
    position: absolute; inset: 0; background: rgba(255, 255, 255, 0.08);
    border-radius: 10px; cursor: pointer; transition: background 0.2s;
  }
  .toggle input:checked + .toggle-track { background: #4ec94e; }
  .toggle-thumb {
    position: absolute; top: 2px; left: 2px; width: 16px; height: 16px;
    background: #fff; border-radius: 50%; box-shadow: 0 1px 3px rgba(0,0,0,0.3);
    transition: transform 0.2s; pointer-events: none;
  }
  .toggle input:checked ~ .toggle-thumb { transform: translateX(18px); }

  /* ── Test Connection ── */
  .test-row { display: flex; align-items: center; gap: 10px; margin-top: 10px; }
  .color-pick {
    width: 36px; height: 36px; border: none; border-radius: 8px;
    cursor: pointer; background: none; padding: 0; flex-shrink: 0;
  }
  .color-pick::-webkit-color-swatch-wrapper { padding: 0; }
  .color-pick::-webkit-color-swatch { border: 2px solid rgba(255,255,255,0.12); border-radius: 6px; }
  .test-btn, .btn {
    display: flex; align-items: center; justify-content: center; gap: 6px;
    padding: 9px 16px;
    background: rgba(78, 201, 78, 0.1); border: 1px solid rgba(78, 201, 78, 0.25);
    color: #4ec94e; font-size: 11px; font-weight: 600; border-radius: 6px;
    cursor: pointer; transition: all 0.15s;
  }
  .test-btn { flex: 1; }
  .test-btn:hover, .btn:hover { background: rgba(78, 201, 78, 0.18); border-color: rgba(78, 201, 78, 0.4); }
  .test-btn:disabled, .btn:disabled { opacity: 0.4; cursor: default; }
  .btn-blue { background: rgba(0,122,204,0.1); border-color: rgba(0,122,204,0.3); color: #3dacff; }
  .btn-blue:hover { background: rgba(0,122,204,0.18); border-color: rgba(0,122,204,0.5); }
  .btn-red { background: rgba(255,80,80,0.1); border-color: rgba(255,80,80,0.25); color: #ff5050; }
  .btn-red:hover { background: rgba(255,80,80,0.18); border-color: rgba(255,80,80,0.4); }
  .btn-sm { padding: 5px 10px; font-size: 10px; }
  .test-hint { font-size: 9px; opacity: 0.3; margin-top: 6px; text-align: center; font-style: italic; }
  .test-result {
    text-align: center; font-size: 11px; margin-top: 8px; padding: 6px; border-radius: 6px; display: none;
  }
  .test-result.success { display: block; background: rgba(78, 201, 78, 0.08); color: #4ec94e; }
  .test-result.fail { display: block; background: rgba(255, 80, 80, 0.08); color: #ff5050; }

  /* ── AI Tool pills ── */
  .pill-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
  .pill {
    display: flex; align-items: center; justify-content: center; gap: 5px;
    padding: 9px 6px; background: rgba(255, 255, 255, 0.02);
    border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 20px;
    color: var(--vscode-foreground); font-size: 10.5px; font-weight: 500;
    cursor: pointer; transition: all 0.15s; opacity: 0.55;
  }
  .pill:hover { opacity: 0.8; background: rgba(255, 255, 255, 0.04); }
  .pill.active {
    opacity: 1; background: rgba(0, 122, 204, 0.1);
    border-color: rgba(0, 122, 204, 0.5); color: #3dacff; font-weight: 700;
  }
  .pill-icon { font-size: 13px; }
  .pill.pill-disabled { opacity: 0.25; cursor: not-allowed; pointer-events: none; }

  /* ── Theme selector ── */
  .theme-pills { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
  .theme-pill {
    padding: 7px 14px; border-radius: 20px; font-size: 11px; font-weight: 600;
    cursor: pointer; transition: all 0.15s;
    background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08);
    color: var(--vscode-foreground); opacity: 0.6;
  }
  .theme-pill:hover { opacity: 0.85; background: rgba(255,255,255,0.06); }
  .theme-pill.active {
    opacity: 1; background: rgba(78,201,78,0.1);
    border-color: rgba(78,201,78,0.5); color: #4ec94e;
  }
  .theme-pill.create {
    border-style: dashed; border-color: rgba(0,122,204,0.4); color: #3dacff; opacity: 0.7;
  }
  .theme-pill.create:hover { opacity: 1; background: rgba(0,122,204,0.08); }
  .theme-pill-wrap {
    display: flex; align-items: center; gap: 0; position: relative;
  }
  .theme-pill-wrap .theme-pill { border-radius: 20px 0 0 20px; padding-right: 10px; }
  .edit-btn {
    padding: 7px 10px; border-radius: 0 20px 20px 0; font-size: 11px;
    cursor: pointer; transition: all 0.15s;
    background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08);
    border-left: none; color: var(--vscode-foreground); opacity: 0.35;
  }
  .edit-btn:hover { opacity: 0.8; background: rgba(0,122,204,0.12); color: #3dacff; }
  .pill-colors { display: inline-flex; gap: 3px; margin-left: 6px; vertical-align: middle; }
  .pill-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; border: 1px solid rgba(255,255,255,0.15); }

  /* ── Notes section ── */
  .notes-card { opacity: 0.7; font-size: 11.5px; line-height: 1.6; }
  .notes-card p { margin: 6px 0; }
  .notes-card ul { margin: 8px 0; padding-left: 18px; }
  .notes-card li { margin: 6px 0; }
  .notes-card a { color: #3dacff; text-decoration: none; }
  .notes-card a:hover { text-decoration: underline; }

  /* ── Theme Builder ── */
  .builder { display: none; margin-top: 16px; }
  .builder.visible { display: block; }
  .builder-header { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; }
  .builder-header .input { flex: 1; font-size: 14px; font-weight: 600; }
  .builder-actions { display: flex; gap: 8px; margin-top: 16px; }

  /* ── State Card ── */
  .state-card {
    background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06);
    border-radius: 10px; padding: 16px; margin-bottom: 10px;
  }
  .state-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
  .state-label { font-size: 12px; font-weight: 700; }
  .state-desc { font-size: 9px; opacity: 0.35; }
  .state-preview-dot {
    width: 20px; height: 20px; border-radius: 50%;
    border: 2px solid rgba(255,255,255,0.1); flex-shrink: 0;
  }
  .state-controls { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .state-controls .full-width { grid-column: 1 / -1; }

  /* ── Sliders ── */
  .slider-group { display: flex; flex-direction: column; gap: 2px; }
  .slider-label {
    display: flex; justify-content: space-between; align-items: center;
    font-size: 9px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.6px; opacity: 0.35;
  }
  .slider-value { font-family: var(--vscode-editor-font-family, monospace); opacity: 0.7; }
  input[type="range"] {
    -webkit-appearance: none; width: 100%; height: 4px; border-radius: 2px;
    background: rgba(255,255,255,0.08); outline: none; margin: 4px 0;
  }
  input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none; width: 14px; height: 14px; border-radius: 50%;
    background: #fff; cursor: pointer; box-shadow: 0 1px 4px rgba(0,0,0,0.3);
  }
  .hue-slider { background: linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00) !important; }


</style>
</head>
<body>
  <div class="header">
    <h1>Settings</h1>
    <div class="header-line"></div>
  </div>

  <p style="font-size:11px;opacity:0.5;margin-bottom:16px">New here? Check out the <a href="#" onclick="vscode.postMessage({type:'openGuide'})" style="color:#3dacff;text-decoration:none">Guide</a> to get started.</p>

  <!-- Light Setup -->
  <div class="card">
    <div class="card-title">Light Setup</div>
    <div class="row">
      <span class="row-label">Enabled</span>
      <label class="toggle">
        <input type="checkbox" ${enabled ? 'checked' : ''} onchange="setSetting('enabled', this.checked)">
        <span class="toggle-track"></span>
        <span class="toggle-thumb"></span>
      </label>
    </div>
    <div class="row-2col">
      <div class="input-group">
        <span class="input-label">Light Brand</span>
        <select class="select" onchange="setSetting('lightBrand', this.value)">${brandOptions}</select>
      </div>
      <div class="input-group">
        <span class="input-label">Device IP <span title="Open the Tapo app → your light → Device Info → IP Address" style="cursor:help;opacity:0.5">ℹ️</span></span>
        <input class="input" type="text" value="${esc(tapoIp)}" placeholder="192.168.1.87"
               onchange="setSetting('tapoIp', this.value)">
      </div>
    </div>
    <div class="row-2col">
      <div class="input-group">
        <span class="input-label">Tapo Email</span>
        <input class="input" type="text" value="${esc(tapoEmail)}" placeholder="email@example.com"
               onchange="setSetting('tapoEmail', this.value)">
      </div>
      <div class="input-group">
        <span class="input-label">Tapo Password</span>
        <div class="pw-wrapper">
          <input class="input" id="pwInput" type="password" value="${esc(tapoPassword)}" placeholder="••••••••"
                 onchange="setSetting('tapoPassword', this.value)">
          <button class="pw-toggle" onclick="togglePw()" title="Show/hide password">&#128065;</button>
        </div>
      </div>
    </div>
    <div class="test-row">
      <input type="color" class="color-pick" id="colorPick" value="#7c3aed" title="Pick a color to send to your light">
      <button class="test-btn" id="testBtn" onclick="testConnection()">Test Connection</button>
    </div>
    <div class="test-hint">Pick a color and click test — if your light changes, you're connected!</div>
    <div class="test-result" id="testResult"></div>
  </div>

  <!-- Screen Glow -->
  <div class="card">
    <div class="card-title">Screen Glow</div>
    <div class="row">
      <span class="row-label">Enable Screen Glow</span>
      <label class="toggle">
        <input type="checkbox" id="screenGlowToggle" onchange="setSetting('screenGlowEnabled', this.checked)" ${screenGlowEnabled ? 'checked' : ''}>
        <span class="toggle-track"></span>
        <span class="toggle-thumb"></span>
      </label>
    </div>
    <div style="margin-top:10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <button class="btn" onclick="testGlow()" id="testGlowBtn" style="font-size:11px;padding:6px 14px">⚡ Test Glow</button>
      <button class="btn" onclick="resetGlow()" id="resetGlowBtn" style="font-size:11px;padding:6px 14px;opacity:0.7">🔄 Reset Colors</button>
      <span id="glowTestResult" style="font-size:10px;opacity:0.6"></span>
    </div>
    <div style="font-size:10px;opacity:0.4;margin-top:8px">
      Changes VS Code's status bar and border colors based on AI state.<br>
      Works without physical RGB lights. Uses the same theme colors as your light.
    </div>
  </div>

  <!-- AI Tool -->
  <div class="card">
    <div class="card-title">AI Tool</div>
    <div class="pill-grid">${aiPills}</div>
  </div>

  <!-- Theme -->
  <div class="card" id="themeCard">
    <div class="card-title">Theme</div>
    <div class="theme-pills" id="themePills"></div>

    <!-- Theme Builder (hidden until create/edit) -->
    <div class="builder" id="themeBuilder">
      <div class="builder-header">
        <input class="input" id="themeName" type="text" placeholder="My Custom Theme" value="">
      </div>

      <div id="stateCards"></div>

      <div class="builder-actions">
        <button class="btn btn-blue" style="flex:1" onclick="saveTheme()">Save Theme</button>
        <button class="btn btn-red" id="deleteThemeBtn" style="display:none" onclick="deleteTheme()">Delete</button>
        <button class="btn" style="opacity:0.5" onclick="cancelBuilder()">Cancel</button>
      </div>
    </div>
  </div>

  <!-- Sound Alerts -->
  <div class="card" id="soundCard">
    <div class="card-title">Sound Alerts</div>
    <div class="row">
      <span class="row-label">Sound Enabled</span>
      <label class="toggle">
        <input type="checkbox" ${soundEnabled ? 'checked' : ''} onchange="setSetting('soundEnabled', this.checked)">
        <span class="toggle-track"></span>
        <span class="toggle-thumb"></span>
      </label>
    </div>

    <div class="theme-pills" id="soundPackPills" style="margin-top:14px"></div>

    <!-- Sound Pack Builder (hidden until create/edit) -->
    <div class="builder" id="soundBuilder">
      <div class="builder-header">
        <input class="input" id="soundPackName" type="text" placeholder="My Sound Pack" value="">
      </div>

      <div id="soundStateCards"></div>

      <div class="builder-actions">
        <button class="btn btn-blue" style="flex:1" onclick="saveSoundPack()">Save Sound Pack</button>
        <button class="btn btn-red" id="deleteSoundPackBtn" style="display:none" onclick="deleteSoundPack()">Delete</button>
        <button class="btn" style="opacity:0.5" onclick="cancelSoundBuilder()">Cancel</button>
      </div>
    </div>
  </div>

  <!-- Mascot Animations -->
  <div class="card" id="mascotCard">
    <div class="card-title">Mascot Animations</div>
    <div class="row">
      <span class="row-label">Mascot Enabled</span>
      <label class="toggle">
        <input type="checkbox" ${mascotEnabled ? 'checked' : ''} onchange="setSetting('mascotEnabled', this.checked)">
        <span class="toggle-track"></span>
        <span class="toggle-thumb"></span>
      </label>
    </div>

    <div class="theme-pills" id="mascotPackPills" style="margin-top:14px"></div>

    <!-- Mascot Pack Builder (hidden until create/edit) -->
    <div class="builder" id="mascotBuilder">
      <div class="builder-header">
        <input class="input" id="mascotPackName" type="text" placeholder="My Animation Pack" value="">
      </div>

      <div id="mascotUploadCards"></div>
      <div id="mascotUploadStatus" style="font-size:11px;margin-top:8px;opacity:0.7"></div>

      <div class="builder-actions">
        <button class="btn btn-blue" style="flex:1" onclick="saveMascotPack()">Save Pack</button>
        <button class="btn btn-red" id="deleteMascotPackBtn" style="display:none" onclick="deleteMascotPack()">Delete</button>
        <button class="btn" style="opacity:0.5" onclick="cancelMascotBuilder()">Cancel</button>
      </div>
    </div>
  </div>

  <!-- Notes -->
  <div class="card notes-card">
    <div class="card-title">Notes</div>
    <p>Hello! Below are some details about the extension, please keep them in mind.</p>
    <p>This is an <strong>open-source project</strong> and anyone can build upon it as they see fit. If you run into any inconsistencies or bugs, feel free to check out the project's GitHub and contribute: <a href="https://github.com/vibesynctech/vibesync">github.com/vibesynctech/vibesync</a></p>
    <ul>
      <li><strong>Light sync</strong> currently only works with <strong>TP-Link Tapo</strong> lights (tested on <strong>Tapo L900-5</strong>). Support for other brands like Philips Hue, LIFX, etc. is coming soon — it might already work if they follow a similar structure as Tapo.</li>
      <li><strong>Lighting sync is not 100% accurate</strong> with Claude Code. I tried my best, but sometimes the complete state may show even when Claude is still thinking, or other minor inconsistencies may occur. Also, the complete state takes a few seconds to reflect even after the AI has finished its work.</li>
      <li><strong>AI tool support</strong> currently only works with <strong>Claude Code</strong>. I'll try my best to add support for other tools like Cursor, Antigravity, GitHub Copilot, etc. if there is demand for it.</li>
    </ul>
    <p style="margin-top:12px">If you like this project and want to <strong>connect / hire / work on projects</strong> with me, you can reach out at: <a href="mailto:himmu1144@gmail.com">himmu1144@gmail.com</a></p>
    <p style="opacity:0.4;margin-top:8px;font-size:10px">Thank you for your time.</p>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    var activeThemeId = ${JSON.stringify(activeTheme)};
    var customThemes = ${customThemesJson};
    var builtinThemes = ${builtinThemesJson};
    var editingTheme = null; // CustomThemeConfig being edited, or null
    var builderOpen = false;

    // Sound pack state
    var activeSoundPackId = ${JSON.stringify(activeSoundPack)};
    var customSoundPacks = ${customSoundPacksJson};
    var builtinSounds = ${builtinSoundsJson};
    var builtinSoundPacks = ${builtinSoundPacksJson};
    var editingSoundPack = null;
    var soundBuilderOpen = false;
    var uploadedCustomSounds = []; // { soundId, label } added during this session

    // Mascot pack state
    var activeMascotPackId = ${JSON.stringify(activeMascotPack)};
    var customMascotPacks = ${customMascotPacksJson};
    var builtinMascotPacks = ${builtinMascotPacksJson};
    var editingMascotPack = null;
    var mascotBuilderOpen = false;
    var mascotUploadState = { thinking: false, needsInput: false, complete: false };

    // ─── Default state effects (matches Vibe Classic theme) ─────────
    var defaultStates = {
      idle:            { type: 'static', hue: 185, saturation: 100, brightness: 76 },
      thinking:        { type: 'pulse', hue: 39, saturation: 100, brightness: 90, minBrightness: 19, cycleMs: 800 },
      editing:         { type: 'flash', hue: 280, saturation: 100, brightness: 100, flashDurationMs: 2000 },
      waitingForInput: { type: 'pulse', hue: 359, saturation: 100, brightness: 100, minBrightness: 19, cycleMs: 500 },
      completion:      { type: 'pulse', hue: 120, saturation: 100, brightness: 100, minBrightness: 40, cycleMs: 1200 },
    };

    var stateLabels = ${JSON.stringify(STATE_LABELS)};

    // ─── Settings ───────────────────────────────────────────────────
    function setSetting(key, value) {
      vscode.postMessage({ type: 'updateSetting', key: key, value: value });
      if (key === 'aiTool') {
        document.querySelectorAll('.pill').forEach(function(p) { p.classList.remove('active'); });
        event.target.closest('.pill').classList.add('active');
      }
    }

    function togglePw() {
      var pw = document.getElementById('pwInput');
      pw.type = pw.type === 'password' ? 'text' : 'password';
    }

    function hexToHsl(hex) {
      var r = parseInt(hex.slice(1,3),16)/255;
      var g = parseInt(hex.slice(3,5),16)/255;
      var b = parseInt(hex.slice(5,7),16)/255;
      var max = Math.max(r,g,b), min = Math.min(r,g,b);
      var h = 0, s = 0, d = max - min;
      if (d > 0) {
        s = d / max * 100;
        if (max === r) h = ((g-b)/d + (g<b?6:0)) * 60;
        else if (max === g) h = ((b-r)/d + 2) * 60;
        else h = ((r-g)/d + 4) * 60;
      }
      return { h: Math.round(h), s: Math.round(s) };
    }

    function testConnection() {
      var btn = document.getElementById('testBtn');
      var result = document.getElementById('testResult');
      btn.disabled = true;
      btn.textContent = 'Sending color...';
      result.style.display = 'none';
      result.className = 'test-result';

      var hex = document.getElementById('colorPick').value;
      var hsl = hexToHsl(hex);
      var ip = document.querySelector('input[placeholder="192.168.1.87"]').value;
      var email = document.querySelector('input[placeholder="email@example.com"]').value;
      var pw = document.getElementById('pwInput').value;

      vscode.postMessage({ type: 'testConnection', ip: ip, email: email, password: pw, hue: hsl.h, sat: hsl.s });
    }

    function testGlow() {
      var btn = document.getElementById('testGlowBtn');
      var result = document.getElementById('glowTestResult');
      btn.disabled = true;
      btn.textContent = 'Testing...';
      result.textContent = '';
      vscode.postMessage({ type: 'testGlow' });
    }

    function resetGlow() {
      var btn = document.getElementById('resetGlowBtn');
      btn.disabled = true;
      btn.textContent = 'Resetting...';
      vscode.postMessage({ type: 'resetGlow' });
    }

    // ─── Theme Management ──────────────────────────────────────────
    function colorDots(colors) {
      if (!colors || !colors.length) return '';
      var dots = '<span class="pill-colors">';
      for (var c = 0; c < colors.length; c++) {
        var h = colors[c][0]; var s = colors[c][1];
        dots += '<span class="pill-dot" style="background:hsl(' + h + ',' + s + '%,50%)"></span>';
      }
      dots += '</span>';
      return dots;
    }

    function renderThemePills() {
      var html = '';
      // Built-in theme pills
      for (var b = 0; b < builtinThemes.length; b++) {
        var bt = builtinThemes[b];
        var isActive = activeThemeId === bt.id;
        html += '<div class="theme-pill-wrap">';
        html += '<button class="theme-pill ' + (isActive ? 'active' : '') + '" onclick="selectTheme(\\'' + bt.id + '\\')" title="' + escHtml(bt.description) + '">' + escHtml(bt.name) + colorDots(bt.colors) + '</button>';
        html += '<button class="edit-btn" onclick="editBuiltinTheme(\\'' + bt.id + '\\')" title="Edit (creates a copy)">✎</button>';
        html += '</div>';
      }
      // Custom theme pills
      for (var i = 0; i < customThemes.length; i++) {
        var t = customThemes[i];
        var isActive = activeThemeId === t.id;
        html += '<div class="theme-pill-wrap">';
        html += '<button class="theme-pill ' + (isActive ? 'active' : '') + '" onclick="selectTheme(\\'' + t.id + '\\')">' + escHtml(t.name) + '</button>';
        html += '<button class="edit-btn" onclick="editTheme(\\'' + t.id + '\\')" title="Edit theme">✎</button>';
        html += '</div>';
      }
      // Create new pill
      html += '<button class="theme-pill create" onclick="createNewTheme()">+ Create New</button>';
      document.getElementById('themePills').innerHTML = html;
    }

    function escHtml(s) {
      var d = document.createElement('div');
      d.textContent = s;
      return d.innerHTML;
    }

    function selectTheme(id) {
      activeThemeId = id;
      setSetting('theme', id);
      renderThemePills();
      if (builderOpen && editingTheme && editingTheme.id !== id) {
        cancelBuilder();
      }
    }

    function createNewTheme() {
      editingTheme = {
        id: 'custom-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6),
        name: 'My Theme',
        states: JSON.parse(JSON.stringify(defaultStates)),
      };
      openBuilder(false);
    }

    function editTheme(id) {
      var theme = customThemes.find(function(t) { return t.id === id; });
      if (!theme) return;
      editingTheme = JSON.parse(JSON.stringify(theme));
      openBuilder(true);
    }

    function editBuiltinTheme(id) {
      // Find the built-in theme and create an editable copy
      var bt = builtinThemes.find(function(t) { return t.id === id; });
      if (!bt) return;
      // We need the full states — use defaultStates as base, then map from built-in theme info
      // For simplicity, create a copy with a new custom ID
      editingTheme = {
        id: 'custom-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6),
        name: bt.name + ' (Copy)',
        states: JSON.parse(JSON.stringify(defaultStates)),
      };
      openBuilder(false);
    }

    function openBuilder(isEdit) {
      builderOpen = true;
      document.getElementById('themeBuilder').classList.add('visible');
      document.getElementById('themeName').value = editingTheme.name;
      document.getElementById('deleteThemeBtn').style.display = isEdit ? 'inline-flex' : 'none';
      renderStateCards();
    }

    function cancelBuilder() {
      builderOpen = false;
      editingTheme = null;
      document.getElementById('themeBuilder').classList.remove('visible');
    }

    function saveTheme() {
      if (!editingTheme) return;
      editingTheme.name = document.getElementById('themeName').value.trim() || 'Untitled Theme';
      // Read all state values from UI
      readStateCardsIntoTheme();
      vscode.postMessage({ type: 'saveCustomTheme', theme: editingTheme });
      activeThemeId = editingTheme.id;
      cancelBuilder();
    }

    function deleteTheme() {
      if (!editingTheme) return;
      vscode.postMessage({ type: 'deleteCustomTheme', id: editingTheme.id });
      cancelBuilder();
    }

    // ─── State Cards ───────────────────────────────────────────────
    function renderStateCards() {
      var html = '';
      for (var i = 0; i < stateLabels.length; i++) {
        var sl = stateLabels[i];
        var effect = editingTheme.states[sl.key];
        var hue = effect.hue || 0;
        var bri = effect.brightness || 50;
        var effectType = effect.type || 'static';
        var cycleMs = effect.cycleMs || 1500;
        var minBri = effect.minBrightness || 20;
        var flashMs = effect.flashDurationMs || 2000;
        var hue2 = effect.hue2 || ((hue + 180) % 360);
        var dotColor = 'hsl(' + hue + ',100%,50%)';

        html += '<div class="state-card" data-state="' + sl.key + '">';
        html += '  <div class="state-header">';
        html += '    <div><div class="state-label">' + sl.label + '</div><div class="state-desc">' + sl.desc + '</div></div>';
        html += '    <div style="display:flex;align-items:center;gap:8px">';
        html += '      <button class="btn btn-sm btn-blue" onclick="previewState(\\'' + sl.key + '\\')">Test</button>';
        html += '      <div class="state-preview-dot" id="dot-' + sl.key + '" style="background:' + dotColor + '"></div>';
        html += '    </div>';
        html += '  </div>';

        html += '  <div class="state-controls">';

        // Hue slider
        html += '    <div class="slider-group">';
        html += '      <div class="slider-label"><span>Color</span><span class="slider-value" id="hue-val-' + sl.key + '">' + hue + '</span></div>';
        html += '      <input type="range" class="hue-slider" min="0" max="360" value="' + hue + '" oninput="onSlider(\\'' + sl.key + '\\',\\'hue\\',this.value)">';
        html += '    </div>';

        // Brightness
        html += '    <div class="slider-group">';
        html += '      <div class="slider-label"><span>Brightness</span><span class="slider-value" id="bri-val-' + sl.key + '">' + bri + '</span></div>';
        html += '      <input type="range" min="10" max="100" value="' + bri + '" oninput="onSlider(\\'' + sl.key + '\\',\\'bri\\',this.value)">';
        html += '    </div>';

        // Effect type
        html += '    <div class="input-group">';
        html += '      <span class="input-label">Effect</span>';
        html += '      <select class="select" onchange="onEffectChange(\\'' + sl.key + '\\',this.value)">';
        html += '        <option value="static" ' + (effectType === 'static' ? 'selected' : '') + '>Static</option>';
        html += '        <option value="pulse" ' + (effectType === 'pulse' ? 'selected' : '') + '>Pulse</option>';
        html += '        <option value="colorCycle" ' + (effectType === 'colorCycle' ? 'selected' : '') + '>Color Cycle</option>';
        html += '        <option value="colorShift" ' + (effectType === 'colorShift' ? 'selected' : '') + '>Color Shift</option>';

        html += '        <option value="flash" ' + (effectType === 'flash' ? 'selected' : '') + '>Flash</option>';
        html += '      </select>';
        html += '    </div>';

        // Animated effects need cycle speed
        var needsCycle = effectType === 'pulse' || effectType === 'colorCycle' || effectType === 'colorShift';
        html += '    <div class="slider-group" id="cycle-group-' + sl.key + '" style="' + (needsCycle ? '' : 'display:none') + '">';
        html += '      <div class="slider-label"><span>Cycle Speed</span><span class="slider-value" id="cycle-val-' + sl.key + '">' + cycleMs + 'ms</span></div>';
        html += '      <input type="range" min="400" max="3000" step="100" value="' + cycleMs + '" oninput="onSlider(\\'' + sl.key + '\\',\\'cycle\\',this.value)">';
        html += '    </div>';

        // Min brightness (pulse + breathe)
        var needsMinBri = effectType === 'pulse';
        html += '    <div class="slider-group" id="minbri-group-' + sl.key + '" style="' + (needsMinBri ? '' : 'display:none') + '">';
        html += '      <div class="slider-label"><span>Min Brightness</span><span class="slider-value" id="minbri-val-' + sl.key + '">' + minBri + '</span></div>';
        html += '      <input type="range" min="10" max="80" value="' + minBri + '" oninput="onSlider(\\'' + sl.key + '\\',\\'minbri\\',this.value)">';
        html += '    </div>';

        // Second color hue (colorShift only)
        html += '    <div class="slider-group" id="hue2-group-' + sl.key + '" style="' + (effectType === 'colorShift' ? '' : 'display:none') + '">';
        html += '      <div class="slider-label"><span>Second Color</span><span class="slider-value" id="hue2-val-' + sl.key + '">' + hue2 + '</span></div>';
        html += '      <input type="range" class="hue-slider" min="0" max="360" value="' + hue2 + '" oninput="onSlider(\\'' + sl.key + '\\',\\'hue2\\',this.value)">';
        html += '    </div>';

        // Flash duration (flash only)
        html += '    <div class="slider-group full-width" id="flash-group-' + sl.key + '" style="' + (effectType === 'flash' ? '' : 'display:none') + '">';
        html += '      <div class="slider-label"><span>Flash Duration</span><span class="slider-value" id="flash-val-' + sl.key + '">' + flashMs + 'ms</span></div>';
        html += '      <input type="range" min="500" max="5000" step="100" value="' + flashMs + '" oninput="onSlider(\\'' + sl.key + '\\',\\'flash\\',this.value)">';
        html += '    </div>';

        html += '  </div>'; // state-controls
        html += '</div>'; // state-card
      }
      document.getElementById('stateCards').innerHTML = html;
    }

    function onSlider(stateKey, prop, val) {
      val = parseInt(val);
      switch (prop) {
        case 'hue':
          document.getElementById('hue-val-' + stateKey).textContent = val;
          updateDot(stateKey);
          break;
        case 'hue2':
          document.getElementById('hue2-val-' + stateKey).textContent = val;
          break;
        case 'bri':
          document.getElementById('bri-val-' + stateKey).textContent = val;
          break;
        case 'cycle':
          document.getElementById('cycle-val-' + stateKey).textContent = val + 'ms';
          break;
        case 'minbri':
          document.getElementById('minbri-val-' + stateKey).textContent = val;
          break;
        case 'flash':
          document.getElementById('flash-val-' + stateKey).textContent = val + 'ms';
          break;
      }
    }

    function updateDot(stateKey) {
      var card = document.querySelector('[data-state="' + stateKey + '"]');
      if (!card) return;
      var hueEl = card.querySelector('.hue-slider');
      var hue = hueEl ? parseInt(hueEl.value) : 0;
      var dot = document.getElementById('dot-' + stateKey);
      if (dot) {
        dot.style.background = 'hsl(' + hue + ',100%,50%)';
      }
    }

    function onEffectChange(stateKey, effectType) {
      var needsCycle = effectType === 'pulse' || effectType === 'colorCycle' || effectType === 'colorShift';
      var needsMinBri = effectType === 'pulse';
      var showHue2 = effectType === 'colorShift';
      var showFlash = effectType === 'flash';
      document.getElementById('cycle-group-' + stateKey).style.display = needsCycle ? '' : 'none';
      document.getElementById('minbri-group-' + stateKey).style.display = needsMinBri ? '' : 'none';
      document.getElementById('hue2-group-' + stateKey).style.display = showHue2 ? '' : 'none';
      document.getElementById('flash-group-' + stateKey).style.display = showFlash ? '' : 'none';
    }

    function readStateCardsIntoTheme() {
      if (!editingTheme) return;
      for (var i = 0; i < stateLabels.length; i++) {
        var sl = stateLabels[i];
        editingTheme.states[sl.key] = readStateFromCard(sl.key);
      }
    }

    function readStateFromCard(stateKey) {
      var card = document.querySelector('[data-state="' + stateKey + '"]');
      if (!card) return defaultStates[stateKey];

      var effectSelect = card.querySelector('.select');
      var effectType = effectSelect ? effectSelect.value : 'static';

      var sliders = card.querySelectorAll('input[type="range"]');
      // Order: hue, bri, cycle, minbri, hue2, flash
      var hue = parseInt(sliders[0].value);
      var bri = parseInt(sliders[1].value);
      var cycleMs = parseInt(sliders[2].value);
      var minBri = parseInt(sliders[3].value);
      var hue2 = parseInt(sliders[4].value);
      var flashMs = parseInt(sliders[5].value);

      var effect = { type: effectType, brightness: bri, hue: hue, saturation: 100 };
      if (effectType === 'pulse') {
        effect.cycleMs = cycleMs;
        effect.minBrightness = minBri;
      }
      if (effectType === 'colorCycle') {
        effect.cycleMs = cycleMs;
      }
      if (effectType === 'colorShift') {
        effect.cycleMs = cycleMs;
        effect.hue2 = hue2;
      }
      if (effectType === 'flash') {
        effect.flashDurationMs = flashMs;
      }
      return effect;
    }

    function previewState(stateKey) {
      var effect = readStateFromCard(stateKey);
      vscode.postMessage({ type: 'previewEffect', effect: effect });
    }

    // ─── Sound Pack Management ─────────────────────────────────────
    var defaultSoundStates = {
      idle:            { soundId: 'builtin:none',       volume: 50, enabled: false },
      thinking:        { soundId: 'builtin:whoosh',     volume: 60, enabled: true },
      editing:         { soundId: 'builtin:click',      volume: 40, enabled: true },
      waitingForInput: { soundId: 'builtin:beep-alert', volume: 80, enabled: true },
      completion:      { soundId: 'builtin:ding',       volume: 70, enabled: true },
    };

    function renderSoundPackPills() {
      var html = '';
      // Built-in sound packs
      for (var b = 0; b < builtinSoundPacks.length; b++) {
        var bp = builtinSoundPacks[b];
        var isActive = activeSoundPackId === bp.id;
        html += '<div class="theme-pill-wrap">';
        html += '<button class="theme-pill ' + (isActive ? 'active' : '') + '" onclick="selectSoundPack(\\'' + bp.id + '\\')">' + escHtml(bp.name) + '</button>';
        html += '<button class="edit-btn" onclick="editBuiltinSoundPack(\\'' + bp.id + '\\')" title="Edit (creates a copy)">✎</button>';
        html += '</div>';
      }
      // Custom sound packs
      for (var i = 0; i < customSoundPacks.length; i++) {
        var p = customSoundPacks[i];
        var isActive = activeSoundPackId === p.id;
        html += '<div class="theme-pill-wrap">';
        html += '<button class="theme-pill ' + (isActive ? 'active' : '') + '" onclick="selectSoundPack(\\'' + p.id + '\\')">' + escHtml(p.name) + '</button>';
        html += '<button class="edit-btn" onclick="editSoundPack(\\'' + p.id + '\\')" title="Edit sound pack">✎</button>';
        html += '</div>';
      }
      html += '<button class="theme-pill create" onclick="createNewSoundPack()">+ Create New</button>';
      document.getElementById('soundPackPills').innerHTML = html;
    }

    function selectSoundPack(id) {
      activeSoundPackId = id;
      setSetting('soundPack', id);
      renderSoundPackPills();
      if (soundBuilderOpen && editingSoundPack && editingSoundPack.id !== id) {
        cancelSoundBuilder();
      }
    }

    function createNewSoundPack() {
      editingSoundPack = {
        id: 'soundpack-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6),
        name: 'My Sound Pack',
        states: JSON.parse(JSON.stringify(defaultSoundStates)),
      };
      openSoundBuilder(false);
    }

    function editSoundPack(id) {
      var pack = customSoundPacks.find(function(p) { return p.id === id; });
      if (!pack) return;
      editingSoundPack = JSON.parse(JSON.stringify(pack));
      openSoundBuilder(true);
    }

    function editBuiltinSoundPack(id) {
      var bp = builtinSoundPacks.find(function(p) { return p.id === id; });
      if (!bp) return;
      editingSoundPack = {
        id: 'custom-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6),
        name: bp.name + ' (Copy)',
        states: JSON.parse(JSON.stringify(bp.states)),
      };
      openSoundBuilder(false);
    }

    function openSoundBuilder(isEdit) {
      soundBuilderOpen = true;
      document.getElementById('soundBuilder').classList.add('visible');
      document.getElementById('soundPackName').value = editingSoundPack.name;
      document.getElementById('deleteSoundPackBtn').style.display = isEdit ? 'inline-flex' : 'none';
      renderSoundStateCards();
    }

    function cancelSoundBuilder() {
      soundBuilderOpen = false;
      editingSoundPack = null;
      document.getElementById('soundBuilder').classList.remove('visible');
    }

    function saveSoundPack() {
      if (!editingSoundPack) return;
      editingSoundPack.name = document.getElementById('soundPackName').value.trim() || 'Untitled Sound Pack';
      readSoundCardsIntoPack();
      vscode.postMessage({ type: 'saveSoundPack', pack: editingSoundPack });
      activeSoundPackId = editingSoundPack.id;
      cancelSoundBuilder();
    }

    function deleteSoundPack() {
      if (!editingSoundPack) return;
      vscode.postMessage({ type: 'deleteSoundPack', id: editingSoundPack.id });
      cancelSoundBuilder();
    }

    // ─── Sound State Cards ──────────────────────────────────────────
    function buildSoundOptions(selectedId) {
      var html = '';
      for (var i = 0; i < builtinSounds.length; i++) {
        var s = builtinSounds[i];
        var val = 'builtin:' + s.id;
        html += '<option value="' + val + '" ' + (val === selectedId ? 'selected' : '') + '>' + s.label + '</option>';
      }
      for (var j = 0; j < uploadedCustomSounds.length; j++) {
        var c = uploadedCustomSounds[j];
        html += '<option value="' + c.soundId + '" ' + (c.soundId === selectedId ? 'selected' : '') + '>' + c.label + '</option>';
      }
      // Check if selectedId is a custom: that isn't in uploadedCustomSounds
      if (selectedId && selectedId.startsWith('custom:')) {
        var found = uploadedCustomSounds.find(function(x) { return x.soundId === selectedId; });
        if (!found) {
          var label = selectedId.replace('custom:', '');
          html += '<option value="' + selectedId + '" selected>' + label + '</option>';
        }
      }
      return html;
    }

    function renderSoundStateCards() {
      var html = '';
      for (var i = 0; i < stateLabels.length; i++) {
        var sl = stateLabels[i];
        var entry = editingSoundPack.states[sl.key];
        var soundId = entry.soundId || 'builtin:none';
        var volume = entry.volume || 50;
        var entryEnabled = entry.enabled !== false;

        html += '<div class="state-card" data-sound-state="' + sl.key + '">';
        html += '  <div class="state-header">';
        html += '    <div><div class="state-label">' + sl.label + '</div><div class="state-desc">' + sl.desc + '</div></div>';
        html += '    <div style="display:flex;align-items:center;gap:8px">';
        html += '      <button class="btn btn-sm btn-blue" onclick="previewSoundState(\\'' + sl.key + '\\')">Test</button>';
        html += '      <label class="toggle">';
        html += '        <input type="checkbox" ' + (entryEnabled ? 'checked' : '') + '>';
        html += '        <span class="toggle-track"></span>';
        html += '        <span class="toggle-thumb"></span>';
        html += '      </label>';
        html += '    </div>';
        html += '  </div>';

        html += '  <div class="state-controls">';

        // Sound selector
        html += '    <div class="input-group">';
        html += '      <span class="input-label">Sound</span>';
        html += '      <select class="select">' + buildSoundOptions(soundId) + '</select>';
        html += '    </div>';

        // Volume slider
        html += '    <div class="slider-group">';
        html += '      <div class="slider-label"><span>Volume</span><span class="slider-value" id="svol-val-' + sl.key + '">' + volume + '</span></div>';
        html += '      <input type="range" min="0" max="100" value="' + volume + '" oninput="onSoundVolSlider(\\'' + sl.key + '\\',this.value)">';
        html += '    </div>';

        // Upload custom button
        html += '    <div class="input-group">';
        html += '      <span class="input-label">Custom Sound</span>';
        html += '      <label class="btn btn-sm" style="cursor:pointer;text-align:center">Upload .wav/.mp3';
        html += '        <input type="file" accept=".wav,.mp3" style="display:none" onchange="uploadSoundFile(\\'' + sl.key + '\\',this)">';
        html += '      </label>';
        html += '    </div>';

        html += '  </div>';
        html += '</div>';
      }
      document.getElementById('soundStateCards').innerHTML = html;
    }

    function onSoundVolSlider(stateKey, val) {
      document.getElementById('svol-val-' + stateKey).textContent = val;
    }

    function readSoundCardsIntoPack() {
      if (!editingSoundPack) return;
      for (var i = 0; i < stateLabels.length; i++) {
        var sl = stateLabels[i];
        editingSoundPack.states[sl.key] = readSoundFromCard(sl.key);
      }
    }

    function readSoundFromCard(stateKey) {
      var card = document.querySelector('[data-sound-state="' + stateKey + '"]');
      if (!card) return defaultSoundStates[stateKey];
      var soundSelect = card.querySelector('.select');
      var soundId = soundSelect ? soundSelect.value : 'builtin:none';
      var volSlider = card.querySelector('input[type="range"]');
      var volume = volSlider ? parseInt(volSlider.value) : 50;
      var enabledCheck = card.querySelector('.toggle input[type="checkbox"]');
      var enabled = enabledCheck ? enabledCheck.checked : true;
      return { soundId: soundId, volume: volume, enabled: enabled };
    }

    function previewSoundState(stateKey) {
      var entry = readSoundFromCard(stateKey);
      vscode.postMessage({ type: 'previewSound', soundId: entry.soundId, volume: entry.volume });
    }

    function uploadSoundFile(stateKey, input) {
      if (!input.files || !input.files[0]) return;
      var file = input.files[0];
      var reader = new FileReader();
      reader.onload = function() {
        var base64 = reader.result.split(',')[1];
        vscode.postMessage({ type: 'uploadSound', name: file.name, data: base64 });
        // When we get soundUploaded back, update the dropdown for this state
        window._pendingSoundUploadState = stateKey;
      };
      reader.readAsDataURL(file);
    }

    // ─── Mascot Pack Management ────────────────────────────────────
    var mascotAnimLabels = [
      { key: 'thinking', label: 'Thinking', desc: 'Loops while AI is reasoning' },
      { key: 'needsInput', label: 'Needs Input', desc: 'Loops when AI needs your attention' },
      { key: 'complete', label: 'Complete', desc: 'Plays once when AI finishes' },
    ];

    function renderMascotPackPills() {
      var html = '';
      // Built-in mascot packs
      for (var b = 0; b < builtinMascotPacks.length; b++) {
        var bp = builtinMascotPacks[b];
        var isActive = activeMascotPackId === bp.id;
        html += '<button class="theme-pill ' + (isActive ? 'active' : '') + '" onclick="selectMascotPack(\\'' + bp.id + '\\')" title="' + escHtml(bp.description) + '">' + escHtml(bp.name) + '</button>';
      }
      // Custom mascot packs
      for (var i = 0; i < customMascotPacks.length; i++) {
        var p = customMascotPacks[i];
        var isActive = activeMascotPackId === p.id;
        html += '<div class="theme-pill-wrap">';
        html += '<button class="theme-pill ' + (isActive ? 'active' : '') + '" onclick="selectMascotPack(\\'' + p.id + '\\')">' + escHtml(p.name) + '</button>';
        html += '<button class="edit-btn" onclick="editMascotPack(\\'' + p.id + '\\')" title="Edit pack">✎</button>';
        html += '</div>';
      }
      html += '<button class="theme-pill create" onclick="createNewMascotPack()">+ Create New</button>';
      document.getElementById('mascotPackPills').innerHTML = html;
    }

    function selectMascotPack(id) {
      activeMascotPackId = id;
      setSetting('mascotTheme', id);
      renderMascotPackPills();
      if (mascotBuilderOpen && editingMascotPack && editingMascotPack.id !== id) {
        cancelMascotBuilder();
      }
    }

    function createNewMascotPack() {
      editingMascotPack = {
        id: 'mascot-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6),
        name: 'My Animation Pack',
      };
      mascotUploadState = { thinking: false, needsInput: false, complete: false };
      openMascotBuilder(false);
    }

    function editMascotPack(id) {
      var pack = customMascotPacks.find(function(p) { return p.id === id; });
      if (!pack) return;
      editingMascotPack = JSON.parse(JSON.stringify(pack));
      mascotUploadState = { thinking: true, needsInput: true, complete: true }; // existing pack has all files
      openMascotBuilder(true);
    }

    function openMascotBuilder(isEdit) {
      mascotBuilderOpen = true;
      document.getElementById('mascotBuilder').classList.add('visible');
      document.getElementById('mascotPackName').value = editingMascotPack.name;
      document.getElementById('deleteMascotPackBtn').style.display = isEdit ? 'inline-flex' : 'none';
      renderMascotUploadCards();
      updateMascotStatus();
    }

    function cancelMascotBuilder() {
      mascotBuilderOpen = false;
      editingMascotPack = null;
      document.getElementById('mascotBuilder').classList.remove('visible');
    }

    function renderMascotUploadCards() {
      var html = '';
      for (var i = 0; i < mascotAnimLabels.length; i++) {
        var al = mascotAnimLabels[i];
        var uploaded = mascotUploadState[al.key];
        html += '<div class="state-card">';
        html += '  <div class="state-header">';
        html += '    <div><div class="state-label">' + al.label + '</div><div class="state-desc">' + al.desc + '</div></div>';
        html += '    <div style="display:flex;align-items:center;gap:8px">';
        html += '      <span id="mascot-status-' + al.key + '" style="font-size:11px;opacity:0.6">' + (uploaded ? '✓ uploaded' : 'not uploaded') + '</span>';
        html += '    </div>';
        html += '  </div>';
        html += '  <div class="state-controls">';
        html += '    <div class="input-group" style="flex:1">';
        html += '      <span class="input-label">Lottie JSON</span>';
        html += '      <label class="btn btn-sm" style="cursor:pointer;text-align:center">Upload .json';
        html += '        <input type="file" accept=".json" style="display:none" onchange="uploadMascotAnim(\\'' + al.key + '\\',this)">';
        html += '      </label>';
        html += '    </div>';
        html += '  </div>';
        html += '</div>';
      }
      document.getElementById('mascotUploadCards').innerHTML = html;
    }

    function uploadMascotAnim(stateKey, input) {
      if (!input.files || !input.files[0] || !editingMascotPack) return;
      var file = input.files[0];
      var reader = new FileReader();
      reader.onload = function() {
        var base64 = reader.result.split(',')[1];
        vscode.postMessage({
          type: 'uploadMascotAnim',
          packId: editingMascotPack.id,
          state: stateKey,
          data: base64,
        });
      };
      reader.readAsDataURL(file);
    }

    function updateMascotStatus() {
      var all = mascotUploadState.thinking && mascotUploadState.needsInput && mascotUploadState.complete;
      var el = document.getElementById('mascotUploadStatus');
      if (el) {
        el.textContent = all ? 'All 3 animations uploaded — ready to save!' : 'Upload all 3 animations (thinking, needsInput, complete) to save.';
        el.style.color = all ? 'var(--vscode-charts-green, #4ec94e)' : '';
      }
    }

    function saveMascotPack() {
      if (!editingMascotPack) return;
      if (!mascotUploadState.thinking || !mascotUploadState.needsInput || !mascotUploadState.complete) {
        var el = document.getElementById('mascotUploadStatus');
        if (el) {
          el.textContent = 'Please upload all 3 animation files before saving.';
          el.style.color = 'var(--vscode-errorForeground, #f44)';
        }
        return;
      }
      editingMascotPack.name = document.getElementById('mascotPackName').value.trim() || 'Untitled Pack';
      vscode.postMessage({ type: 'saveMascotPack', pack: editingMascotPack });
      activeMascotPackId = editingMascotPack.id;
      cancelMascotBuilder();
    }

    function deleteMascotPack() {
      if (!editingMascotPack) return;
      vscode.postMessage({ type: 'deleteMascotPack', id: editingMascotPack.id });
      cancelMascotBuilder();
    }

    // ─── Messages from extension ───────────────────────────────────
    window.addEventListener('message', function(ev) {
      var msg = ev.data;
      if (msg.type === 'connectionResult') {
        var btn = document.getElementById('testBtn');
        var result = document.getElementById('testResult');
        btn.disabled = false;
        btn.textContent = 'Test Connection';
        if (msg.success) {
          result.className = 'test-result success';
          result.textContent = 'Connected successfully!';
        } else {
          result.className = 'test-result fail';
          result.textContent = 'Connection failed — check IP and credentials';
        }
      }
      if (msg.type === 'glowTestResult') {
        var glowBtn = document.getElementById('testGlowBtn');
        var glowResult = document.getElementById('glowTestResult');
        glowBtn.disabled = false;
        glowBtn.textContent = '⚡ Test Glow';
        if (msg.success) {
          glowResult.style.color = '#4ade80';
          glowResult.textContent = '✓ Glow working! Borders flash blue for 3s.';
        } else {
          glowResult.style.color = '#f87171';
          glowResult.textContent = '✗ Glow failed — your editor may not support it.';
        }
      }
      if (msg.type === 'glowResetResult') {
        var resetBtn = document.getElementById('resetGlowBtn');
        var resetResult = document.getElementById('glowTestResult');
        resetBtn.disabled = false;
        resetBtn.textContent = '🔄 Reset Colors';
        resetResult.style.color = '#4ade80';
        resetResult.textContent = '✓ Colors restored to theme defaults.';
      }
      if (msg.type === 'customThemes') {
        customThemes = msg.themes;
        renderThemePills();
      }
      if (msg.type === 'soundPacks') {
        customSoundPacks = msg.packs;
        renderSoundPackPills();
      }
      if (msg.type === 'soundUploaded') {
        uploadedCustomSounds.push({ soundId: msg.soundId, label: msg.label });
        if (window._pendingSoundUploadState && soundBuilderOpen) {
          var stateKey = window._pendingSoundUploadState;
          var card = document.querySelector('[data-sound-state="' + stateKey + '"]');
          if (card) {
            var sel = card.querySelector('.select');
            if (sel) {
              var opt = document.createElement('option');
              opt.value = msg.soundId;
              opt.textContent = msg.label;
              opt.selected = true;
              sel.appendChild(opt);
            }
          }
          window._pendingSoundUploadState = null;
        }
      }
      if (msg.type === 'mascotPacks') {
        customMascotPacks = msg.packs;
        renderMascotPackPills();
      }
      if (msg.type === 'mascotAnimUploaded') {
        mascotUploadState[msg.state] = true;
        var statusEl = document.getElementById('mascot-status-' + msg.state);
        if (statusEl) statusEl.textContent = '✓ uploaded';
        updateMascotStatus();
      }
      if (msg.type === 'mascotAnimError') {
        var statusEl = document.getElementById('mascot-status-' + msg.state);
        if (statusEl) {
          statusEl.textContent = msg.error;
          statusEl.style.color = 'var(--vscode-errorForeground, #f44)';
        }
      }
    });

    // ─── Init ──────────────────────────────────────────────────────
    renderThemePills();
    renderSoundPackPills();
    renderMascotPackPills();
    vscode.postMessage({ type: 'getCustomThemes' });
    vscode.postMessage({ type: 'getSoundPacks' });
    vscode.postMessage({ type: 'getMascotPacks' });
  </script>
</body>
</html>`;
  }
}
