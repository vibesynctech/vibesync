import * as vscode from 'vscode';
import { StateMachine } from './StateMachine.js';

/**
 * Detects when user switches to/from the terminal panel.
 *
 * Why this matters:
 * - Antigravity agents run in the terminal
 * - Claude Code CLI runs in the terminal
 * - When user clicks on terminal/agent panel, onDidChangeActiveTerminal fires
 * - This is the signal we use for "user went to chat with AI" detection
 *
 * Copilot Chat is a webview (not a terminal), so this won't help there.
 * But for terminal-based AI tools, this gives us the missing signal.
 */
export class TerminalSignal implements vscode.Disposable {
  private disposables: vscode.Disposable[] = [];

  constructor(private readonly stateMachine: StateMachine) {
    // Fires when user clicks on a terminal panel
    this.disposables.push(
      vscode.window.onDidChangeActiveTerminal((terminal) => {
        const hasTerminal = terminal !== undefined;
        this.stateMachine.onTerminalFocusChange(hasTerminal);
      })
    );

    // Fires when a new terminal is opened (agent might spawn one)
    this.disposables.push(
      vscode.window.onDidOpenTerminal(() => {
        // No-op — just keeping the listener registered for future use
      })
    );
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
