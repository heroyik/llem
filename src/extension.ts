import * as vscode from 'vscode';
import { startBridgeServer } from './bridgeServer';
import { registerExtensionCommands } from './extensionCommands';
import { SidebarChatProvider } from './sidebarChatProvider';

// ============================================================
// Connect AI — Full Agentic Local AI for VS Code
// 100% Offline · File Create · File Edit · Terminal · Multi-file Context
// ============================================================

export function activate(context: vscode.ExtensionContext) {
    console.log('Connect AI extension activated.');

    const provider = new SidebarChatProvider(context.extensionUri, context);

    startBridgeServer(provider);

    registerExtensionCommands(context, provider);
}

export function deactivate() {}
