import * as vscode from 'vscode';

let outputChannel: vscode.OutputChannel | undefined;

export function initLogger(context: vscode.ExtensionContext): void {
  outputChannel = vscode.window.createOutputChannel('VibeSync');
  context.subscriptions.push(outputChannel);
}

export function log(message: string): void {
  const timestamp = new Date().toISOString().split('T')[1].slice(0, 12);
  outputChannel?.appendLine(`[${timestamp}] ${message}`);
}

export function logError(message: string, error?: unknown): void {
  const errorMsg = error instanceof Error ? error.message : String(error);
  log(`ERROR: ${message}${error ? ` — ${errorMsg}` : ''}`);
}
