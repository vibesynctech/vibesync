import * as vscode from 'vscode';
import { StateMachine } from './StateMachine.js';
import { log } from '../utils/logger.js';

/**
 * Intercepts VS Code command executions to detect accept/reject signals
 * from AI tools that expose these as commands (Copilot, Continue.dev, Windsurf).
 *
 * For tools that use UI buttons (Cursor, Antigravity), this doesn't fire —
 * those fall back to the velocity + silence timer detection instead.
 *
 * Note: `onDidExecuteCommand` is a real VS Code runtime API but not yet
 * reflected in @types/vscode, so we access it via a runtime type assertion.
 */
export class CommandSignal implements vscode.Disposable {
  private disposable: vscode.Disposable | null = null;

  constructor(private readonly stateMachine: StateMachine) {
    // Runtime check — the API exists in VS Code 1.56+ but may not be in @types
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const commandsAny = vscode.commands as any;
    if (typeof commandsAny.onDidExecuteCommand === 'function') {
      this.disposable = commandsAny.onDidExecuteCommand(
        (event: { command: string }) => {
          log(`[DEBUG] Command: ${event.command}`);
          this.stateMachine.onCommandExecuted(event.command);
        }
      ) as vscode.Disposable;
      log('CommandSignal: onDidExecuteCommand hooked');
    } else {
      log('CommandSignal: onDidExecuteCommand not available — velocity detection only');
    }
  }

  dispose(): void {
    this.disposable?.dispose();
  }
}
