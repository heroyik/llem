import * as vscode from 'vscode';

let outputChannel: vscode.OutputChannel | undefined;

export function getOutputChannel(): vscode.OutputChannel {
    if (!outputChannel) {
        outputChannel = vscode.window.createOutputChannel('LLeM');
    }
    return outputChannel;
}

export function showOutputChannel(): void {
    getOutputChannel().show(true);
}

export function logInfo(message: string): void {
    const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false });
    getOutputChannel().appendLine(`[${timestamp}] [INFO] ${message}`);
}

export function logError(message: string, show = true): void {
    const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false });
    getOutputChannel().appendLine(`[${timestamp}] [ERROR] ${message}`);
    if (show) {
        getOutputChannel().show(true);
    }
}

