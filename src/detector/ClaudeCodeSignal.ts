import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { StateMachine } from './StateMachine.js';
import { log, logError } from '../utils/logger.js';

/**
 * Watches Claude Code CLI's JSONL conversation files for AI state changes.
 *
 * Claude Code writes structured JSONL to:
 *   ~/.claude/projects/<project-slug>/<session-id>.jsonl
 *
 * Each line is a JSON object with `type` (assistant|user|progress) and
 * `message.content[]` containing blocks of type: thinking, text, tool_use, tool_result.
 *
 * State mapping:
 *   thinking                           → onAgentApiCall()    → aiThinking (blue pulse)
 *   tool_use (Write/Edit/NotebookEdit) → onTextChange()      → aiGenerating (purple)
 *   tool_use (AskUserQuestion)         → onAgentNeedsInput() → aiNeedsInput (RED pulse)
 *   tool_use (other: Bash/Read/etc.)   → onAgentApiCall()    → aiThinking (blue pulse)
 *   text (assistant)                   → onFilePulse()       → keeps busy alive
 *   tool_result after aiNeedsInput     → onAgentApiCall()    → aiThinking (blue pulse)
 *   tool_result (normal)               → onFilePulse()       → keeps busy alive
 *   progress                           → onFilePulse()       → keeps busy alive
 *   3s silence (text-only response)    → onAgentHardFinish() → green flash → idle
 *   5s silence (after tool activity)   → onAgentHardFinish() → green flash → idle
 *
 * Key design: Claude's API streaming doesn't write JSONL until a complete message
 * arrives. Thinking blocks provide heartbeats during long pauses, so 5s silence is safe.
 * We also track pending tool_use/tool_result pairs to never false-trigger during subagents.
 */
export class ClaudeCodeSignal implements vscode.Disposable {
  private jsonlFilePath: string | null = null;
  private prevSize = 0;
  private lineBuffer = '';
  private watchDisposable: (() => void) | null = null;

  private agentSessionActive = false;
  private lastActivityTime = 0;
  private pendingToolUses = 0; // track tool_use without matching tool_result
  private lastToolUseTime = 0; // when the most recent tool_use was sent
  private lastPendingToolName = ''; // name of the most recent pending tool_use
  private permissionAlerted = false; // already triggered aiNeedsInput for this tool_use

  private lastAssistantHadTextOnly = false; // last assistant message was text-only (no tool_use) → possible completion
  private expectingMore = false; // last assistant message had tool_use → Claude WILL send more after tool_result
  private sessionHadToolUse = false; // has ANY tool_use occurred in this session? (multi-step task detection)
  private silenceCheckInterval: NodeJS.Timeout | null = null;
  private fileCheckInterval: NodeJS.Timeout | null = null;

  // Tools that mean Claude is writing/editing code → aiGenerating (purple)
  private static readonly CODE_TOOLS = new Set(['Write', 'Edit', 'NotebookEdit']);

  // Tools that mean Claude is asking the user something → aiNeedsInput (RED ALERT)
  private static readonly INPUT_TOOLS = new Set(['AskUserQuestion']);

  // Tools that may need user permission approval (show allow/deny prompt)
  // Bash, Write, Edit, NotebookEdit can all trigger allow/deny prompts.
  // Read/Grep/Glob/Task are auto-approved and should NOT trigger false RED alerts.
  private static readonly PERMISSION_TOOLS = new Set(['Bash', 'Write', 'Edit', 'NotebookEdit']);

  // Detects intermediate text like "I'll write", "let me create", "going to edit"
  // These phrases signal Claude is about to use a tool → streaming gap incoming.
  private static readonly INTENT_PATTERN = /\b(?:let me|I'll|I will|going to|I need to|about to|now|next|let's|lets|then)\s+(?:write|create|edit|read|run|delete|update|modify|build|install|add|remove|fix|check|execute|search|look|open|save|generate|test|verify|rewrite|strengthen|refactor|replace|rename|move|implement|configure|set|change|clean|convert|adjust|patch|merge|copy|extract|import|export|migrate|format|lint|sort|swap|wrap|unwrap|comment|disable|hide|revert|undo|restore)\b/i;

  private readonly POLL_INTERVAL_MS = 200;
  private readonly SILENCE_THRESHOLD_MS = 6000; // 6s — thinking blocks provide heartbeats
  private readonly SILENCE_FAST_MS = 4000; // 4s — when last message was text-only (likely final response)
  private readonly SILENCE_CHECK_MS = 500;
  private readonly FILE_CHECK_MS = 5000;
  private readonly PERMISSION_STALL_BASH_MS = 2000; // 2s — if Bash hasn't started by now, user is seeing permission prompt
  private readonly PERMISSION_STALL_CODE_MS = 1000; // 1s for Write/Edit — permission prompt appears instantly

  // Lock file for multi-window coordination — only one window controls the bulb at a time
  private static readonly LOCK_FILE = path.join(os.homedir(), '.claude', '.vibesync-owner');

  constructor(private readonly stateMachine: StateMachine) {}

  private static readonly STALE_MS = 60_000; // 1 minute — lock is stale if timestamp older than this
  private static readonly KEEPALIVE_MS = 5_000; // refresh lock timestamp every 5s
  private lastKeepAliveTime = 0;

  // ─── Multi-window lock ──────────────────────────────────────────────────────

  /** Read lock file → { owner workspace path, timestamp } or null */
  private readLock(): { owner: string; ts: number } | null {
    try {
      const content = fs.readFileSync(ClaudeCodeSignal.LOCK_FILE, 'utf-8');
      const lines = content.trim().split('\n');
      if (lines.length >= 2) {
        return { owner: lines[0], ts: parseInt(lines[1], 10) };
      }
    } catch { /* file doesn't exist or unreadable */ }
    return null;
  }

  /** Write lock file with workspace path + current timestamp */
  private writeLock(): void {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders) return;
    try {
      fs.writeFileSync(ClaudeCodeSignal.LOCK_FILE, `${folders[0].uri.fsPath}\n${Date.now()}`);
    } catch { /* ignore */ }
  }

  /** Claim bulb ownership if no other window is active (or lock is stale) */
  private claimOwnership(): void {
    const lock = this.readLock();
    if (lock) {
      const age = Date.now() - lock.ts;
      const folders = vscode.workspace.workspaceFolders;
      const isOurs = folders && lock.owner === folders[0].uri.fsPath;
      if (!isOurs && age < ClaudeCodeSignal.STALE_MS) {
        return; // another window is actively using the bulb
      }
      if (!isOurs) {
        log(`[ClaudeCode] Stale lock (${Math.round(age / 1000)}s old) — overriding`);
      }
    }
    this.writeLock();
    this.lastKeepAliveTime = Date.now();
    log('[ClaudeCode] Claimed bulb ownership');
  }

  /** Refresh the lock timestamp (keep-alive) */
  private refreshLock(): void {
    const now = Date.now();
    if (now - this.lastKeepAliveTime < ClaudeCodeSignal.KEEPALIVE_MS) return;
    this.lastKeepAliveTime = now;
    const lock = this.readLock();
    const folders = vscode.workspace.workspaceFolders;
    if (lock && folders && lock.owner === folders[0].uri.fsPath) {
      this.writeLock();
    }
  }

  /** Release bulb ownership if this window owns it */
  private releaseOwnership(): void {
    try {
      const lock = this.readLock();
      const folders = vscode.workspace.workspaceFolders;
      if (lock && folders && lock.owner === folders[0].uri.fsPath) {
        fs.unlinkSync(ClaudeCodeSignal.LOCK_FILE);
        log('[ClaudeCode] Released bulb ownership');
      }
    } catch { /* ignore */ }
  }

  start(): void {
    const projectDir = this.findProjectDir();
    if (!projectDir) {
      log('[ClaudeCode] Could not find Claude project directory. Detection disabled.');
      return;
    }

    const jsonlFile = this.findLatestJsonlFile(projectDir);
    if (jsonlFile) {
      this.startWatching(jsonlFile);
    } else {
      log('[ClaudeCode] No JSONL session file found yet. Waiting for session...');
    }

    // Periodically check for new/rotated session files
    this.fileCheckInterval = setInterval(() => {
      this.checkForNewSession();
    }, this.FILE_CHECK_MS);

    // Silence detection
    this.silenceCheckInterval = setInterval(() => {
      this.checkSilence();
    }, this.SILENCE_CHECK_MS);
  }

  stop(): void {
    this.stopWatching();
    if (this.silenceCheckInterval) {
      clearInterval(this.silenceCheckInterval);
      this.silenceCheckInterval = null;
    }
    if (this.fileCheckInterval) {
      clearInterval(this.fileCheckInterval);
      this.fileCheckInterval = null;
    }
    this.agentSessionActive = false;
    this.lastActivityTime = 0;
    this.pendingToolUses = 0;
    this.lastToolUseTime = 0;
    this.lastPendingToolName = '';
    this.permissionAlerted = false;

    this.lastAssistantHadTextOnly = false;
    this.expectingMore = false;
    this.sessionHadToolUse = false;
    this.releaseOwnership();
    this.jsonlFilePath = null;
    this.lineBuffer = '';
  }

  dispose(): void {
    this.stop();
  }

  // ─── Private ───────────────────────────────────────────────────────────────

  private startWatching(filePath: string): void {
    this.stopWatching();
    this.jsonlFilePath = filePath;

    try {
      const stat = fs.statSync(filePath);
      this.prevSize = stat.size; // Start from EOF — don't replay history
    } catch {
      this.prevSize = 0;
    }

    log(`[ClaudeCode] Watching: ${filePath}`);

    fs.watchFile(filePath, { interval: this.POLL_INTERVAL_MS }, (curr) => {
      this.onJsonlFileChanged(filePath, curr);
    });

    this.watchDisposable = () => {
      fs.unwatchFile(filePath);
    };
  }

  private stopWatching(): void {
    if (this.watchDisposable) {
      this.watchDisposable();
      this.watchDisposable = null;
    }
  }

  private onJsonlFileChanged(filePath: string, curr: fs.Stats): void {
    if (curr.size <= this.prevSize) {
      if (curr.size < this.prevSize) {
        this.prevSize = curr.size;
      }
      return;
    }

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
      this.processLines(buffer);
    });

    stream.on('error', (err) => {
      logError('[ClaudeCode] Error reading JSONL file', err);
      this.prevSize = curr.size;
    });
  }

  private processLines(data: string): void {
    const combined = this.lineBuffer + data;
    const lines = combined.split('\n');

    // Last element may be a partial line — save for next read
    this.lineBuffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        this.processEntry(entry);
      } catch {
        // Malformed JSON line — skip (could be partial write)
      }
    }
  }

  private processEntry(entry: any): void {
    const type = entry.type;
    const contentArray = entry.message?.content;

    switch (type) {
      case 'assistant': {
        if (!Array.isArray(contentArray)) break;

        // Any assistant message = session is active
        if (!this.agentSessionActive) {
          log('[ClaudeCode] Agent session OPENED');
          this.agentSessionActive = true;
          this.claimOwnership();
        }

        // Track whether this message is text-only (no tool_use) → likely final response
        let hasToolUse = false;
        let hasText = false;
        let textContent = '';

        for (const block of contentArray) {
          switch (block.type) {
            case 'thinking':
              // AI is reasoning → blue pulse
              this.lastActivityTime = Date.now();
              this.stateMachine.onAgentApiCall();
              break;

            case 'text':
              hasText = true;
              textContent += (block.text || '') + ' ';
              // AI is talking to user — NOT code generation
              // Just keep the session alive, don't change light state
              this.lastActivityTime = Date.now();
              this.stateMachine.onFilePulse();
              break;

            case 'tool_use': {
              hasToolUse = true;
              this.sessionHadToolUse = true;
              this.pendingToolUses++;
              this.lastActivityTime = Date.now();
              this.lastToolUseTime = Date.now();
              this.permissionAlerted = false; // new tool_use, reset permission alert
          
              const toolName = block.name || '';
              this.lastPendingToolName = toolName;

              if (ClaudeCodeSignal.INPUT_TOOLS.has(toolName)) {
                // AskUserQuestion = Claude needs user input → RED ALERT
                this.stateMachine.onAgentNeedsInput();
                this.permissionAlerted = true; // already alerted
              } else if (ClaudeCodeSignal.CODE_TOOLS.has(toolName)) {
                // Write/Edit/NotebookEdit = actually writing code → purple
                // Uses onAgentCodeWrite (no waiting timer) — JSONL silence handles completion
                this.stateMachine.onAgentCodeWrite();
              } else {
                // Bash/Read/Grep/Task/etc. = still thinking/researching → blue pulse
                this.stateMachine.onAgentApiCall();
              }
              this.stateMachine.onFilePulse();
              break;
            }
          }
        }

        // If assistant message had text but NO tool_use and no pending tools,
        // this is likely the final response → use faster silence threshold.
        // BUT: in multi-step sessions, text-only messages between tools are intermediate
        // ("Now comment out the JS..."), not final. Never use fast threshold there.
        this.lastAssistantHadTextOnly = hasText && !hasToolUse && this.pendingToolUses === 0;
        if (this.lastAssistantHadTextOnly && this.sessionHadToolUse) {
          this.lastAssistantHadTextOnly = false; // don't use fast threshold in multi-step sessions
        }
        if (this.lastAssistantHadTextOnly) {
          log('[ClaudeCode] Text-only response detected — using fast completion threshold');
        }

        // Track whether Claude will send more messages after tool execution.
        // - hasToolUse: Claude sent tool_use → WILL get tool_result → WILL respond again
        // - Pattern match: in multi-step sessions, detect intermediate text like
        //   "I'll write", "let me create" → Claude is about to use a tool, streaming gap incoming
        // - Otherwise: likely final response → allow fast green
        // Only check intent on short text (<300 chars). Bridge messages ("Now I'll edit the file.")
        // are short. Long text is a summary/explanation — matching "now comment" in a paragraph
        // about what was fixed would falsely keep expectingMore=true on the final message.
        const hasIntent = this.sessionHadToolUse && textContent.length < 300 && ClaudeCodeSignal.INTENT_PATTERN.test(textContent);
        this.expectingMore = hasToolUse || hasIntent;
        if (hasIntent) {
          log(`[ClaudeCode] Intent detected in text — expecting more tool activity`);
        }
        break;
      }

      case 'user': {
        // Any user message = Claude Code is driving the conversation, assistant WILL respond.
        this.lastActivityTime = Date.now();

        if (!Array.isArray(contentArray)) break;
        let hasToolResult = false;
        for (const block of contentArray) {
          if (block.type === 'tool_result') {
            hasToolResult = true;
            if (this.pendingToolUses > 0) this.pendingToolUses--;
            this.lastToolUseTime = 0; // tool completed, reset stall timer
            this.lastPendingToolName = '';
            this.permissionAlerted = false;

            // Tool completed → back to thinking (Claude continues working)
            // This handles aiNeedsInput (user answered question), aiGenerating (Write/Edit done),
            // and any other AI state where a tool_result means Claude is moving on.
            const currentState = this.stateMachine.currentState;
            if (currentState === 'aiNeedsInput' || currentState === 'aiGenerating' || currentState === 'aiWaitingForInput') {
              this.stateMachine.onAgentApiCall();
            }
            this.stateMachine.onFilePulse();
          }
        }

        // Non-tool_result user message = new prompt or Claude Code continuation.
        // Claude WILL send an assistant message, so expect more and go orange immediately.
        if (!hasToolResult) {
          this.expectingMore = true;
          this.lastAssistantHadTextOnly = false;
          this.stateMachine.onAgentApiCall(); // idle → aiThinking (orange) instantly
        }
        break;
      }

      case 'progress':
        // Progress events fire during tool execution (hooks, subagents, etc.)
        // They MUST reset the activity timer to prevent false silence detection
        this.lastActivityTime = Date.now();
        this.stateMachine.onFilePulse();
        break;
    }
  }

  private checkSilence(): void {
    if (!this.agentSessionActive) return;

    // Keep the lock file timestamp fresh so other windows know we're alive
    this.refreshLock();

    // Permission stall detection: Write/Edit prompts appear instantly (2s threshold),
    // Bash commands may genuinely run for a while (6s threshold).
    // Read/Grep/Glob/Task are auto-approved and never trigger this.
    if (
      this.pendingToolUses > 0 &&
      this.lastToolUseTime > 0 &&
      !this.permissionAlerted &&
      ClaudeCodeSignal.PERMISSION_TOOLS.has(this.lastPendingToolName)
    ) {
      const toolStall = Date.now() - this.lastToolUseTime;
      const threshold = ClaudeCodeSignal.CODE_TOOLS.has(this.lastPendingToolName)
        ? this.PERMISSION_STALL_CODE_MS   // Write/Edit → 2s (prompt is instant)
        : this.PERMISSION_STALL_BASH_MS;  // Bash → 6s (command may be running)
      if (toolStall >= threshold) {
        log(`[ClaudeCode] PERMISSION STALL ${toolStall}ms (${this.lastPendingToolName}, threshold=${threshold}ms) → user needs to approve/deny`);
        this.permissionAlerted = true;
        this.stateMachine.onAgentNeedsInput();
        return;
      }
    }

    // Tools still running (e.g. Task subagent) — keep busy lock alive and never trigger silence
    if (this.pendingToolUses > 0) {
      this.stateMachine.onAgentStillWorking();
      return;
    }

    // Claude is expected to send more messages. Keep the state machine alive.
    if (this.expectingMore) {
      this.stateMachine.onAgentStillWorking();
      const elapsed = Date.now() - this.lastActivityTime;

      // Tiered safety timeout:
      // - pendingToolUses > 0: tools genuinely running, wait up to 120s
      // - pendingToolUses === 0: in a streaming gap or truly done.
      //   Use 45s — generous enough for most API response times,
      //   but not forever. After 45s, clear expectingMore and let
      //   normal silence threshold (6s) handle completion on next check.
      const safetyMs = this.pendingToolUses > 0 ? 120_000 : 45_000;

      if (elapsed >= safetyMs) {
        log(`[ClaudeCode] SAFETY TIMEOUT — ${elapsed}ms with expectingMore (pending=${this.pendingToolUses}), clearing`);
        this.expectingMore = false;
        if (this.pendingToolUses > 0) {
          // Tools stuck for 120s — something is really wrong, force completion
          this.agentSessionActive = false;
          this.lastActivityTime = 0;
          this.pendingToolUses = 0;
          this.stateMachine.onAgentHardFinish();
          this.releaseOwnership();
        }
        // When pendingToolUses === 0, just clear expectingMore.
        // Normal silence detection (6s) will handle completion on next cycle.
      }
      return;
    }

    const elapsed = Date.now() - this.lastActivityTime;
    // Use faster threshold (4s) when last message was text-only (likely final response)
    // Multi-step sessions never reach here — expectingMore blocks them above.
    const threshold = this.lastAssistantHadTextOnly ? this.SILENCE_FAST_MS : this.SILENCE_THRESHOLD_MS;

    if (this.lastActivityTime > 0 && elapsed >= threshold) {
      log(`[ClaudeCode] SILENCE ${elapsed}ms (threshold=${threshold}ms) → session complete`);
      this.agentSessionActive = false;
      this.lastActivityTime = 0;
      this.pendingToolUses = 0;
      this.lastAssistantHadTextOnly = false;
      this.sessionHadToolUse = false;

      this.stateMachine.onAgentHardFinish();
      this.releaseOwnership();
    }
  }

  private checkForNewSession(): void {
    // Don't switch JSONL files while the current session is actively working.
    // Subagents (Task tool) create their own JSONL files — switching to them mid-task
    // would cause false completion when the subagent finishes.
    if (this.agentSessionActive || this.expectingMore || this.pendingToolUses > 0) {
      return;
    }

    const projectDir = this.findProjectDir();
    if (!projectDir) return;

    const latestFile = this.findLatestJsonlFile(projectDir);
    if (!latestFile) return;

    if (latestFile !== this.jsonlFilePath) {
      log(`[ClaudeCode] New session detected: ${path.basename(latestFile)}`);
      this.agentSessionActive = false;
      this.lastActivityTime = 0;
      this.pendingToolUses = 0;
      this.lastToolUseTime = 0;
      this.lastPendingToolName = '';
      this.permissionAlerted = false;
      this.expectingMore = false;
      this.sessionHadToolUse = false;
      this.lastAssistantHadTextOnly = false;
      this.lineBuffer = '';
      this.startWatching(latestFile);
    }
  }

  // ─── Discovery ─────────────────────────────────────────────────────────────

  private deriveProjectSlug(): string | null {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) return null;
    const workspacePath = workspaceFolders[0].uri.fsPath;
    return workspacePath
        .replace(/^([A-Z]):/, (_, drive: string) => drive.toLowerCase() + ':')  // C: → c:
        .replace(/[:\\/_ ]/g, '-');                                              // all separators → dash
  }

  private findProjectDir(): string | null {
    const slug = this.deriveProjectSlug();
    if (!slug) return null;

    const projectDir = path.join(os.homedir(), '.claude', 'projects', slug);
    if (fs.existsSync(projectDir)) return projectDir;

    log(`[ClaudeCode] Project dir not found: ${projectDir}`);
    return null;
  }

  private findLatestJsonlFile(projectDir: string): string | null {
    try {
      const files = fs.readdirSync(projectDir)
        .filter(f => f.endsWith('.jsonl'))
        .map(f => ({
          name: f,
          fullPath: path.join(projectDir, f),
          mtime: fs.statSync(path.join(projectDir, f)).mtimeMs,
        }))
        .sort((a, b) => b.mtime - a.mtime);

      return files.length > 0 ? files[0].fullPath : null;
    } catch {
      return null;
    }
  }
}
