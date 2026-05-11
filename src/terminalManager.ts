import * as vscode from 'vscode';

let consoleChannel: vscode.OutputChannel | undefined;

export function getLlemChannel(): vscode.OutputChannel {
    if (!consoleChannel) {
        consoleChannel = vscode.window.createOutputChannel('Console');
    }
    return consoleChannel;
}

export function writeToLlemTerminal(message: string): void {
    const channel = getLlemChannel();
    const lines = message.split(/\r?\n/);
    for (const line of lines) {
        if (line.trim()) {
            channel.appendLine(line);
        }
    }
}
