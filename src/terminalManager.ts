import * as vscode from 'vscode';

let llemChannel: vscode.OutputChannel | undefined;

export function getLlemChannel(): vscode.OutputChannel {
    if (!llemChannel) {
        llemChannel = vscode.window.createOutputChannel('LLeM Console');
    }
    return llemChannel;
}

export function writeToLlemTerminal(message: string): void {
    const channel = getLlemChannel();
    const lines = message.split(/\r?\n/);
    for (const line of lines) {
        if (line.trim()) {
            channel.appendLine(`[LLeM] ${line}`);
        }
    }
}
