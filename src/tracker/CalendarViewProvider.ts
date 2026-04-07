import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ActivityTracker, formatHrs } from './ActivityTracker.js';
import { GitHubService } from './GitHubService.js';
import { log } from '../utils/logger.js';
import { resolveTheme, BUILTIN_MASCOT_PACKS } from '../themes/index.js';
import { Settings } from '../config/Settings.js';

/**
 * Sidebar webview — clock icon in the activity bar.
 * Shows compact interactive calendar with selectable days,
 * contextual stats (today/week/month relative to selected day),
 * Hours/Commits toggle, GitHub auth, and per-day notes with edit/save.
 */
export class CalendarViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private view: vscode.WebviewView | null = null;
  private currentYear: number;
  private currentMonth: number;
  private selectedDay: string; // e.g. "2026-03-05"
  private viewMode: 'hours' | 'commits' = 'hours';
  private commitData: Record<string, number> = {};
  private refreshInterval: NodeJS.Timeout | null = null;
  private isEditing = false;
  private lastVibeState: string | null = null;
  private disposables: vscode.Disposable[] = [];

  private readonly extensionPath: string;
  private readonly globalStoragePath: string;

  constructor(
    private readonly tracker: ActivityTracker,
    private readonly github: GitHubService,
    extensionPath: string,
    private readonly settings?: Settings,
    globalStoragePath?: string,
  ) {
    this.extensionPath = extensionPath;
    this.globalStoragePath = globalStoragePath ?? '';
    const now = new Date();
    this.currentYear = now.getFullYear();
    this.currentMonth = now.getMonth();
    this.selectedDay = this.todayKey();

    // Re-render when auth state changes
    this.disposables.push(
      this.github.onAuthChange(() => {
        if (this.github.isSignedIn()) {
          void this.loadCommits();
        } else {
          this.commitData = {};
          this.viewMode = 'hours';
        }
        this.refresh();
      })
    );
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    const mediaUri = vscode.Uri.joinPath(vscode.Uri.file(this.extensionPath), 'media');
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [mediaUri],
    };

    webviewView.webview.onDidReceiveMessage((msg) => {
      if (msg.type === 'navigate') {
        this.currentYear = msg.year;
        this.currentMonth = msg.month;
        this.refresh();
      } else if (msg.type === 'selectDay') {
        this.selectedDay = msg.dayKey;
        this.refresh();
      } else if (msg.type === 'saveNote') {
        this.isEditing = false;
        this.tracker.setNoteForDay(msg.dayKey, msg.note);
        this.refresh();
      } else if (msg.type === 'toggleViewMode') {
        this.viewMode = this.viewMode === 'hours' ? 'commits' : 'hours';
        this.refresh();
      } else if (msg.type === 'noteEditing') {
        this.isEditing = msg.editing;
      } else if (msg.type === 'signIn') {
        void this.github.signIn();
      } else if (msg.type === 'signOut') {
        void this.github.signOut();
      }
    });

    // Auto-refresh every 60s while visible (skip if user is editing notes)
    this.refreshInterval = setInterval(() => {
      if (!this.isEditing) this.refresh();
    }, 60000);

    webviewView.onDidDispose(() => {
      this.view = null;
      if (this.refreshInterval) {
        clearInterval(this.refreshInterval);
        this.refreshInterval = null;
      }
    });

    // Load commits if already signed in
    if (this.github.isSignedIn()) {
      void this.loadCommits();
    }

    this.refresh();
  }

  refresh(): void {
    if (!this.view) return;
    this.view.webview.html = this.buildHtml(this.currentYear, this.currentMonth);
    // Re-send last vibe state so mascot restores after HTML rebuild
    if (this.lastVibeState) {
      const state = this.lastVibeState;
      setTimeout(() => {
        this.view?.webview.postMessage({ type: 'vibeState', state });
      }, 300);
    }
  }

  /** Send vibe state to webview for mascot animation (no full HTML rebuild) */
  updateVibeState(state: string): void {
    this.lastVibeState = state;
    this.view?.webview.postMessage({ type: 'vibeState', state });
  }

  /** Forward mascot enabled/disabled config to webview */
  updateMascotConfig(enabled: boolean): void {
    this.view?.webview.postMessage({ type: 'mascotConfig', enabled });
  }

  dispose(): void {
    if (this.refreshInterval) clearInterval(this.refreshInterval);
    for (const d of this.disposables) d.dispose();
  }

  private async loadCommits(): Promise<void> {
    log('[Calendar] loadCommits() called, isSignedIn=' + this.github.isSignedIn());
    this.commitData = await this.github.fetchCommitHistory();
    log(`[Calendar] loadCommits() done, got ${Object.keys(this.commitData).length} days of commit data`);
    this.refresh();
  }

  private todayKey(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  private buildHtml(year: number, month: number): string {
    const history = this.tracker.getHistory();
    const todayKey = this.todayKey();
    const selectedKey = this.selectedDay;
    const isSignedIn = this.github.isSignedIn();
    const username = this.github.getUsername();
    const showCommits = this.viewMode === 'commits' && isSignedIn;
    const commits = this.commitData;

    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstDayOfWeek = (new Date(year, month, 1).getDay() + 6) % 7;
    const monthName = new Date(year, month, 1).toLocaleDateString('en-US', { month: 'long' });

    // ── Day cells ──
    const allNotes = this.tracker.getAllNotes();
    let dayCells = '';
    for (let i = 0; i < firstDayOfWeek; i++) {
      dayCells += '<div class="d empty"></div>';
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const isToday = key === todayKey;
      const isSelected = key === selectedKey;

      let value: number;
      let label: string;
      let intensity: number;

      if (showCommits) {
        const count = commits[key] || 0;
        value = count;
        label = count > 0 ? `${count}` : '';
        intensity = Math.min(count / 15, 1); // max intensity at 15 commits
      } else {
        const secs = history[key] || 0;
        const hrs = secs / 3600;
        value = secs;
        label = secs > 0 ? formatHrs(hrs) : '';
        intensity = Math.min(hrs / 10, 1);
      }

      const hasData = value > 0;
      const bgOpacity = hasData ? (0.2 + intensity * 0.5) : 0;

      let classes = 'd';
      if (isToday) classes += ' today';
      if (isSelected) classes += ' selected';
      if (hasData) classes += ' active';

      const tooltip = showCommits
        ? (hasData ? `${value} commits` : 'No commits')
        : (hasData ? formatHrs(value / 3600) : 'No data');

      const hasNote = !!allNotes[key];

      dayCells += `<div class="${classes}" style="--op:${bgOpacity}" title="${tooltip}" onclick="selectDay('${key}')">
        ${hasNote ? '<span class="note-dot"></span>' : ''}
        <span class="dn">${d}</span>
        ${label ? `<span class="dh">${label}</span>` : ''}
      </div>`;
    }

    // ── Selected day info ──
    const selectedDate = new Date(selectedKey + 'T12:00:00');
    const selectedDateStr = selectedDate.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
    const isSelectedToday = selectedKey === todayKey;

    // ── Stats (relative to selected day) ──
    const selectedDayOfWeek = (selectedDate.getDay() + 6) % 7;
    const weekMonday = new Date(selectedDate);
    weekMonday.setDate(selectedDate.getDate() - selectedDayOfWeek);
    weekMonday.setHours(0, 0, 0, 0);
    const weekSunday = new Date(weekMonday);
    weekSunday.setDate(weekMonday.getDate() + 6);
    weekSunday.setHours(23, 59, 59, 999);
    const selectedMonthPrefix = `${selectedDate.getFullYear()}-${String(selectedDate.getMonth() + 1).padStart(2, '0')}-`;

    let dayVal: string, weekVal: string, monthVal: string, heroVal: string;

    if (showCommits) {
      const dayCommits = commits[selectedKey] || 0;
      let weekCommits = 0, monthCommits = 0;
      for (const [key, count] of Object.entries(commits)) {
        if (key.startsWith(selectedMonthPrefix)) monthCommits += count;
        const d = new Date(key + 'T12:00:00');
        if (d >= weekMonday && d <= weekSunday) weekCommits += count;
      }
      heroVal = `${dayCommits}`;
      dayVal = `${dayCommits}`;
      weekVal = `${weekCommits}`;
      monthVal = `${monthCommits}`;
    } else {
      const selectedSecs = history[selectedKey] || 0;
      let weekTotal = 0, monthTotal = 0;
      for (const [key, secs] of Object.entries(history)) {
        if (key.startsWith(selectedMonthPrefix)) monthTotal += secs;
        const d = new Date(key + 'T12:00:00');
        if (d >= weekMonday && d <= weekSunday) weekTotal += secs;
      }
      heroVal = formatHrs(selectedSecs / 3600);
      dayVal = formatHrs(selectedSecs / 3600);
      weekVal = formatHrs(weekTotal / 3600);
      monthVal = formatHrs(monthTotal / 3600);
    }

    // Pass today's live seconds for the timer
    const todaySecsLive = isSelectedToday && !showCommits ? (history[todayKey] || 0) : 0;



    // ── Notes ──
    const note = this.tracker.getNoteForDay(selectedKey);
    const escapedNote = this.escapeHtml(note);

    // Nav
    let prevYear = year, prevMonth = month - 1;
    if (prevMonth < 0) { prevMonth = 11; prevYear--; }
    let nextYear = year, nextMonth = month + 1;
    if (nextMonth > 11) { nextMonth = 0; nextYear++; }

    // Webview asset URIs
    const webview = this.view!.webview;
    const nonce = this.getNonce();
    const cspSource = webview.cspSource;
    const mascotPath = vscode.Uri.joinPath(vscode.Uri.file(this.extensionPath), 'media', 'mascot');
    const lottieUri = webview.asWebviewUri(vscode.Uri.joinPath(mascotPath, 'lottie-light.min.js'));
    const mascotCssUri = webview.asWebviewUri(vscode.Uri.joinPath(mascotPath, 'mascot.css'));
    const mascotJsUri = webview.asWebviewUri(vscode.Uri.joinPath(mascotPath, 'mascot.js'));

    // Inline animation JSON data
    const thinkingAnim = this.readAnimationData('thinking');
    const needsInputAnim = this.readAnimationData('needsInput');
    const completeAnim = this.readAnimationData('complete');

    // Resolve theme colors for mascot labels
    const themeId = this.settings?.theme ?? vscode.workspace.getConfiguration('vibeSync').get<string>('theme', 'default');
    const customThemes = this.settings?.getCustomThemes() ?? [];
    const theme = resolveTheme(themeId, customThemes);
    const mascotColors = {
      thinking: this.hsbToHex(theme.states.aiThinking.hue ?? 240, theme.states.aiThinking.saturation ?? 100, theme.states.aiThinking.brightness),
      needsInput: this.hsbToHex(theme.states.aiNeedsInput.hue ?? 0, theme.states.aiNeedsInput.saturation ?? 100, theme.states.aiNeedsInput.brightness),
      complete: this.hsbToHex(theme.states.aiComplete.hue ?? 120, theme.states.aiComplete.saturation ?? 100, theme.states.aiComplete.brightness),
    };

    return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src ${cspSource} 'unsafe-inline'; img-src ${cspSource} data:; font-src ${cspSource};">
<link rel="stylesheet" href="${mascotCssUri}">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  html, body {
    height: 100%;
    overflow: hidden;
  }
  body {
    font-family: var(--vscode-font-family, -apple-system, system-ui, sans-serif);
    color: var(--vscode-foreground);
    background: var(--vscode-sideBar-background, var(--vscode-editor-background));
    padding: 12px 10px;
    user-select: none;
    display: flex;
    flex-direction: column;
    overflow-y: auto;
  }

  /* ── Auth bar ── */
  .auth-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 8px;
    margin-bottom: 8px;
    border-radius: 6px;
    background: rgba(255,255,255,0.03);
    border: 1px solid var(--vscode-widget-border, rgba(255,255,255,0.06));
    flex-shrink: 0;
  }
  .auth-bar .auth-left {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 10px;
    opacity: 0.7;
  }
  .auth-bar .auth-left .auth-dot {
    width: 6px; height: 6px;
    border-radius: 50%;
    background: var(--vscode-charts-green, #4ec94e);
    flex-shrink: 0;
  }
  .auth-bar .auth-left .username {
    font-weight: 600;
    opacity: 1;
  }
  .auth-signin-btn {
    display: flex;
    align-items: center;
    gap: 5px;
    background: var(--vscode-button-background, #007acc);
    color: var(--vscode-button-foreground, #fff);
    border: none;
    font-size: 10px;
    font-weight: 600;
    padding: 4px 10px;
    border-radius: 4px;
    cursor: pointer;
    transition: background 0.15s;
    width: 100%;
    justify-content: center;
  }
  .auth-signin-btn:hover {
    background: var(--vscode-button-hoverBackground, #005fa3);
  }
  .auth-signout-btn {
    background: none;
    border: none;
    color: var(--vscode-foreground);
    font-size: 9px;
    opacity: 0.4;
    cursor: pointer;
    padding: 2px 4px;
    transition: opacity 0.15s;
  }
  .auth-signout-btn:hover { opacity: 0.8; }

  /* ── View mode toggle ── */
  .view-toggle {
    display: flex;
    align-items: center;
    gap: 2px;
    background: rgba(255,255,255,0.04);
    border-radius: 4px;
    padding: 1px;
    border: 1px solid var(--vscode-widget-border, rgba(255,255,255,0.08));
  }
  .view-toggle button {
    background: none;
    border: none;
    color: var(--vscode-foreground);
    font-size: 9px;
    font-weight: 500;
    padding: 3px 8px;
    border-radius: 3px;
    cursor: pointer;
    opacity: 0.45;
    transition: all 0.15s;
  }
  .view-toggle button.active {
    background: rgba(78, 201, 78, 0.15);
    opacity: 1;
    font-weight: 700;
    color: var(--vscode-charts-green, #4ec94e);
  }
  .view-toggle button:hover:not(.active) { opacity: 0.7; }

  /* ── Calendar header ── */
  .hdr {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
    flex-shrink: 0;
  }
  .hdr .ttl { font-size: 12px; font-weight: 600; opacity: 0.85; }
  .hdr button {
    background: none;
    border: none;
    color: var(--vscode-foreground);
    cursor: pointer;
    opacity: 0.5;
    font-size: 10px;
    padding: 4px 8px;
    border-radius: 4px;
    transition: opacity 0.15s, background 0.15s;
  }
  .hdr button:hover {
    opacity: 1;
    background: var(--vscode-toolbar-hoverBackground, rgba(255,255,255,0.08));
  }

  /* ── Weekday labels ── */
  .wk {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 1px;
    margin-bottom: 3px;
    flex-shrink: 0;
  }
  .wk span {
    text-align: center;
    font-size: 9px;
    font-weight: 600;
    opacity: 0.35;
    text-transform: uppercase;
    padding: 2px 0;
  }

  /* ── Day grid ── */
  .cal {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 2px;
    margin-bottom: 14px;
    flex-shrink: 0;
  }
  .d {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    padding: 3px 0;
    min-height: 32px;
    cursor: pointer;
    transition: background 0.15s, outline-color 0.15s, transform 0.1s;
  }
  .d:hover:not(.empty) {
    transform: scale(1.08);
    background: rgba(255,255,255,0.06);
  }
  .d.empty { background: none; cursor: default; }
  .d:not(.empty) {
    background: rgba(78, 201, 78, var(--op, 0));
  }
  .d.today {
    outline: 1.5px solid var(--vscode-focusBorder, #007fd4);
    outline-offset: -1px;
  }
  .d.selected {
    outline: 2px solid var(--vscode-charts-green, #4ec94e);
    outline-offset: -1px;
    background: rgba(78, 201, 78, calc(var(--op, 0) + 0.12));
  }
  .d.today.selected {
    outline: 2px solid var(--vscode-charts-green, #4ec94e);
  }
  .dn {
    font-size: 10px;
    font-weight: 500;
    opacity: 0.5;
    line-height: 1;
  }
  .d.active .dn { opacity: 0.9; }
  .d.today .dn { opacity: 1; font-weight: 700; }
  .d.selected .dn { opacity: 1; font-weight: 700; }
  .dh {
    font-size: 7px;
    font-weight: 600;
    color: var(--vscode-charts-green, #4ec94e);
    line-height: 1;
    margin-top: 1px;
    opacity: 0.85;
  }
  .note-dot {
    position: absolute;
    top: 3px;
    right: 3px;
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: #e8a838;
    opacity: 0.85;
  }

  /* ── Selected day block ── */
  .timer-wrapper { position: relative; }
  .timer-toggle {
    position: absolute;
    top: 10px;
    right: 10px;
    background: none;
    border: none;
    cursor: pointer;
    opacity: 0.3;
    font-size: 13px;
    padding: 2px 4px;
    color: var(--vscode-foreground);
    z-index: 1;
    transition: opacity 0.2s;
  }
  .timer-toggle:hover { opacity: 0.7; }
  .timer-content {
    overflow: hidden;
    transition: max-height 0.3s ease, opacity 0.3s ease;
    max-height: 300px;
    opacity: 1;
  }
  .timer-collapsed .timer-content {
    max-height: 0;
    opacity: 0;
  }
  .timer-collapsed .timer-toggle {
    position: relative;
    top: auto;
    right: auto;
    display: block;
    margin: 6px auto;
    opacity: 0.4;
  }
  .selected-block {
    text-align: center;
    padding: 14px 0 12px;
    border-top: 1px solid var(--vscode-widget-border, rgba(255,255,255,0.08));
    flex-shrink: 0;
  }
  .selected-label {
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 1.5px;
    opacity: 0.4;
    margin-bottom: 5px;
  }
  .selected-value {
    font-size: 28px;
    font-weight: 700;
    color: var(--vscode-charts-green, #4ec94e);
    line-height: 1.1;
  }
  .selected-unit {
    font-size: 12px;
    font-weight: 400;
    opacity: 0.5;
    margin-left: 2px;
  }
  .selected-sub {
    font-size: 9px;
    opacity: 0.3;
    margin-top: 3px;
  }

  /* ── Week/Month totals ── */
  .totals {
    border-top: 1px solid var(--vscode-widget-border, rgba(255,255,255,0.08));
    padding-top: 10px;
    display: flex;
    justify-content: space-around;
    flex-shrink: 0;
  }
  .tot { text-align: center; }
  .tot-label {
    font-size: 8px;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    opacity: 0.35;
    margin-bottom: 3px;
  }
  .tot-val {
    font-size: 14px;
    font-weight: 600;
    opacity: 0.9;
  }

  /* ── Notes section ── */
  .notes-section {
    border-top: 1px solid var(--vscode-widget-border, rgba(255,255,255,0.08));
    margin-top: 12px;
    padding-top: 10px;
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .notes-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 6px;
    flex-shrink: 0;
  }
  .notes-title {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    opacity: 0.5;
  }
  .notes-btn {
    background: none;
    border: 1px solid var(--vscode-button-border, rgba(255,255,255,0.12));
    color: var(--vscode-foreground);
    font-size: 9px;
    padding: 2px 8px;
    border-radius: 3px;
    cursor: pointer;
    opacity: 0.6;
    transition: opacity 0.15s, background 0.15s;
  }
  .notes-btn:hover {
    opacity: 1;
    background: var(--vscode-toolbar-hoverBackground, rgba(255,255,255,0.08));
  }
  .notes-btn.save-btn {
    background: var(--vscode-button-background, #007acc);
    color: var(--vscode-button-foreground, #fff);
    border: none;
    opacity: 1;
    font-weight: 600;
  }
  .notes-btn.save-btn:hover {
    background: var(--vscode-button-hoverBackground, #005fa3);
  }
  .notes-display {
    font-size: 11px;
    line-height: 1.6;
    opacity: 0.7;
    word-break: break-word;
    flex: 1;
    overflow-y: auto;
    padding-right: 4px;
  }
  .notes-display.empty {
    font-style: italic;
    opacity: 0.3;
  }
  /* ── Rendered markdown styles ── */
  .notes-display h1 { font-size: 15px; font-weight: 700; margin: 8px 0 4px; opacity: 0.95; }
  .notes-display h2 { font-size: 13px; font-weight: 700; margin: 6px 0 3px; opacity: 0.9; }
  .notes-display h3 { font-size: 12px; font-weight: 600; margin: 5px 0 2px; opacity: 0.85; }
  .notes-display p { margin: 4px 0; }
  .notes-display strong { font-weight: 700; opacity: 1; }
  .notes-display em { font-style: italic; }
  .notes-display code {
    background: rgba(255,255,255,0.06);
    padding: 1px 4px;
    border-radius: 3px;
    font-family: var(--vscode-editor-font-family, 'Menlo', monospace);
    font-size: 10px;
  }
  .notes-display pre {
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 4px;
    padding: 6px 8px;
    margin: 6px 0;
    overflow-x: auto;
  }
  .notes-display pre code {
    background: none;
    padding: 0;
  }
  .notes-display ul, .notes-display ol {
    margin: 4px 0;
    padding-left: 18px;
  }
  .notes-display li { margin: 2px 0; }
  .notes-display li.task-item { list-style: none; margin-left: -18px; }
  .notes-display li.task-item input[type="checkbox"] { margin-right: 5px; }
  .notes-display blockquote {
    border-left: 3px solid var(--vscode-charts-green, #4ec94e);
    margin: 6px 0;
    padding: 2px 10px;
    opacity: 0.7;
  }
  .notes-display hr {
    border: none;
    border-top: 1px solid var(--vscode-widget-border, rgba(255,255,255,0.1));
    margin: 8px 0;
  }
  .notes-edit-wrapper {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .notes-textarea {
    width: 100%;
    flex: 1;
    min-height: 120px;
    background: var(--vscode-input-background, rgba(255,255,255,0.05));
    color: var(--vscode-input-foreground, var(--vscode-foreground));
    border: 1px solid var(--vscode-input-border, rgba(255,255,255,0.12));
    border-radius: 4px;
    font-family: var(--vscode-editor-font-family, 'Menlo', monospace);
    font-size: 11px;
    line-height: 1.5;
    padding: 8px 10px;
    resize: none;
    outline: none;
  }
  .notes-textarea:focus {
    border-color: var(--vscode-focusBorder, #007fd4);
  }
  .notes-edit-actions {
    display: flex;
    gap: 6px;
    margin-top: 8px;
    justify-content: flex-end;
    flex-shrink: 0;
  }
  .hidden { display: none !important; }

  /* mascot styles loaded via <link> tag above */
</style>
</head>
<body>
  <!-- Auth bar -->
  ${isSignedIn ? `
  <div class="auth-bar">
    <div class="auth-left">
      <span class="auth-dot"></span>
      <span class="username">${this.escapeHtml(username)}</span>
    </div>
    <div style="display:flex;align-items:center;gap:6px;">
      <div class="view-toggle">
        <button class="${this.viewMode === 'hours' ? 'active' : ''}" onclick="toggleView()">Hours</button>
        <button class="${this.viewMode === 'commits' ? 'active' : ''}" onclick="toggleView()">Commits</button>
      </div>
      <button class="auth-signout-btn" onclick="signOut()" title="Sign out">✕</button>
    </div>
  </div>
  ` : `
  <div class="auth-bar">
    <button class="auth-signin-btn" onclick="signIn()">☁ Sign in with GitHub</button>
  </div>
  `}

  <div class="hdr">
    <button onclick="nav(${prevYear},${prevMonth})">&#9664;</button>
    <span class="ttl">${monthName} ${year}</span>
    <button onclick="nav(${nextYear},${nextMonth})">&#9654;</button>
  </div>

  <div class="wk">
    <span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span><span>S</span>
  </div>

  <div class="cal">${dayCells}</div>

  <div class="timer-wrapper" id="timerWrapper">
    <button class="timer-toggle" id="timerToggle" title="Collapse/expand times"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button>
    <div class="timer-content">
    <div class="selected-block">
      <div class="selected-label">${isSelectedToday ? 'Today' : selectedDate.toLocaleDateString('en-US', { weekday: 'long' })}</div>
      <div class="selected-value" id="heroVal">${heroVal}${showCommits ? '<span class="selected-unit">commits</span>' : ''}</div>
      <div class="selected-sub">${selectedDateStr}</div>
    </div>

    <div class="totals">
    <div class="tot">
      <div class="tot-label">${isSelectedToday ? 'Today' : 'Day'}</div>
      <div class="tot-val" id="dayVal">${dayVal}</div>
    </div>
    <div class="tot">
      <div class="tot-label">Week</div>
      <div class="tot-val">${weekVal}</div>
    </div>
    <div class="tot">
      <div class="tot-label">Month</div>
      <div class="tot-val">${monthVal}</div>
    </div>
  </div>
  </div><!-- /timer-content -->
  </div><!-- /timer-wrapper -->

  <!-- Notes section -->
  <div class="notes-section">
    <div class="notes-header">
      <span class="notes-title">Notes</span>
      <button class="notes-btn" id="editBtn" onclick="toggleEdit()">Edit</button>
    </div>

    <!-- View mode (markdown rendered) -->
    <div id="noteView" class="notes-display ${note ? '' : 'empty'}"></div>

    <!-- Edit mode (hidden by default, fills remaining space) -->
    <div id="noteEdit" class="notes-edit-wrapper hidden">
      <textarea class="notes-textarea" id="noteTextarea">${escapedNote}</textarea>
      <div class="notes-edit-actions">
        <button class="notes-btn" onclick="cancelEdit()">Cancel</button>
        <button class="notes-btn save-btn" onclick="saveNote()">Save</button>
      </div>
    </div>
  </div>

  <div class="mascot-stage" id="mascotStage">
    <div id="mascotContainer"></div>
    <div class="mascot-ground"></div>
    <div class="mascot-label" id="mascotLabel"></div>
  </div>

  <script nonce="${nonce}">
    window.__MASCOT_ANIMS = {
      thinking: ${thinkingAnim},
      needsInput: ${needsInputAnim},
      complete: ${completeAnim}
    };
    window.__MASCOT_COLORS = ${JSON.stringify(mascotColors)};
  </script>
  <script nonce="${nonce}" src="${lottieUri}"></script>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const selectedDayKey = '${selectedKey}';
    const rawNote = ${JSON.stringify(note)};
    const isToday = ${isSelectedToday};
    const isCommitsView = ${showCommits};
    var todaySecs = ${todaySecsLive};
    ${this.getMarkdownRendererJs()}
  </script>
  <script nonce="${nonce}" src="${mascotJsUri}"></script>
</body>
</html>`;
  }

  /** Returns the client-side JS for md rendering + note interaction */
  private getMarkdownRendererJs(): string {
    const js = [
      'function renderMarkdown(src) {',
      '  if (!src) return "";',
      '  var html = "";',
      '  var lines = src.split("\\n");',
      '  var inCodeBlock = false, codeContent = "", inList = null;',
      '  function closeList() { if (inList) { html += "</" + inList + ">"; inList = null; } }',
      '  function esc(s) { return s.replace(/&/g,"\\x26amp;").replace(/</g,"\\x26lt;").replace(/>/g,"\\x26gt;"); }',
      '  function fmt(t) {',
      '    return t',
      '      .replace(/`([^`]+)`/g, "<code>$1</code>")',
      '      .replace(/\\*\\*\\*(.+?)\\*\\*\\*/g, "<strong><em>$1</em></strong>")',
      '      .replace(/\\*\\*(.+?)\\*\\*/g, "<strong>$1</strong>")',
      '      .replace(/\\*(.+?)\\*/g, "<em>$1</em>")',
      '      .replace(/__(.+?)__/g, "<strong>$1</strong>")',
      '      .replace(/_(.+?)_/g, "<em>$1</em>")',
      '      .replace(/~~(.+?)~~/g, "<del>$1</del>");',
      '  }',
      '  for (var i = 0; i < lines.length; i++) {',
      '    var line = lines[i];',
      '    if (line.trim().indexOf("```") === 0) {',
      '      if (inCodeBlock) { html += "<pre><code>" + esc(codeContent) + "</code></pre>"; codeContent = ""; inCodeBlock = false; }',
      '      else { closeList(); inCodeBlock = true; }',
      '      continue;',
      '    }',
      '    if (inCodeBlock) { codeContent += (codeContent ? "\\n" : "") + line; continue; }',
      '    if (!line.trim()) { closeList(); continue; }',
      '    if (/^(-{3,}|\\*{3,}|_{3,})$/.test(line.trim())) { closeList(); html += "<hr>"; continue; }',
      '    var hm = line.match(/^(#{1,3})\\s+(.+)/);',
      '    if (hm) { closeList(); html += "<h"+hm[1].length+">" + fmt(hm[2]) + "</h"+hm[1].length+">"; continue; }',
      '    if (line.trim().charAt(0) === ">") { closeList(); html += "<blockquote>" + fmt(line.trim().slice(1).trim()) + "</blockquote>"; continue; }',
      '    var cm = line.match(/^\\s*[-*]\\s+\\[([ xX])\\]\\s+(.+)/);',
      '    if (cm) {',
      '      if (inList !== "ul") { closeList(); inList = "ul"; html += "<ul>"; }',
      '      html += "<li class=\\"task-item\\"><input type=\\"checkbox\\"" + (cm[1]!==" "?" checked disabled":" disabled") + ">" + fmt(cm[2]) + "</li>";',
      '      continue;',
      '    }',
      '    var um = line.match(/^\\s*[-*+]\\s+(.+)/);',
      '    if (um) { if (inList !== "ul") { closeList(); inList = "ul"; html += "<ul>"; } html += "<li>" + fmt(um[1]) + "</li>"; continue; }',
      '    var om = line.match(/^\\s*\\d+[.)\\]]\\s+(.+)/);',
      '    if (om) { if (inList !== "ol") { closeList(); inList = "ol"; html += "<ol>"; } html += "<li>" + fmt(om[1]) + "</li>"; continue; }',
      '    closeList(); html += "<p>" + fmt(line) + "</p>";',
      '  }',
      '  if (inCodeBlock) { html += "<pre><code>" + esc(codeContent) + "</code></pre>"; }',
      '  closeList(); return html;',
      '}',
      '',
      'var noteViewEl = document.getElementById("noteView");',
      'if (rawNote) { noteViewEl.innerHTML = renderMarkdown(rawNote); }',
      'else { noteViewEl.innerHTML = "No notes for this day...<br><span style=\\"opacity:0.8;font-size:9px\\">Tip: Sound effects can be turned off in Settings</span>"; }',
      '',
      'function nav(y, m) { vscode.postMessage({ type: "navigate", year: y, month: m }); }',
      'function selectDay(dk) { vscode.postMessage({ type: "selectDay", dayKey: dk }); }',
      'function toggleView() { vscode.postMessage({ type: "toggleViewMode" }); }',
      'function signIn() { vscode.postMessage({ type: "signIn" }); }',
      'function signOut() { vscode.postMessage({ type: "signOut" }); }',
      '',
      'function toggleEdit() {',
      '  document.getElementById("noteView").classList.add("hidden");',
      '  document.getElementById("noteEdit").classList.remove("hidden");',
      '  document.getElementById("editBtn").classList.add("hidden");',
      '  var ta = document.getElementById("noteTextarea");',
      '  ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);',
      '  vscode.postMessage({ type: "noteEditing", editing: true });',
      '}',
      'function cancelEdit() {',
      '  document.getElementById("noteView").classList.remove("hidden");',
      '  document.getElementById("noteEdit").classList.add("hidden");',
      '  document.getElementById("editBtn").classList.remove("hidden");',
      '  vscode.postMessage({ type: "noteEditing", editing: false });',
      '}',
      'function saveNote() {',
      '  var note = document.getElementById("noteTextarea").value;',
      '  vscode.postMessage({ type: "saveNote", dayKey: selectedDayKey, note: note });',
      '}',
      '',
      '// ── Live timer for today ──',
      'function fmtTimer(s) {',
      '  var h = Math.floor(s / 3600);',
      '  var m = Math.floor((s % 3600) / 60);',
      '  var sec = s % 60;',
      '  return h + ":" + (m < 10 ? "0" : "") + m + ":" + (sec < 10 ? "0" : "") + sec;',
      '}',
      'if (isToday && !isCommitsView) {',
      '  var heroEl = document.getElementById("heroVal");',
      '  var dayEl = document.getElementById("dayVal");',
      '  if (heroEl) heroEl.textContent = fmtTimer(todaySecs);',
      '  if (dayEl) dayEl.textContent = fmtTimer(todaySecs);',
      '  setInterval(function() {',
      '    todaySecs++;',
      '    if (heroEl) heroEl.textContent = fmtTimer(todaySecs);',
      '    if (dayEl) dayEl.textContent = fmtTimer(todaySecs);',
      '  }, 1000);',
      '}',
      '',
      '// ── Timer collapse toggle ──',
      '(function() {',
      '  var eyeOpen = \'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>\';',
      '  var eyeOff = \'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>\';',
      '  var wrapper = document.getElementById("timerWrapper");',
      '  var btn = document.getElementById("timerToggle");',
      '  var state = vscode.getState() || {};',
      '  if (state.timerCollapsed) { wrapper.classList.add("timer-collapsed"); btn.innerHTML = eyeOff; }',
      '  btn.addEventListener("click", function() {',
      '    var collapsed = wrapper.classList.toggle("timer-collapsed");',
      '    btn.innerHTML = collapsed ? eyeOff : eyeOpen;',
      '    var s = vscode.getState() || {};',
      '    s.timerCollapsed = collapsed;',
      '    vscode.setState(s);',
      '  });',
      '})();',
      '',
      '// mascot loaded via external <script> tag',
    ];
    return js.join('\n    ');
  }

  /** Read Lottie animation JSON from the active mascot pack */
  private readAnimationData(name: string): string {
    const packId = this.settings?.mascotTheme ?? 'default';

    // Check built-in packs first
    const builtin = BUILTIN_MASCOT_PACKS.find(p => p.id === packId);
    if (builtin) {
      try {
        const filePath = path.join(this.extensionPath, 'media', 'mascot', 'animations', builtin.directory, `${name}.json`);
        return fs.readFileSync(filePath, 'utf-8');
      } catch { /* fall through */ }
    }

    // Check custom packs in globalStorage
    if (this.globalStoragePath) {
      try {
        const filePath = path.join(this.globalStoragePath, 'mascotPacks', packId, `${name}.json`);
        return fs.readFileSync(filePath, 'utf-8');
      } catch { /* fall through */ }
    }

    // Fallback to default
    try {
      const filePath = path.join(this.extensionPath, 'media', 'mascot', 'animations', 'default', `${name}.json`);
      return fs.readFileSync(filePath, 'utf-8');
    } catch {
      return '{}';
    }
  }

  /** Generate a random nonce for CSP script tags */
  private getNonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let nonce = '';
    for (let i = 0; i < 32; i++) {
      nonce += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return nonce;
  }

  /** Convert HSB (hue 0-360, saturation 0-100, brightness 0-100) to hex color */
  private hsbToHex(h: number, s: number, b: number): string {
    s /= 100; b /= 100;
    const k = (n: number) => (n + h / 60) % 6;
    const f = (n: number) => b * (1 - s * Math.max(0, Math.min(k(n), 4 - k(n), 1)));
    const r = Math.round(f(5) * 255);
    const g = Math.round(f(3) * 255);
    const bl = Math.round(f(1) * 255);
    return '#' + [r, g, bl].map(v => v.toString(16).padStart(2, '0')).join('');
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}
