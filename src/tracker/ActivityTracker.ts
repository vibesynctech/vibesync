import * as vscode from 'vscode';
import { log } from '../utils/logger.js';

/**
 * Tracks total time spent in VS Code each day.
 * Persists daily totals to globalState so history survives restarts.
 *
 * Storage format in globalState:
 *   "vibeSync.dailySeconds" → { "2026-03-05": 32400, "2026-03-04": 28800, ... }
 *
 * Tracks "active" time: VS Code window is focused OR any editor/terminal activity.
 * Pauses when window loses focus or user is idle for 5+ minutes.
 */
export class ActivityTracker implements vscode.Disposable {
  private statusBarItem: vscode.StatusBarItem;
  private tickInterval: NodeJS.Timeout | null = null;
  private saveInterval: NodeJS.Timeout | null = null;
  private disposables: vscode.Disposable[] = [];

  private _onDataChanged = new vscode.EventEmitter<void>();
  readonly onDataChanged = this._onDataChanged.event;

  private todaySeconds = 0;
  private isActive = true;
  private lastActivityTime = Date.now();
  private currentDay = this.todayKey();

  private readonly TICK_MS = 1000;
  private readonly SAVE_MS = 30000;
  private readonly IDLE_TIMEOUT_MS = 300000; // 5 min idle = paused

  constructor(private readonly globalState: vscode.Memento) {
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left, 0
    );
    this.statusBarItem.command = 'vibeSync.focusTimeTracker';
    this.statusBarItem.tooltip = 'Click to see time history';
  }

  start(): void {
    const history = this.loadHistory();
    this.todaySeconds = history[this.currentDay] || 0;
    this.updateDisplay();
    this.statusBarItem.show();

    this.tickInterval = setInterval(() => this.tick(), this.TICK_MS);
    this.saveInterval = setInterval(() => this.save(), this.SAVE_MS);

    // Track window focus
    this.disposables.push(
      vscode.window.onDidChangeWindowState((e) => {
        this.isActive = e.focused;
        if (e.focused) this.lastActivityTime = Date.now();
      })
    );

    // Track any activity
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument(() => {
        this.lastActivityTime = Date.now();
      }),
      vscode.window.onDidChangeActiveTextEditor(() => {
        this.lastActivityTime = Date.now();
      }),
      vscode.window.onDidChangeTextEditorSelection(() => {
        this.lastActivityTime = Date.now();
      }),
      vscode.window.onDidOpenTerminal(() => {
        this.lastActivityTime = Date.now();
      }),
      vscode.window.onDidChangeActiveTerminal(() => {
        this.lastActivityTime = Date.now();
      })
    );

    log('[TimeTracker] Started');
  }

  /** Get today's tracked seconds */
  getTodaySeconds(): number {
    return this.todaySeconds;
  }

  /** Get full history (all days) — includes live today value */
  getHistory(): Record<string, number> {
    const history = this.loadHistory();
    history[this.currentDay] = this.todaySeconds;
    return history;
  }

  /** Get note for a specific day */
  getNoteForDay(dayKey: string): string {
    const notes = this.loadNotes();
    return notes[dayKey] || '';
  }

  /** Save note for a specific day */
  setNoteForDay(dayKey: string, note: string): void {
    const notes = this.loadNotes();
    if (note.trim()) {
      notes[dayKey] = note;
    } else {
      delete notes[dayKey]; // Don't store empty notes
    }
    void this.globalState.update('vibeSync.dailyNotes', notes);
    this._onDataChanged.fire();
    log(`[TimeTracker] Note saved for ${dayKey}`);
  }

  /** Get all notes (for sync export) */
  getAllNotes(): Record<string, string> {
    return this.loadNotes();
  }

  /** Import hours from remote sync — takes MAX per day */
  importHours(remote: Record<string, number>): void {
    const local = this.loadHistory();
    for (const [day, secs] of Object.entries(remote)) {
      local[day] = Math.max(local[day] || 0, secs);
    }
    // Update today's in-memory counter if remote has higher
    if (remote[this.currentDay] && remote[this.currentDay] > this.todaySeconds) {
      this.todaySeconds = remote[this.currentDay];
    }
    void this.globalState.update('vibeSync.dailySeconds', local);
    log('[TimeTracker] Imported hours from sync');
  }

  /** Import notes from remote sync — fills gaps (doesn't overwrite existing) */
  importNotes(remote: Record<string, string>): void {
    const local = this.loadNotes();
    let changed = false;
    for (const [day, note] of Object.entries(remote)) {
      if (!local[day] && note) {
        local[day] = note;
        changed = true;
      }
    }
    if (changed) {
      void this.globalState.update('vibeSync.dailyNotes', local);
      log('[TimeTracker] Imported notes from sync');
    }
  }

  private tick(): void {
    const today = this.todayKey();
    if (today !== this.currentDay) {
      this.save();
      this.currentDay = today;
      this.todaySeconds = 0;
    }

    const idle = Date.now() - this.lastActivityTime;
    if (this.isActive && idle < this.IDLE_TIMEOUT_MS) {
      this.todaySeconds++;
    }

    this.updateDisplay();
  }

  private updateDisplay(): void {
    const hrs = this.todaySeconds / 3600;
    this.statusBarItem.text = `$(clock) ${formatHrs(hrs)}`;
  }

  save(): void {
    const history = this.loadHistory();
    history[this.currentDay] = this.todaySeconds;
    // Keep max 90 days
    const keys = Object.keys(history).sort();
    while (keys.length > 90) {
      const oldest = keys.shift()!;
      delete history[oldest];
    }
    void this.globalState.update('vibeSync.dailySeconds', history);
    this._onDataChanged.fire();
  }

  dispose(): void {
    this.save();
    if (this.tickInterval) clearInterval(this.tickInterval);
    if (this.saveInterval) clearInterval(this.saveInterval);
    this.statusBarItem.dispose();
    this._onDataChanged.dispose();
    for (const d of this.disposables) d.dispose();
    log('[TimeTracker] Stopped');
  }

  /** Seed fake data for testing how the calendar looks */
  seedTestData(): void {
    const history = this.loadHistory();
    const notes = this.loadNotes();
    const sampleNotes = [
      'Refactored the auth module, fixed 3 bugs',
      'Paired with team on API design',
      'Deep work on calendar feature',
      'Code review + PR merges',
      'Built the new dashboard component',
      'Debugging session — found the race condition!',
      'Sprint planning + story grooming',
    ];
    const now = new Date();
    // Fill last 60 days with random hours (2-12 hrs), skip some weekends
    for (let i = 1; i <= 60; i++) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      const dayOfWeek = d.getDay(); // 0=Sun, 6=Sat
      // Skip ~half of weekends
      if ((dayOfWeek === 0 || dayOfWeek === 6) && Math.random() > 0.4) continue;
      const hrs = 2 + Math.random() * 10; // 2-12 hours
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      history[key] = Math.round(hrs * 3600);
      // Add a note ~30% of the time
      if (Math.random() < 0.3) {
        notes[key] = sampleNotes[Math.floor(Math.random() * sampleNotes.length)];
      }
    }
    void this.globalState.update('vibeSync.dailySeconds', history);
    void this.globalState.update('vibeSync.dailyNotes', notes);
    log('[TimeTracker] Seeded 60 days of test data + notes');
  }

  /** Clear all test/historical data */
  clearData(): void {
    void this.globalState.update('vibeSync.dailySeconds', {});
    void this.globalState.update('vibeSync.dailyNotes', {});
    this.todaySeconds = 0;
    this.updateDisplay();
    log('[TimeTracker] Cleared all data + notes');
  }

  private loadHistory(): Record<string, number> {
    return this.globalState.get<Record<string, number>>('vibeSync.dailySeconds', {});
  }

  private loadNotes(): Record<string, string> {
    return this.globalState.get<Record<string, string>>('vibeSync.dailyNotes', {});
  }

  private todayKey(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
}

/** Format hours compactly: 11 Hrs, 10.5 Hrs, 0.5 Hrs */
export function formatHrs(hrs: number): string {
  if (hrs < 0.1) return '0 Hrs';
  const rounded = Math.round(hrs * 2) / 2; // Round to nearest 0.5
  const str = rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1);
  return `${str} Hrs`;
}
