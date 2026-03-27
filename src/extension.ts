import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { exec } from 'child_process';
import { initLogger, log, logError } from './utils/logger.js';
import { Settings } from './config/Settings.js';
import { TapoController } from './lights/TapoController.js';
import { LightOrchestrator } from './lights/LightOrchestrator.js';
import { StateMachine } from './detector/StateMachine.js';
import { EditorSignals } from './detector/EditorSignals.js';
import { VelocitySignal } from './detector/VelocitySignal.js';
import { CommandSignal } from './detector/CommandSignal.js';
import { TerminalSignal } from './detector/TerminalSignal.js';
import { LogTailSignal } from './detector/LogTailSignal.js';
import { ClaudeCodeSignal } from './detector/ClaudeCodeSignal.js';
import { ActivityTracker } from './tracker/ActivityTracker.js';
import { CalendarViewProvider } from './tracker/CalendarViewProvider.js';
import { GitHubService } from './tracker/GitHubService.js';
import { SyncService } from './tracker/SyncService.js';
import { SettingsViewProvider } from './settings/SettingsViewProvider.js';
import { SoundPlayer } from './sounds/SoundPlayer.js';
import { ScreenGlowController } from './lights/ScreenGlowController.js';
import { GuideViewProvider } from './guides/GuideViewProvider.js';

let statusBarItem: vscode.StatusBarItem;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  initLogger(context);
  log('VibeSync activating...');

  const settings = new Settings();
  settings.setGlobalState(context.globalState);

  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'vibeSync.showStatus';
  updateStatusBar('idle', settings.enabled);
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  const controllerRef = {
    tapo: new TapoController(settings.tapoIp, settings.tapoEmail, settings.tapoPassword),
  };
  const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
  const stateMachine = new StateMachine(settings);
  const orchestrator = new LightOrchestrator(controllerRef, settings, workspacePath);

  // Sound player — coupled with LightOrchestrator for perfect sync
  const soundsDir = vscode.Uri.joinPath(context.globalStorageUri, 'sounds');
  void vscode.workspace.fs.createDirectory(soundsDir);
  const soundPlayer = new SoundPlayer(context.extensionPath, context.globalStorageUri.fsPath);
  orchestrator.setSoundPlayer(soundPlayer);

  // Screen glow — software alternative to physical RGB lights
  const screenGlow = new ScreenGlowController();
  if (settings.screenGlowEnabled) {
    void screenGlow.connect();
  }
  orchestrator.setScreenGlow(screenGlow);

  // Connect to Tapo light (non-blocking) and set initial idle color
  if (settings.isConfigured() && settings.enabled) {
    void connectWithFeedback(controllerRef.tapo, settings).then(() => {
      if (controllerRef.tapo.isConnected()) {
        orchestrator.applyState('idle');
      }
    });
  }

  // Wire signals → state machine
  const editorSignals = new EditorSignals(stateMachine);
  const velocitySignal = new VelocitySignal(stateMachine, editorSignals);
  const commandSignal = new CommandSignal(stateMachine);
  const terminalSignal = new TerminalSignal(stateMachine);

  // Log tailing for Antigravity IDE — watches Gemini agent's log file for API calls
  const logTailSignal = new LogTailSignal(stateMachine);
  if (settings.aiTool === 'antigravity') {
    logTailSignal.start();
  }

  // JSONL tailing for Claude Code CLI — watches conversation files for AI state
  const claudeCodeSignal = new ClaudeCodeSignal(stateMachine);
  if (settings.aiTool === 'claude-code') {
    claudeCodeSignal.start();
  }

  // State machine → light orchestrator + sidebar mascot
  stateMachine.onStateChange((event) => {
    updateStatusBar(event.current, settings.enabled);
    if (settings.enabled) {
      orchestrator.applyState(event.current);
    }
    if (settings.mascotEnabled) {
      calendarProvider.updateVibeState(event.current);
    }
  });

  const settingsWatcher = settings.onDidChange(() => {
    log('Settings changed — rebuilding controller...');
    controllerRef.tapo.disconnect();
    controllerRef.tapo = new TapoController(settings.tapoIp, settings.tapoEmail, settings.tapoPassword);
    orchestrator.updateController(controllerRef);
    if (settings.isConfigured() && settings.enabled) {
      void connectWithFeedback(controllerRef.tapo, settings);
    }
    updateStatusBar(stateMachine.currentState, settings.enabled);

    // Screen glow — connect/disconnect based on setting
    if (settings.screenGlowEnabled) {
      if (!screenGlow.isConnected()) void screenGlow.connect();
    } else {
      if (screenGlow.isConnected()) screenGlow.disconnect();
    }

    // Restart log tailing if aiTool changed
    logTailSignal.stop();
    claudeCodeSignal.stop();
    if (settings.aiTool === 'antigravity') {
      logTailSignal.start();
    }
    if (settings.aiTool === 'claude-code') {
      claudeCodeSignal.start();
    }

    // Forward mascot settings to webview
    calendarProvider.updateMascotConfig(settings.mascotEnabled);
  });

  const toggleCmd = vscode.commands.registerCommand('vibeSync.toggle', async () => {
    await settings.toggle();
    const nowEnabled = settings.enabled;
    updateStatusBar(stateMachine.currentState, nowEnabled);
  });

  const testCmd = vscode.commands.registerCommand('vibeSync.testLights', async () => {
    await orchestrator.runDemo();
  });

  const statusCmd = vscode.commands.registerCommand('vibeSync.showStatus', () => {
    const connected = controllerRef.tapo.isConnected();
    vscode.window.showInformationMessage(`VibeSync | State: ${stateMachine.currentState} | Light: ${connected ? '🟢 Connected' : '🔴 Disconnected'}`);
  });

  // Time tracker — tracks total daily time in the editor
  const activityTracker = new ActivityTracker(context.globalState);
  activityTracker.start();

  // GitHub integration — auth, commits, cloud sync
  const githubService = new GitHubService();
  const syncService = new SyncService(activityTracker, githubService);
  void syncService.start();

  const calendarProvider = new CalendarViewProvider(activityTracker, githubService, context.extensionPath, settings, context.globalStorageUri.fsPath);
  const calendarViewReg = vscode.window.registerWebviewViewProvider('vibeSync.timeCalendar', calendarProvider);

  const focusTimeCmd = vscode.commands.registerCommand('vibeSync.focusTimeTracker', async () => {
    await vscode.commands.executeCommand('vibeSync.timeCalendar.focus');
  });

  const seedDataCmd = vscode.commands.registerCommand('vibeSync.seedTestData', () => {
    activityTracker.seedTestData();
    calendarProvider.refresh();
    vscode.window.showInformationMessage('VibeSync: Seeded 60 days of fake data!');
  });

  const clearDataCmd = vscode.commands.registerCommand('vibeSync.clearTestData', () => {
    activityTracker.clearData();
    calendarProvider.refresh();
    vscode.window.showInformationMessage('VibeSync: Cleared all time data.');
  });

  const signInCmd = vscode.commands.registerCommand('vibeSync.signInGitHub', () => {
    void githubService.signIn();
  });

  const signOutCmd = vscode.commands.registerCommand('vibeSync.signOutGitHub', () => {
    void githubService.signOut();
  });

  const debugGitHubCmd = vscode.commands.registerCommand('vibeSync.debugGitHub', async () => {
    const info = await githubService.debugInfo();
    const doc = await vscode.workspace.openTextDocument({ content: info, language: 'text' });
    await vscode.window.showTextDocument(doc);
  });

  const settingsProvider = new SettingsViewProvider(
    // Test connection callback
    async (ip, email, password, hue, sat) => {
      try {
        const { TapoController } = await import('./lights/TapoController.js');
        const testCtrl = new TapoController(ip, email, password);
        await testCtrl.connect();
        await testCtrl.setColor(hue, sat, 80);
        setTimeout(() => testCtrl.disconnect(), 10000);
        return true;
      } catch {
        return false;
      }
    },
    // Preview effect callback — send effect to light for 3 seconds, then revert
    async (effect) => {
      if (!controllerRef.tapo.isConnected()) return;
      await orchestrator.previewEffect(effect, 3000);
    },
    // Preview sound callback
    async (soundId: string, volume: number) => {
      orchestrator.previewSound(soundId, volume);
    },
    settings,
    context.globalStorageUri,
  );

  const openSettingsCmd = vscode.commands.registerCommand('vibeSync.openSettings', () => {
    settingsProvider.show();
  });

  const guideProvider = new GuideViewProvider();
  const openGuideCmd = vscode.commands.registerCommand('vibeSync.openGuide', () => {
    guideProvider.show();
  });

  // Move to secondary sidebar (right) on first activation — like Copilot Chat
  if (!context.globalState.get('vibeSync.calendarMovedToRight.v2')) {
    void context.globalState.update('vibeSync.calendarMovedToRight.v2', true);
    setTimeout(async () => {
      try {
        await vscode.commands.executeCommand('vibeSync.timeCalendar.focus');
        await vscode.commands.executeCommand('workbench.action.moveFocusedView', {
          destination: 'workbench.view.extension.auxiliarybar',
        });
      } catch {
        // Fallback: try the simpler command
        try {
          await vscode.commands.executeCommand('workbench.action.moveViewToSecondarySidebar');
        } catch { /* VS Code version may not support this */ }
      }
    }, 2000);
  }

  context.subscriptions.push(
    editorSignals, velocitySignal, commandSignal, terminalSignal, logTailSignal, claudeCodeSignal,
    settingsWatcher, toggleCmd, testCmd, statusCmd, focusTimeCmd, seedDataCmd, clearDataCmd,
    signInCmd, signOutCmd, debugGitHubCmd, openSettingsCmd, openGuideCmd,
    calendarViewReg, calendarProvider, activityTracker, githubService, syncService,
    {
      dispose: () => {
        stateMachine.dispose();
        orchestrator.dispose();
        controllerRef.tapo.disconnect();
        screenGlow.disconnect();
        void syncService.finalSync();
        calendarProvider.dispose();
      },
    }
  );

  // ─── VALIDATION TESTS (temporary) ─────────────────────────────────────────
  testNetworkPulse();
  testSelectionSpy(context);

  log(`VibeSync activated. Theme: ${settings.theme}, AI tool: ${settings.aiTool}`);
}

export function deactivate(): void {
  // Release bulb ownership if this window owns it
  const lockFile = path.join(os.homedir(), '.claude', '.vibesync-owner');
  try {
    const content = fs.readFileSync(lockFile, 'utf-8');
    const owner = content.trim().split('\n')[0];
    const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
    if (owner === ws) fs.unlinkSync(lockFile);
  } catch { /* ignore */ }
}

function updateStatusBar(state: string, enabled: boolean): void {
  if (!statusBarItem) return;
  statusBarItem.text = enabled ? `$(lightbulb) Vibe` : `$(lightbulb-off) Vibe (off)`;
}

async function connectWithFeedback(tapo: TapoController, settings: Settings): Promise<void> {
  try {
    await tapo.connect();
    vscode.window.showInformationMessage('VibeSync: ✅ Connected to Tapo light!');
  } catch (err) {
    logError('Tapo connection failed', err);
  }
}

// ─── VALIDATION TESTS (temporary — remove after testing) ──────────────────

/**
 * Test 1: Network Wiretap — checks if VS Code has active network connections.
 * Should spam "[NETWORK] AI is talking..." while agent is generating,
 * and go silent when it's done.
 */
function testNetworkPulse(): void {
  setInterval(() => {
    exec('lsof -i -n -P | grep "Code" | grep "ESTABLISHED"', (_err, stdout) => {
      if (stdout) {
        console.log('[NETWORK] AI is talking to the internet!');
      }
    });
  }, 1000);
}

/**
 * Test 2: Selection Spy — detects whether you're typing in code or chat.
 * Should log 🔵 when clicking/typing in code editor,
 * and 🔴 when typing in the Antigravity chat panel.
 */
function testSelectionSpy(context: vscode.ExtensionContext): void {
  let lastEditorClick = 0;

  context.subscriptions.push(
    vscode.window.onDidChangeTextEditorSelection(() => {
      lastEditorClick = Date.now();
      console.log('[FOCUS] 🔵 You are DEFINITELY in the Code Editor');
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument(() => {
      if (Date.now() - lastEditorClick > 1000) {
        console.log('[FOCUS] 🔴 You must be typing in the Chat!');
      }
    })
  );
}
