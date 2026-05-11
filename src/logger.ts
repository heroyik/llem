import * as fs from 'node:fs';
import * as path from 'node:path';
import type * as vscode from 'vscode';

let outputChannel: vscode.OutputChannel | undefined;
let diagnosticsDir: string | undefined;
let diagnosticsFilePath: string | undefined;
let vscodeApi: typeof vscode | undefined;

function getVscodeApi(): typeof vscode | undefined {
    if (vscodeApi) {
        return vscodeApi;
    }
    try {
        vscodeApi = require('vscode') as typeof vscode;
        return vscodeApi;
    } catch {
        return undefined;
    }
}

function timestamp(): string {
    return new Date().toLocaleTimeString('en-US', { hour12: false });
}

function isoTimestamp(): string {
    return new Date().toISOString();
}

function dayStamp(): string {
    return isoTimestamp().slice(0, 10);
}

function ensureDiagnosticsFile(): string | undefined {
    if (!diagnosticsDir) {
        return undefined;
    }

    const nextPath = path.join(diagnosticsDir, `stream-debug-${dayStamp()}.log`);
    if (diagnosticsFilePath !== nextPath) {
        diagnosticsFilePath = nextPath;
    }

    try {
        fs.mkdirSync(diagnosticsDir, { recursive: true });
        if (!fs.existsSync(diagnosticsFilePath)) {
            fs.writeFileSync(diagnosticsFilePath, '');
        }
        return diagnosticsFilePath;
    } catch {
        return undefined;
    }
}

function appendDiagnosticsLine(line: string): void {
    const filePath = ensureDiagnosticsFile();
    if (!filePath) {
        return;
    }

    try {
        fs.appendFileSync(filePath, `${line}\n`, 'utf8');
    } catch {
        // Keep diagnostics best-effort only.
    }
}

function appendOutput(level: 'INFO' | 'ERROR', message: string): void {
    getOutputChannel().appendLine(`[${timestamp()}] [${level}] ${message}`);
    appendDiagnosticsLine(`${isoTimestamp()} [${level}] ${message}`);
}

export function getOutputChannel(): vscode.OutputChannel {
    if (!outputChannel) {
        const api = getVscodeApi();
        if (!api) {
            return {
                appendLine: (message: string) => appendDiagnosticsLine(`${isoTimestamp()} [INFO] ${message}`),
                show: () => undefined,
                dispose: () => undefined,
                name: 'Output',
                append: (message: string) => appendDiagnosticsLine(`${isoTimestamp()} [INFO] ${message}`),
                clear: () => undefined,
                hide: () => undefined,
                replace: (message: string) => appendDiagnosticsLine(`${isoTimestamp()} [INFO] ${message}`)
            } as unknown as vscode.OutputChannel;
        }
        outputChannel = api.window.createOutputChannel('Output');
    }
    return outputChannel;
}

export function showOutputChannel(): void {
    getOutputChannel().show(true);
}

export function initLogger(storagePath?: string): void {
    diagnosticsDir = storagePath ? path.join(storagePath, 'diagnostics') : undefined;
    const filePath = ensureDiagnosticsFile();
    if (filePath) {
        appendDiagnosticsLine(`${isoTimestamp()} [INFO] Logger initialized. Diagnostics file: ${filePath}`);
    }
}

export function getDiagnosticsFilePath(): string | undefined {
    return ensureDiagnosticsFile();
}

export function logInfo(message: string): void {
    appendOutput('INFO', message);
}

export function logError(message: string, show = true): void {
    appendOutput('ERROR', message);
    if (show) {
        getOutputChannel().show(true);
    }
}

export function logStructured(label: string, payload: unknown): void {
    appendDiagnosticsLine(`${isoTimestamp()} [TRACE] ${label} ${safeJson(payload)}`);
}

export function logStreamEvent(streamId: string, stage: string, payload: unknown): void {
    appendDiagnosticsLine(`${isoTimestamp()} [STREAM ${streamId}] ${stage} ${safeJson(payload)}`);
}

function safeJson(payload: unknown): string {
    try {
        return JSON.stringify(payload);
    } catch (error) {
        return JSON.stringify({
            serializationError: error instanceof Error ? error.message : String(error)
        });
    }
}
