import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import { BUILTIN_SOUNDS } from './types.js';
import { log } from '../utils/logger.js';

/**
 * Cross-platform audio playback using child_process.spawn.
 * Kill-previous pattern: each play() kills any running sound first.
 */
export class SoundPlayer {
  private currentProcess: ChildProcess | null = null;

  constructor(
    private readonly extensionPath: string,
    private readonly globalStoragePath: string,
  ) {}

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
        // PowerShell [Media.SoundPlayer] — no volume control on Windows
        this.currentProcess = spawn('powershell', [
          '-NoProfile', '-Command',
          `(New-Object Media.SoundPlayer '${filePath}').PlaySync()`,
        ]);
      }

      // Swallow errors silently (no audio output, missing binary, etc.)
      this.currentProcess?.on('error', () => { this.currentProcess = null; });
      this.currentProcess?.on('exit', () => { this.currentProcess = null; });
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
