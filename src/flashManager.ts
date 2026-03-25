import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { ConfigManager } from './configManager';

export class FlashManager {
    constructor(
        private readonly config: ConfigManager,
        private readonly output: vscode.OutputChannel
    ) {}

    async flash(): Promise<boolean> {
        const tool = this.config.flashTool;
        this.output.show(true);
        this.output.appendLine(`\n[史丹利測試] ── Flash (${tool}) ──────────────`);

        let command: string;
        let args: string[];

        switch (tool) {
            case 'openocd':
                [command, args] = await this.buildOpenOCDArgs();
                break;
            case 'esptool':
                [command, args] = await this.buildEsptoolArgs();
                break;
            case 'custom':
                [command, args] = this.buildCustomArgs();
                break;
        }

        if (!command) { return false; }

        this.output.appendLine(`> ${command} ${args.join(' ')}\n`);

        const ok = await this.spawn(command, args);
        if (ok) {
            this.output.appendLine('\n[史丹利測試] Flash successful!\n');
            vscode.window.showInformationMessage('史丹利測試: Flash successful!');
        } else {
            this.output.appendLine('\n[史丹利測試] Flash failed!\n');
            vscode.window.showErrorMessage('史丹利測試: Flash failed. See Output panel for details.');
        }
        return ok;
    }

    private async buildOpenOCDArgs(): Promise<[string, string[]]> {
        const binary = await this.resolveBinary('.elf');
        if (!binary) { return ['', []]; }

        return [
            this.config.openocdPath,
            [
                '-f', this.config.openocdInterface,
                '-f', this.config.openocdTarget,
                '-c', `program "${binary}" verify reset exit`,
            ],
        ];
    }

    private async buildEsptoolArgs(): Promise<[string, string[]]> {
        const binary = await this.resolveBinary('.bin');
        if (!binary) { return ['', []]; }

        return [
            'esptool.py',
            ['--chip', 'auto', 'write_flash', '0x0', binary],
        ];
    }

    private buildCustomArgs(): [string, string[]] {
        const cmd = this.config.customFlashCommand.trim();
        if (!cmd) {
            vscode.window.showErrorMessage(
                '史丹利測試: Set mcuBuild.flash.customCommand in settings first.'
            );
            return ['', []];
        }
        const parts = cmd.split(/\s+/);
        return [parts[0], parts.slice(1)];
    }

    private async resolveBinary(ext: string): Promise<string | null> {
        const configured = this.config.binaryPath;
        if (configured) {
            const full = path.isAbsolute(configured)
                ? configured
                : path.join(this.config.buildDirectory, configured);
            if (fs.existsSync(full)) { return full; }
            vscode.window.showWarningMessage(
                `史丹利測試: Configured binary not found: ${full}. Auto-detecting...`
            );
        }

        const buildDir = this.config.buildDirectory;
        if (!fs.existsSync(buildDir)) {
            vscode.window.showErrorMessage('史丹利測試: Build directory not found. Please build first.');
            return null;
        }

        const found = this.findByExtension(buildDir, ext);
        if (found.length === 0) {
            vscode.window.showErrorMessage(
                `史丹利測試: No ${ext} file found in build directory. Check mcuBuild.flash.binaryPath.`
            );
            return null;
        }

        if (found.length === 1) { return found[0]; }

        const items = found.map(f => ({
            label: path.relative(buildDir, f),
            description: f,
        }));

        const pick = await vscode.window.showQuickPick(items, {
            placeHolder: `Multiple ${ext} files found — select firmware to flash`,
        });
        if (!pick) { return null; }

        this.config.binaryPath = pick.label;
        return pick.description;
    }

    private findByExtension(dir: string, ext: string): string[] {
        const results: string[] = [];
        try {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    results.push(...this.findByExtension(full, ext));
                } else if (entry.name.endsWith(ext)) {
                    results.push(full);
                }
            }
        } catch { /* ignore permission errors */ }
        return results;
    }

    private spawn(command: string, args: string[]): Promise<boolean> {
        return new Promise((resolve) => {
            const proc = cp.spawn(command, args, {
                cwd: this.config.getWorkspaceRoot(),
                shell: true,
            });
            proc.stdout?.on('data', (c: Buffer) => this.output.append(c.toString()));
            proc.stderr?.on('data', (c: Buffer) => this.output.append(c.toString()));
            proc.on('close', (code) => resolve(code === 0));
            proc.on('error', (err) => {
                this.output.appendLine(`[史丹利測試] Error: ${err.message}`);
                resolve(false);
            });
        });
    }
}
