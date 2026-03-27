import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { StateMachine } from './StateMachine.js';
import { log, logError } from '../utils/logger.js';

/**
 * Watches Antigravity IDE's Gemini agent log file for API call patterns.
 *
 * Uses a "Gatekeeper + Heartbeat" pattern:
 * - "Requesting planner" is the GATEKEEPER — only this can OPEN an agent session.
 * - "streamGenerateContent" / "generateContent" is the HEARTBEAT — keeps the
 *   session alive, but only if a session is already open.
 * - If the state machine is in aiGenerating (burst detection), the heartbeat
 *   stays alive automatically (code is being written = agent is active).
 * - 3.5s of network silence = session closed → agent done.
 */
export class LogTailSignal implements vscode.Disposable {
  private logFilePath: string | null = null;
  private prevSize = 0;
  private agentSessionActive = false;
  private lastHeartbeatTime = 0;
  private silenceCheckInterval: NodeJS.Timeout | null = null;
  private watchDisposable: (() => void) | null = null;

  private readonly POLL_INTERVAL_MS = 200;
  private readonly SILENCE_THRESHOLD_MS = 10000; // 10s silence = session closed (busy lock safety)
  private readonly SILENCE_CHECK_MS = 500;

  constructor(
    private readonly stateMachine: StateMachine
  ) {}

  start(): void {
    this.logFilePath = this.findLatestLogFile();

    if (!this.logFilePath) {
      log('[LogTail] Could not find Antigravity log file. Agent state detection disabled.');
      return;
    }

    log(`[LogTail] Watching: ${this.logFilePath}`);

    try {
      const stat = fs.statSync(this.logFilePath);
      this.prevSize = stat.size;
    } catch {
      this.prevSize = 0;
    }

    const filePath = this.logFilePath;
    fs.watchFile(filePath, { interval: this.POLL_INTERVAL_MS }, (curr) => {
      this.onLogFileChanged(filePath, curr);
    });

    this.watchDisposable = () => {
      fs.unwatchFile(filePath);
    };

    this.silenceCheckInterval = setInterval(() => {
      this.checkSilence();
    }, this.SILENCE_CHECK_MS);
  }

  stop(): void {
    if (this.watchDisposable) {
      this.watchDisposable();
      this.watchDisposable = null;
    }
    if (this.silenceCheckInterval) {
      clearInterval(this.silenceCheckInterval);
      this.silenceCheckInterval = null;
    }
    this.agentSessionActive = false;
    this.logFilePath = null;
  }

  dispose(): void {
    this.stop();
  }

  // ─── Private ───────────────────────────────────────────────────────────────

  private onLogFileChanged(filePath: string, curr: fs.Stats): void {
    if (curr.size <= this.prevSize) {
      this.prevSize = curr.size;
      return;
    }

    // FILE PULSE: any log growth = agent is alive → keep busy lock
    this.stateMachine.onFilePulse();

    const stream = fs.createReadStream(filePath, {
      start: this.prevSize,
      end: curr.size - 1,
      encoding: 'utf8',
    });

    let buffer = '';
    stream.on('data', (chunk) => {
      buffer += String(chunk);
    });

    stream.on('end', () => {
      this.prevSize = curr.size;
      this.parseNewLines(buffer);
    });

    stream.on('error', (err) => {
      logError('[LogTail] Error reading log file', err);
      this.prevSize = curr.size;
    });
  }

  private parseNewLines(data: string): void {
    const lines = data.split('\n');
    let triggerPlanner = false;
    let triggerHeartbeat = false;
    let triggerError = false;
    let triggerHardFinish = false;

    for (const line of lines) {
      if (!line.trim()) continue;
      if (line.includes('Requesting planner')) triggerPlanner = true;
      if (line.includes('streamGenerateContent') || line.includes('generateContent')) triggerHeartbeat = true;
      // Early busy triggers — these files indicate agent is actively working
      if (line.includes('planner_generator.go') || line.includes('http_helpers.go')) triggerPlanner = true;
      if (line.includes('agent executor error') || line.includes('retryable api error')) {
        triggerError = true;
      }
      // Hard finish — ONLY "Command completed" (tightened to prevent false completions)
      if (line.includes('Command completed')) {
        triggerHardFinish = true;
      }
    }

    // Hard finish takes priority over everything
    if (triggerHardFinish) {
      log('[VIBE] 🏁 HARD FINISH (log evidence)');
      this.agentSessionActive = false;
      this.stateMachine.onAgentHardFinish();
      return;
    }

    if (triggerError) {
      log('[VIBE] 💥 API_CRASH');
      this.agentSessionActive = false;
      this.stateMachine.forceState('userDeclined');
      return;
    }

    if (triggerPlanner) {
      if (!this.agentSessionActive) {
        log('[VIBE] 🟢 Agent session OPENED (planner)');
        this.agentSessionActive = true;
      }
      this.lastHeartbeatTime = Date.now();
      this.stateMachine.onAgentApiCall();
    } else if (triggerHeartbeat && this.agentSessionActive) {
      this.lastHeartbeatTime = Date.now();
      // Only re-trigger if agent was in a "done" state
      if (this.stateMachine.currentState === 'aiWaitingForInput' || this.stateMachine.currentState === 'aiComplete') {
        this.stateMachine.onAgentApiCall();
      }
    }
  }

  private checkSilence(): void {
    if (!this.agentSessionActive) return;

    // If burst detection says AI is writing code, keep heartbeat alive
    const isGeneratingCode = this.stateMachine.currentState === 'aiGenerating';
    if (isGeneratingCode) {
      this.lastHeartbeatTime = Date.now();
      return;
    }

    const elapsed = Date.now() - this.lastHeartbeatTime;
    if (elapsed >= this.SILENCE_THRESHOLD_MS) {
      log(`[VIBE] 🔇 SILENCE ${elapsed}ms → session closed`);
      this.agentSessionActive = false;
      this.stateMachine.onAgentSilence();
    }
  }

  private findLatestLogFile(): string | null {
    const basePath = path.join(
      os.homedir(),
      'Library',
      'Application Support',
      'Antigravity',
      'logs'
    );

    if (!fs.existsSync(basePath)) {
      log('[LogTail] Antigravity logs folder not found');
      return null;
    }

    let sessionDirs: string[];
    try {
      sessionDirs = fs.readdirSync(basePath)
        .filter((name) => /^\d{8}T\d{6}$/.test(name))
        .sort()
        .reverse();
    } catch {
      return null;
    }

    if (sessionDirs.length === 0) {
      log('[LogTail] No session folders found');
      return null;
    }

    for (const sessionDir of sessionDirs.slice(0, 3)) {
      const sessionPath = path.join(basePath, sessionDir);

      let windowDirs: string[];
      try {
        windowDirs = fs.readdirSync(sessionPath)
          .filter((name) => name.startsWith('window'));
      } catch {
        continue;
      }

      let bestLog: { path: string; mtime: number } | null = null;

      for (const windowDir of windowDirs) {
        const logPath = path.join(
          sessionPath,
          windowDir,
          'exthost',
          'google.antigravity',
          'Antigravity.log'
        );

        try {
          const stat = fs.statSync(logPath);
          if (!bestLog || stat.mtimeMs > bestLog.mtime) {
            bestLog = { path: logPath, mtime: stat.mtimeMs };
          }
        } catch {
          // File doesn't exist in this window, try next
        }
      }

      if (bestLog) {
        return bestLog.path;
      }
    }

    log('[LogTail] No Antigravity.log found in any recent session');
    return null;
  }
}
