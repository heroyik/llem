import * as vscode from 'vscode';
import { startBridgeServer } from './bridgeServer';
import { getConfig } from './config';
import { registerExtensionCommands } from './extensionCommands';
import { LLEM_VIEW_ID, SidebarChatProvider } from './sidebarChatProvider';
import { logInfo, getOutputChannel } from './logger';


// ============================================================
// LLeM — local chat, repo edits, terminal moves, zero cloud drama
// ============================================================

export function activate(context: vscode.ExtensionContext) {
    const output = getOutputChannel();
    context.subscriptions.push(output);
    logInfo('LLeM extension activating...');

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
