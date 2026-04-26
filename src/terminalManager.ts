import * as vscode from 'vscode';

let llemTerminal: vscode.Terminal | undefined;

export function getLlemTerminal(): vscode.Terminal {
    if (!llemTerminal || llemTerminal.exitStatus !== undefined) {
        llemTerminal = vscode.window.createTerminal({
            name: 'LLeM Console'
        });
    }
    return llemTerminal;
}

export function writeToLlemTerminal(message: string): void {
    const terminal = getLlemTerminal();
    // Send as a comment to avoid shell command errors
    const lines = message.split(/\r?\n/);
    for (const line of lines) {
        if (line.trim()) {
            terminal.sendText(`# [LLeM] ${line}`);
        }
    }
}
