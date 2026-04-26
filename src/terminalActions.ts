import * as vscode from 'vscode';
import { validateTerminalCommand } from './commandPolicy';
import { getLlemTerminal } from './terminalManager';

export interface TerminalActionHost {
    approveCommand(command: string): Promise<boolean>;
}

export interface TerminalActionResult {
    report: string[];
}

export async function executeTerminalAction(
    command: string,
    cwd: string,
    host: TerminalActionHost
): Promise<TerminalActionResult> {
    try {
        const policy = validateTerminalCommand(command);
        if (!policy.allowed) {
            return { report: [`❌ Command blocked: ${command} — ${policy.reason}`] };
        }

        const approved = await host.approveCommand(command);
        if (!approved) {
            return { report: [`⚠️ Command skipped: ${command}`] };
        }

        const terminal = getLlemTerminal();
        terminal.show();
        terminal.sendText(command);
        return { report: [`🖥️ Ran: ${command}`] };
    } catch (err: any) {
        return { report: [`❌ Command failed: ${command} — ${err.message}`] };
    }
}
