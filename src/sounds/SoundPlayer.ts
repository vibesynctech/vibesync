import * as vscode from 'vscode';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import { BUILTIN_SOUNDS } from './types.js';
import { log } from '../utils/logger.js';

/**
 * Cross-platform audio playback.
 * - macOS: afplay CLI (built-in, supports MP3/WAV + volume)
 * - Linux: paplay CLI (PulseAudio, supports WAV + volume)
 * - Windows: PowerShell -STA + WPF MediaPlayer (headless, supports MP3/WAV + volume)
 *
 * Kill-previous pattern: each play() kills any running sound first.
 */
export class SoundPlayer {
  private currentProcess: ChildProcess | null = null;

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
        // PowerShell -STA + WPF MediaPlayer: headless MP3/WAV playback, no window
        const vol01 = (vol / 100).toFixed(3);
        const fileUri = 'file:///' + filePath.replace(/\\/g, '/');
        const psFileUri = fileUri.replace(/"/g, '`"');
        const ps = [
          'Add-Type -AssemblyName PresentationCore',
          '$p=[System.Windows.Media.MediaPlayer]::new()',
          `$p.Open([System.Uri]::new("${psFileUri}"))`,
          `$p.Volume=${vol01}`,
          'Start-Sleep -Milliseconds 500',
          '$p.Play()',
          'Start-Sleep -Seconds 30',
        ].join(';');
        this.currentProcess = spawn('powershell.exe', ['-STA', '-NoProfile', '-Command', ps]);
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
  }

  dispose(): void {
    this.stop();
  }
}
