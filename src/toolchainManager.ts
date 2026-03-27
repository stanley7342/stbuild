import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

interface ToolDef {
    label: string;
    exe: string;
    wingetId: string;
    chocoId: string;
    macCmd: string;
    linuxCmd: string;
    wingetRemoveId?: string;
    chocoRemoveId?: string;
}

const ARM_TOOL: ToolDef = {
    label: 'ARM Cortex-M (arm-none-eabi-gcc)',
    exe: 'arm-none-eabi-gcc',
    wingetId: 'Arm.GnuArmEmbeddedToolchain',
    chocoId: 'gcc-arm-embedded',
    macCmd: 'brew install --cask gcc-arm-embedded',
    linuxCmd: 'sudo apt-get install -y gcc-arm-none-eabi binutils-arm-none-eabi',
};

const CMAKE_TOOL: ToolDef = {
    label: 'CMake',
    exe: 'cmake',
    wingetId: 'Kitware.CMake',
    chocoId: 'cmake',
    macCmd: 'brew install cmake',
    linuxCmd: 'sudo apt-get install -y cmake',
};

const NINJA_TOOL: ToolDef = {
    label: 'Ninja',
    exe: 'ninja',
    wingetId: 'Ninja-build.Ninja',
    chocoId: 'ninja',
    macCmd: 'brew install ninja',
    linuxCmd: 'sudo apt-get install -y ninja-build',
};

/** Resolve winget full path since it may not be in PATH inside VSCode-spawned shells. */
const WINGET_CMD =
    `$wg = Get-Command winget -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source; ` +
    `if (-not $wg) { $wg = "$env:LOCALAPPDATA\\Microsoft\\WindowsApps\\winget.exe" }; ` +
    `if (-not (Test-Path $wg)) { $wg = $null }`;

export class ToolchainManager {
    private _armVersion: string | undefined;
    private _cmakeVersion: string | undefined;
    private _ninjaVersion: string | undefined;
    private _checked = false;

    private _onDidChange = new vscode.EventEmitter<void>();
    readonly onDidChange = this._onDidChange.event;

    async checkAll(): Promise<void> {
        this._checked = false;
        this._onDidChange.fire();
        const [arm, cmake, ninja] = await Promise.all([
            this.queryVersion('arm-none-eabi-gcc', ['--version']),
            this.queryVersion('cmake', ['--version']),
            this.queryVersion('ninja', ['--version']),
        ]);
        this._armVersion = arm;
        this._cmakeVersion = cmake;
        this._ninjaVersion = ninja;
        this._checked = true;
        this._onDidChange.fire();
    }

    get armStatus():   string { return !this._checked ? 'checking…' : (this._armVersion   ?? 'not installed'); }
    get cmakeStatus(): string { return !this._checked ? 'checking…' : (this._cmakeVersion ?? 'not installed'); }
    get ninjaStatus(): string { return !this._checked ? 'checking…' : (this._ninjaVersion ?? 'not installed'); }

    get armInstalled():   boolean { return !!this._armVersion; }
    get cmakeInstalled(): boolean { return !!this._cmakeVersion; }
    get ninjaInstalled(): boolean { return !!this._ninjaVersion; }

    // ── Install ───────────────────────────────────────────────────────────────

    async installArmToolchain(): Promise<void> { await this.installWithVersionPicker(ARM_TOOL); }
    async installCmake():        Promise<void> { await this.installWithVersionPicker(CMAKE_TOOL); }
    async installNinja():        Promise<void> { await this.installWithVersionPicker(NINJA_TOOL); }

    private async installWithVersionPicker(tool: ToolDef): Promise<void> {
        if (process.platform !== 'win32') {
            // macOS / Linux: no version picker, use package manager directly
            const cmd = process.platform === 'darwin' ? tool.macCmd : tool.linuxCmd;
            await this.runInTerminal(`Install ${tool.label}`, cmd, tool.exe, 'install');
            return;
        }

        // Windows: try to list versions from winget
        await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: `Fetching available versions for ${tool.label}…` },
            async () => { /* just show spinner while fetching */ }
        );

        const versions = await this.fetchWingetVersions(tool.wingetId);
        const items: vscode.QuickPickItem[] = [
            { label: 'Latest', description: '(recommended)', alwaysShow: true },
            ...versions.map(v => ({ label: v })),
        ];

        const picked = await vscode.window.showQuickPick(items, {
            title: `Install ${tool.label}`,
            placeHolder: versions.length > 0
                ? 'Select a version to install'
                : 'No version list available — will install latest',
        });
        if (!picked) { return; }

        const versionFlag = picked.label === 'Latest' ? '' : `--version ${picked.label}`;
        const cmd =
            `${WINGET_CMD}; ` +
            `if ($wg) { & $wg install --id ${tool.wingetId} -e${versionFlag ? ' ' + versionFlag : ''} } ` +
            `elseif (Get-Command choco -ErrorAction SilentlyContinue) { choco install ${tool.chocoId} -y } ` +
            `else { Write-Host 'winget and chocolatey not found.' -ForegroundColor Red }`;

        await this.runInTerminal(`Install ${tool.label}`, cmd, tool.exe, 'install');
    }

    /** Query available versions from `winget show --versions`. Returns newest-first list. */
    private async fetchWingetVersions(pkgId: string): Promise<string[]> {
        try {
            // Use PowerShell to resolve winget path and run show --versions
            const ps =
                `${WINGET_CMD}; ` +
                `if ($wg) { & $wg show --id ${pkgId} -e --versions } else { exit 1 }`;
            const { stdout } = await execFileAsync(
                'powershell', ['-NoProfile', '-NonInteractive', '-Command', ps],
                { timeout: 15000 }
            );
            return stdout
                .split('\n')
                .map(l => l.trim())
                .filter(l => /^\d+[\d.]/.test(l));
        } catch {
            return [];
        }
    }

    // ── Remove ────────────────────────────────────────────────────────────────

    async removeArmToolchain(): Promise<void> { await this.removeWithConfirm(ARM_TOOL,   this._armVersion); }
    async removeCmake():        Promise<void> { await this.removeWithConfirm(CMAKE_TOOL, this._cmakeVersion); }
    async removeNinja():        Promise<void> { await this.removeWithConfirm(NINJA_TOOL, this._ninjaVersion); }

    private async removeWithConfirm(tool: ToolDef, currentVersion: string | undefined): Promise<void> {
        const versionLabel = currentVersion ? ` (v${currentVersion})` : '';
        const confirm = await vscode.window.showWarningMessage(
            `Remove ${tool.label}${versionLabel}?`,
            { modal: true }, 'Remove'
        );
        if (confirm !== 'Remove') { return; }

        let cmd: string;
        if (process.platform === 'win32') {
            cmd =
                `${WINGET_CMD}; ` +
                `if ($wg) { & $wg uninstall --id ${tool.wingetId} -e } ` +
                `elseif (Get-Command choco -ErrorAction SilentlyContinue) { choco uninstall ${tool.chocoId} -y } ` +
                `else { Write-Host 'winget and chocolatey not found.' -ForegroundColor Red }`;
        } else {
            cmd = process.platform === 'darwin' ? tool.macCmd.replace('install', 'uninstall') : tool.linuxCmd.replace('install', 'remove');
        }

        await this.runInTerminal(`Remove ${tool.label}`, cmd, tool.exe, 'remove');
    }

    // ── Terminal runner ───────────────────────────────────────────────────────

    private async runInTerminal(
        terminalName: string, cmd: string,
        toolExe: string, action: 'install' | 'remove'
    ): Promise<void> {
        const terminal = vscode.window.createTerminal({
            name: terminalName,
            shellPath: process.platform === 'win32' ? 'powershell.exe' : undefined,
        });
        terminal.show();
        terminal.sendText(cmd);

        const btnLabel = action === 'install' ? 'Re-check & Set PATH' : 'Re-check Status';
        const msg = action === 'install'
            ? `Installing ${toolExe} in terminal. Click "${btnLabel}" when done.`
            : `Removing ${toolExe} in terminal. Click "${btnLabel}" when done.`;

        const result = await vscode.window.showInformationMessage(msg, btnLabel);
        if (result === btnLabel) {
            if (action === 'install') {
                await this.autoConfigurePath(toolExe);
            } else {
                await this.checkAll();
            }
        }
    }

    // ── PATH helpers ──────────────────────────────────────────────────────────

    private async autoConfigurePath(toolName: string): Promise<void> {
        const binDir = await this.findToolBinDir(toolName);
        if (!binDir) {
            vscode.window.showWarningMessage(
                `Could not locate ${toolName}. Please add it to PATH manually.`
            );
            await this.checkAll();
            return;
        }
        await this.addToPath(binDir);

        const exe = process.platform === 'win32' ? `${toolName}.exe` : toolName;
        const version = await this.queryVersion(path.join(binDir, exe), ['--version']);
        if (toolName === 'arm-none-eabi-gcc') { this._armVersion   = version; }
        else if (toolName === 'cmake')        { this._cmakeVersion = version; }
        else if (toolName === 'ninja')        { this._ninjaVersion = version; }
        this._checked = true;
        this._onDidChange.fire();

        vscode.window.showInformationMessage(
            `${toolName} ${version ?? ''} found at "${binDir}". ` +
            `Added to PATH. Reload window or restart terminal for changes to take effect.`
        );
    }

    private async queryVersion(cmd: string, args: string[]): Promise<string | undefined> {
        try {
            const { stdout } = await execFileAsync(cmd, args, { shell: true });
            const firstLine = stdout.split('\n')[0].trim();
            const match = firstLine.match(/\d+\.\d+[\.\d]*/);
            return match ? match[0] : firstLine.slice(0, 40);
        } catch {
            return undefined;
        }
    }

    private async findToolBinDir(toolName: string): Promise<string | undefined> {
        try {
            const whichCmd = process.platform === 'win32' ? 'where' : 'which';
            const { stdout } = await execFileAsync(whichCmd, [toolName], { shell: true });
            const first = stdout.trim().split('\n')[0].trim();
            if (first) { return path.dirname(first); }
        } catch { /* not in PATH */ }
        return this.searchCommonPaths(toolName);
    }

    private searchCommonPaths(toolName: string): string | undefined {
        const candidates: string[] = [];
        if (process.platform === 'win32') {
            if (toolName === 'arm-none-eabi-gcc') {
                for (const base of [
                    'C:\\Program Files (x86)\\Arm GNU Toolchain arm-none-eabi',
                    'C:\\Program Files\\Arm GNU Toolchain arm-none-eabi',
                ]) { candidates.push(...this.scanVersionedBinDirs(base)); }
            } else if (toolName === 'cmake') {
                candidates.push('C:\\Program Files\\CMake\\bin');
            } else if (toolName === 'ninja') {
                candidates.push('C:\\ProgramData\\chocolatey\\bin', 'C:\\Program Files\\CMake\\bin');
            }
        } else if (process.platform === 'darwin') {
            candidates.push('/opt/homebrew/bin', '/usr/local/bin');
        } else {
            candidates.push('/usr/bin', '/usr/local/bin');
        }
        const exe = process.platform === 'win32' ? `${toolName}.exe` : toolName;
        return candidates.find(p => fs.existsSync(path.join(p, exe)));
    }

    private scanVersionedBinDirs(base: string): string[] {
        if (!fs.existsSync(base)) { return []; }
        try {
            return fs.readdirSync(base)
                .filter(d => { try { return fs.statSync(path.join(base, d)).isDirectory(); } catch { return false; } })
                .sort().reverse()
                .map(d => path.join(base, d, 'bin'))
                .filter(p => fs.existsSync(p));
        } catch { return []; }
    }

    private async addToPath(binDir: string): Promise<void> {
        if (process.platform === 'win32') {
            const ps = `
                $cur = [Environment]::GetEnvironmentVariable('PATH','User')
                if ($cur -notlike '*${binDir.replace(/\\/g, '\\\\')}*') {
                    [Environment]::SetEnvironmentVariable('PATH', $cur + ';${binDir.replace(/\\/g, '\\\\')}', 'User')
                }`;
            try { await execFileAsync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps]); } catch { /* non-fatal */ }
        }
        await this.addToVscodeTerminalEnv(binDir);
    }

    private async addToVscodeTerminalEnv(binDir: string): Promise<void> {
        const key = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'osx' : 'linux';
        const sep = process.platform === 'win32' ? ';' : ':';
        const cfg = vscode.workspace.getConfiguration('terminal.integrated.env');
        const env: Record<string, string> = { ...(cfg.get<Record<string, string>>(key) ?? {}) };
        const existing = env['PATH'] ?? '';
        if (existing.split(sep).includes(binDir)) { return; }
        env['PATH'] = existing ? `${existing}${sep}${binDir}` : binDir;
        await cfg.update(key, env, vscode.ConfigurationTarget.Workspace);
    }
}
