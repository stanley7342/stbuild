import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export type SdkStatus = 'idle' | 'fetching' | 'installing';

export interface InstalledSdk {
    tag: string;
    path: string;
}

const REPO_URL = 'git@github.com:RafaelMicro/Rafael-IoT-SDK.git';

export class SdkManager {
    private readonly _onDidChange = new vscode.EventEmitter<void>();
    readonly onDidChange = this._onDidChange.event;

    private _status: SdkStatus = 'idle';
    private _tags: string[] = [];
    private _installedSdks: InstalledSdk[] = [];
    private _installPath: string;

    constructor(
        private readonly _output: vscode.OutputChannel,
        private readonly _context: vscode.ExtensionContext
    ) {
        this._installPath = _context.globalState.get<string>('sdk.installPath') ?? 'C:\\';
        this.refreshInstalled();
    }

    get status(): SdkStatus { return this._status; }
    get tags(): string[] { return this._tags; }
    get installedSdks(): InstalledSdk[] { return this._installedSdks; }
    get installPath(): string { return this._installPath; }

    setInstallPath(p: string): void {
        this._installPath = p;
        this._context.globalState.update('sdk.installPath', p);
        this.refreshInstalled();
        this._onDidChange.fire();
    }

    async fetchTags(): Promise<void> {
        if (this._status !== 'idle') { return; }
        this._status = 'fetching';
        this._tags = [];
        this._onDidChange.fire();
        try {
            const out = await this.exec(
                `git ls-remote --tags --sort=-version:refname ${REPO_URL}`
            );
            // Parse lines: <hash>\trefs/tags/<name>
            // Filter out peeled refs (^{}) and extract tag names
            const tags = out.split('\n')
                .map(l => l.trim())
                .filter(l => l.includes('\trefs/tags/') && !l.includes('^{}'))
                .map(l => {
                    const match = l.match(/refs\/tags\/(.+)$/);
                    return match?.[1]?.trim();
                })
                .filter((t): t is string => Boolean(t));
            this._tags = tags;
            if (tags.length === 0) {
                vscode.window.showWarningMessage('No tags found in the Rafael IoT SDK repository.');
            }
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            this._output.appendLine(`[SDK] fetchTags error: ${msg}`);
            vscode.window.showErrorMessage(`Failed to fetch SDK tags: ${msg}`);
        } finally {
            this._status = 'idle';
            this._onDidChange.fire();
        }
    }

    async installSdk(tag: string): Promise<void> {
        if (this._status !== 'idle') {
            vscode.window.showWarningMessage('An SDK operation is already in progress.');
            return;
        }
        const targetDir = path.join(this._installPath, tag);
        if (fs.existsSync(targetDir)) {
            vscode.window.showInformationMessage(`SDK ${tag} is already installed at ${targetDir}`);
            return;
        }
        if (!fs.existsSync(this._installPath)) {
            fs.mkdirSync(this._installPath, { recursive: true });
        }
        this._status = 'installing';
        this._onDidChange.fire();
        this._output.show();
        this._output.appendLine(`\n[SDK] Installing ${tag}...`);
        this._output.appendLine(`[SDK] Target: ${targetDir}`);
        try {
            await this.execStreaming(
                `git clone --branch "${tag}" --depth 1 --single-branch --no-tags "${REPO_URL}" "${targetDir}"`,
                this._output
            );
            this._output.appendLine(`[SDK] ✓ Installation complete: ${tag}`);
            // Show git log of the cloned repo
            try {
                const log = await this.exec(
                    `git -C "${targetDir}" log --oneline --decorate --graph -10`
                );
                this._output.appendLine('\n[SDK] Git log:');
                this._output.appendLine(log.trimEnd());
            } catch { /* ignore log errors */ }
            vscode.window.showInformationMessage(`SDK ${tag} installed successfully.`);
            this.refreshInstalled();
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            this._output.appendLine(`[SDK] ✗ Install failed: ${msg}`);
            vscode.window.showErrorMessage(`Failed to install SDK ${tag}: ${msg}`);
            // Clean up partial clone
            if (fs.existsSync(targetDir)) {
                try { fs.rmSync(targetDir, { recursive: true, force: true }); } catch { /* ignore */ }
            }
        } finally {
            this._status = 'idle';
            this._onDidChange.fire();
        }
    }

    async removeSdk(tag: string): Promise<void> {
        const targetDir = path.join(this._installPath, tag);
        if (!fs.existsSync(targetDir)) { return; }
        const confirm = await vscode.window.showWarningMessage(
            `Remove SDK ${tag}? This will delete ${targetDir}`,
            { modal: true },
            'Remove'
        );
        if (confirm !== 'Remove') { return; }
        try {
            fs.rmSync(targetDir, { recursive: true, force: true });
            this.refreshInstalled();
            this._onDidChange.fire();
            vscode.window.showInformationMessage(`SDK ${tag} removed.`);
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            vscode.window.showErrorMessage(`Failed to remove SDK ${tag}: ${msg}`);
        }
    }

    refreshInstalled(): void {
        this._installedSdks = [];
        if (fs.existsSync(this._installPath)) {
            try {
                const entries = fs.readdirSync(this._installPath, { withFileTypes: true });
                for (const e of entries) {
                    if (e.isDirectory()) {
                        this._installedSdks.push({
                            tag: e.name,
                            path: path.join(this._installPath, e.name),
                        });
                    }
                }
            } catch { /* ignore */ }
        }
    }

    private exec(cmd: string): Promise<string> {
        return new Promise((resolve, reject) => {
            cp.exec(cmd, { timeout: 30000 }, (err, stdout, stderr) => {
                if (err) { reject(new Error(stderr || err.message)); }
                else { resolve(stdout); }
            });
        });
    }

    private execStreaming(cmd: string, output: vscode.OutputChannel): Promise<void> {
        const normalize = (d: Buffer) => d.toString().replace(/\r(?!\n)/g, '\n');
        return new Promise((resolve, reject) => {
            const proc = cp.spawn(cmd, [], { shell: true });
            proc.stdout?.on('data', (d: Buffer) => output.append(normalize(d)));
            proc.stderr?.on('data', (d: Buffer) => output.append(normalize(d)));
            proc.on('close', code => {
                if (code === 0) { resolve(); }
                else { reject(new Error(`git exited with code ${code}`)); }
            });
            proc.on('error', reject);
        });
    }

    dispose(): void {
        this._onDidChange.dispose();
    }
}
