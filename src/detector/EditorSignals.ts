import * as vscode from 'vscode';
import { StateMachine } from './StateMachine.js';
import { log } from '../utils/logger.js';

/**
 * Evidence-Based Detection (v3 + Global Evidence):
 *
 * Uses the `type` command override to intercept ALL keystrokes globally,
 * including those in webviews/chat panels (where onDidChangeTextEditorSelection
 * doesn't fire).
 *
 * 1. User presses any key → `type` command fires → start 100ms evidence window.
 * 2. If onDidChangeTextDocument fires within that window with scheme='file'
 *    → Evidence: code changed → userCoding (Blue).
 * 3. If the 100ms window expires with NO text change
 *    → Evidence: keystrokes went to chat/webview → userPrompting (Red).
 */
export class EditorSignals implements vscode.Disposable {
  private disposables: vscode.Disposable[] = [];
  private evidenceTimer: NodeJS.Timeout | null = null;
  private evidenceWindowOpen = false;

  constructor(private readonly stateMachine: StateMachine) {
    // Global keyboard snitch: intercept the `type` command which fires for
    // ALL keystrokes in VS Code, including webviews and chat panels.
    try {
      this.disposables.push(
        vscode.commands.registerCommand('type', (args) => {
          this.startEvidenceWindow();
          // CRITICAL: forward the keystroke so typing still works
          return vscode.commands.executeCommand('default:type', args);
        })
      );
      log('[EditorSignals] Global type command snitch registered');
    } catch {
      // Another extension already registered the `type` command (e.g. Vim).
      // Fall back to selection-based detection.
      log('[EditorSignals] type command already registered, falling back to selection events');
      this.disposables.push(
        vscode.window.onDidChangeTextEditorSelection(() => {
          this.startEvidenceWindow();
        })
      );
    }
  }

  /**
   * Called by VelocitySignal when a real text document change fires.
   * If the evidence window is open, this CONFIRMS coding activity.
   */
  onCodeChangeEvidence(): void {
    if (this.evidenceWindowOpen) {
      this.cancelEvidenceWindow();
      // Text DID change → userCoding. VelocitySignal handles the actual state transition.
    }
  }

  /**
   * Called by VelocitySignal when no evidence window was open
   * but text changed anyway (e.g. AI burst). No action needed.
   */

  private startEvidenceWindow(): void {
    // Don't start evidence windows when AI is busy
    if (this.stateMachine.isAgentBusy) return;

    this.cancelEvidenceWindow();
    this.evidenceWindowOpen = true;

    this.evidenceTimer = setTimeout(() => {
      this.evidenceTimer = null;
      this.evidenceWindowOpen = false;
      // 100ms passed and NO text change → keystrokes went to chat/webview
      this.stateMachine.onKeyboardWithoutCodeChange();
    }, 100);
  }

  private cancelEvidenceWindow(): void {
    this.evidenceWindowOpen = false;
    if (this.evidenceTimer) {
      clearTimeout(this.evidenceTimer);
      this.evidenceTimer = null;
    }
  }

  dispose(): void {
    this.cancelEvidenceWindow();
    for (const d of this.disposables) d.dispose();
  }
}
