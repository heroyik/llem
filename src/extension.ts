import * as vscode from 'vscode';
import { startBridgeServer } from './bridgeServer';
import { getConfig } from './config';
import { registerExtensionCommands } from './extensionCommands';
import { LLEM_VIEW_ID, SidebarChatProvider } from './sidebarChatProvider';
import { getLlemTerminal, writeToLlemTerminal } from './terminalManager';

// ============================================================
// LLeM — local chat, repo edits, terminal moves, zero cloud drama
// ============================================================

export function activate(context: vscode.ExtensionContext) {
    // Redirect console.log to LLeM Console
    const originalLog = console.log;
    console.log = (...args: any[]) => {
        originalLog.apply(console, args);
        const message = args.map(arg => 
            typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
        ).join(' ');
        writeToLlemTerminal(message);
    };

    const originalError = console.error;
    console.error = (...args: any[]) => {
        originalError.apply(console, args);
        const message = args.map(arg => 
            typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
        ).join(' ');
        writeToLlemTerminal(`ERROR: ${message}`);
    };

    console.log('LLeM extension activated.');
    
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
