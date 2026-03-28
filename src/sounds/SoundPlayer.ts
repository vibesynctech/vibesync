import * as vscode from 'vscode';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import { BUILTIN_SOUNDS } from './types.js';
import { log } from '../utils/logger.js';

/**
 * Cross-platform audio playback.
 * - macOS: afplay CLI
 * - Linux: paplay CLI
 * - Windows: Hidden webview with HTML5 <audio> element (supports MP3 + volume)
 *
 * Kill-previous pattern: each play() kills any running sound first.
 */
export class SoundPlayer {
  private currentProcess: ChildProcess | null = null;
  private webviewPanel: vscode.WebviewPanel | null = null;

  constructor(private readonly context: vscode.ExtensionContext) {}

  private get extensionPath(): string {
    return this.context.extensionPath;
  }

  private get globalStoragePath(): string {
    return this.context.globalStorageUri.fsPath;
  }

  /** Resolve soundId to absolute file path */
  private resolveFile(soundId: string): string | null {
    if (!soundId || soundId === 'builtin:none') return null;

    if (soundId.startsWith('builtin:')) {
      const id = soundId.replace('builtin:', '');
      const sound = BUILTIN_SOUNDS.find(s => s.id === id);
      if (!sound?.filename) return null;
      return path.join(this.extensionPath, 'media', 'sounds', sound.filename);
    }

    if (soundId.startsWith('custom:')) {
      const filename = soundId.replace('custom:', '');
      return path.join(this.globalStoragePath, 'sounds', filename);
    }

    return null;
  }

  /** Get or create the hidden webview for Windows audio playback */
  private getOrCreateWebview(): vscode.WebviewPanel {
    if (this.webviewPanel) return this.webviewPanel;

    const soundsMediaUri = vscode.Uri.joinPath(
      vscode.Uri.file(this.extensionPath),
      'media',
      'sounds'
    );
    const customSoundsUri = vscode.Uri.file(
      path.join(this.globalStoragePath, 'sounds')
    );

    this.webviewPanel = vscode.window.createWebviewPanel(
      'vibeSync.soundPlayer',
      'VibeSync Sound Player',
      { viewColumn: vscode.ViewColumn.One, preserveFocus: true },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [soundsMediaUri, customSoundsUri],
      }
    );

    this.webviewPanel.webview.html = `<!DOCTYPE html><html><body>
      <audio id="a"></audio>
      <script>
        const a = document.getElementById('a');
        window.addEventListener('message', e => {
          const msg = e.data;
          if (msg.stop) { a.pause(); a.src = ''; return; }
          a.src = msg.src;
          a.volume = Math.max(0, Math.min(1, msg.volume / 100));
          a.play().catch(() => {});
        });
      </script>
    </body></html>`;

    this.webviewPanel.onDidDispose(() => {
      this.webviewPanel = null;
    });

    return this.webviewPanel;
  }

  /** Play a sound file. Kills any currently-playing sound first. */
  play(soundId: string, volume: number): void {
    this.stop();
    const filePath = this.resolveFile(soundId);
    if (!filePath) return;

    const vol = Math.max(0, Math.min(100, volume));
    log(`SoundPlayer: playing "${soundId}" at volume ${vol}`);

    try {
      if (process.platform === 'darwin') {
        // afplay volume: 0.0 to 1.0
        this.currentProcess = spawn('afplay', ['-v', String(vol / 100), filePath]);
      } else if (process.platform === 'linux') {
        // paplay volume: 0 to 65536
        const paVol = Math.round((vol / 100) * 65536);
        this.currentProcess = spawn('paplay', ['--volume', String(paVol), filePath]);
      } else if (process.platform === 'win32') {
        // Windows: hidden webview with HTML5 <audio> (supports MP3 + volume)
        const panel = this.getOrCreateWebview();
        const fileUri = panel.webview.asWebviewUri(vscode.Uri.file(filePath));
        void panel.webview.postMessage({ src: fileUri.toString(), volume: vol });
      }

      // Swallow errors silently (no audio output, missing binary, etc.)
      this.currentProcess?.on('error', () => {
        this.currentProcess = null;
      });
      this.currentProcess?.on('exit', () => {
        this.currentProcess = null;
      });
    } catch {
      this.currentProcess = null;
    }
  }

  /** Kill any currently-playing sound */
  stop(): void {
    if (this.currentProcess) {
      this.currentProcess.kill();
      this.currentProcess = null;
    }
    if (process.platform === 'win32' && this.webviewPanel) {
      void this.webviewPanel.webview.postMessage({ stop: true });
    }
  }

  dispose(): void {
    this.stop();
    this.webviewPanel?.dispose();
    this.webviewPanel = null;
  }
}
