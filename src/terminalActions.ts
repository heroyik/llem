import * as vscode from 'vscode';
import { validateTerminalCommand } from './commandPolicy';

export interface TerminalActionHost {
    approveCommand(command: string): Promise<boolean>;
    getTerminal(): vscode.Terminal | undefined;
    setTerminal(terminal: vscode.Terminal): void;
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

        let terminal = host.getTerminal();
        if (!terminal || terminal.exitStatus !== undefined) {
            terminal = vscode.window.createTerminal({
                name: 'LLeM Console',
                cwd
            });
            host.setTerminal(terminal);
        }

        terminal.show();
        terminal.sendText(command);
        return { report: [`🖥️ Ran: ${command}`] };
    } catch (err: any) {
        return { report: [`❌ Command failed: ${command} — ${err.message}`] };
    }
}
