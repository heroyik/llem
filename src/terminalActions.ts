import * as vscode from 'vscode';
import * as cp from 'node:child_process';
import { promisify } from 'node:util';
import { validateTerminalCommand } from './commandPolicy';
import { getLlemChannel, writeToLlemTerminal } from './terminalManager';

const execAsync = promisify(cp.exec);

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

        // Show the command in the console for user awareness
        const channel = getLlemChannel();
        channel.show(true);
        writeToLlemTerminal(`Executing: ${command}`);

        // Run the command and capture output
        // We use a timeout to prevent hanging the extension if a command is interactive or very slow
        const { stdout, stderr } = await execAsync(command, { cwd, timeout: 30000 });
        
        const combinedOutput = (stdout + (stderr ? `\n[STDERR]\n${stderr}` : '')).trim();
        
        // Also write a snippet to the terminal so the user sees something happened
        if (combinedOutput) {
            const preview = combinedOutput.length > 500 ? combinedOutput.slice(0, 500) + '...' : combinedOutput;
            writeToLlemTerminal(`Result:\n${preview}`);
        } else {
            writeToLlemTerminal('Command completed with no output.');
        }

        return { 
            report: [
                `🖥️ **Command executed:** \`${command}\``,
                `**Output:**\n\`\`\`\n${combinedOutput || '(no output)'}\n\`\`\``
            ] 
        };
    } catch (err: any) {
        const errorMessage = err.stderr || err.message;
        writeToLlemTerminal(`Error: ${errorMessage}`);
        return { report: [`❌ Command failed: ${command} — ${errorMessage}`] };
    }
}
