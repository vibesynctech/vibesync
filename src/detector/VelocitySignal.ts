import * as vscode from 'vscode';
import { StateMachine } from './StateMachine.js';
import { EditorSignals } from './EditorSignals.js';

/**
 * Listens to text document changes and calculates total characters inserted
 * per event. Passes the count to StateMachine.onTextChange().
 *
 * Also notifies EditorSignals when a real code change happens,
 * confirming the evidence window (coding vs prompting detection).
 */
export class VelocitySignal implements vscode.Disposable {
  private disposable: vscode.Disposable;

  constructor(
    private readonly stateMachine: StateMachine,
    private readonly editorSignals: EditorSignals
  ) {
    this.disposable = vscode.workspace.onDidChangeTextDocument((event) => {
      // Skip non-file documents (output channels, git files, etc.)
      if (event.document.uri.scheme !== 'file') return;
      if (event.contentChanges.length === 0) return;

      // Skip .vscode/settings.json — ScreenGlowController writes colorCustomizations
      // to this file, which would create an infinite feedback loop
      const fsPath = event.document.uri.fsPath;
      if (fsPath.endsWith('.vscode/settings.json') || fsPath.endsWith('.vscode\\settings.json')) return;

      const charsInserted = event.contentChanges.reduce((sum, change) => {
        return sum + change.text.length;
      }, 0);

      if (charsInserted === 0) return;

      // A real file changed → this is evidence of coding, not prompting
      this.editorSignals.onCodeChangeEvidence();

      this.stateMachine.onTextChange(charsInserted);
    });
  }

  dispose(): void {
    this.disposable.dispose();
  }
}
