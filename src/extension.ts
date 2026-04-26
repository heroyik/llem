import * as vscode from 'vscode';
import { startBridgeServer } from './bridgeServer';
import { getConfig } from './config';
import { registerExtensionCommands } from './extensionCommands';
import { LLEM_VIEW_ID, SidebarChatProvider } from './sidebarChatProvider';
import { getLlemTerminal, writeToLlemTerminal } from './terminalManager';
import { logInfo, logError, getOutputChannel } from './logger';

// ============================================================
// LLeM — local chat, repo edits, terminal moves, zero cloud drama
// ============================================================

export function activate(context: vscode.ExtensionContext) {
    // Ensure Output channel is ready and shown
    const output = getOutputChannel();
    context.subscriptions.push(output);
    
    // Explicitly show the output channel to confirm it works
    output.show(true);
    logInfo('LLeM extension activating...');

    // Ensure terminal is created
    getLlemTerminal().show(true);

    logInfo('LLeM extension activated.');


    
    // Ensure terminal is created and shown
    getLlemTerminal().show(true);

    const provider = new SidebarChatProvider(context.extensionUri, context);

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(LLEM_VIEW_ID, provider, {
            webviewOptions: {
                retainContextWhenHidden: true
            }
        })
    );

    if (getConfig().bridgeEnabled) {
        startBridgeServer(provider);
    }

    registerExtensionCommands(context, provider);
}

export function deactivate() {}
