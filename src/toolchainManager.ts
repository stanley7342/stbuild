import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export class ToolchainManager {
    private _armVersion: string | undefined;
    private _cmakeVersion: string | undefined;
    private _ninjaVersion: string | undefined;
    private _checked = false;

    private _onDidChange = new vscode.EventEmitter<void>();
    readonly onDidChange = this._onDidChange.event;

    /** Run all checks and fire onDidChange when done. */
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

    get armStatus(): string {
        if (!this._checked) { return 'checking…'; }
        return this._armVersion ?? 'not installed';
    }

    get cmakeStatus(): string {
        if (!this._checked) { return 'checking…'; }
        return this._cmakeVersion ?? 'not installed';
    }

    get ninjaStatus(): string {
        if (!this._checked) { return 'checking…'; }
        return this._ninjaVersion ?? 'not installed';
    }

    get armInstalled(): boolean { return !!this._armVersion; }
    get cmakeInstalled(): boolean { return !!this._cmakeVersion; }
    get ninjaInstalled(): boolean { return !!this._ninjaVersion; }

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

    async installArmToolchain(): Promise<void> {
        const cmd = this.buildInstallCommand(
            'Arm.GnuArmEmbeddedToolchain',  // winget
            'gcc-arm-embedded',              // choco
            'brew install --cask gcc-arm-embedded',
            'sudo apt-get install -y gcc-arm-none-eabi binutils-arm-none-eabi'
        );
        await this.runInstall('Install ARM Toolchain', cmd, 'arm-none-eabi-gcc');
    }

    async installCmake(): Promise<void> {
        const cmd = this.buildInstallCommand(
            'Kitware.CMake',   // winget
            'cmake',           // choco
            'brew install cmake',
            'sudo apt-get install -y cmake'
        );
        await this.runInstall('Install CMake', cmd, 'cmake');
    }

    async installNinja(): Promise<void> {
        const cmd = this.buildInstallCommand(
            'Ninja-build.Ninja',  // winget
            'ninja',              // choco
            'brew install ninja',
            'sudo apt-get install -y ninja-build'
        );
        await this.runInstall('Install Ninja', cmd, 'ninja');
    }

    async removeArmToolchain(): Promise<void> {
        const confirm = await vscode.window.showWarningMessage(
            'Remove ARM Cortex-M toolchain (arm-none-eabi-gcc)?',
            { modal: true }, 'Remove'
        );
        if (confirm !== 'Remove') { return; }
        const cmd = this.buildRemoveCommand(
            'Arm.GnuArmEmbeddedToolchain',
            'gcc-arm-embedded',
            'brew uninstall --cask gcc-arm-embedded',
            'sudo apt-get remove -y gcc-arm-none-eabi binutils-arm-none-eabi'
        );
        await this.runRemove('Remove ARM Toolchain', cmd, 'arm-none-eabi-gcc');
    }

    async removeCmake(): Promise<void> {
        const confirm = await vscode.window.showWarningMessage(
            'Remove CMake?',
            { modal: true }, 'Remove'
        );
        if (confirm !== 'Remove') { return; }
        const cmd = this.buildRemoveCommand(
            'Kitware.CMake',
            'cmake',
            'brew uninstall cmake',
            'sudo apt-get remove -y cmake'
        );
        await this.runRemove('Remove CMake', cmd, 'cmake');
    }

    async removeNinja(): Promise<void> {
        const confirm = await vscode.window.showWarningMessage(
            'Remove Ninja?',
            { modal: true }, 'Remove'
        );
        if (confirm !== 'Remove') { return; }
        const cmd = this.buildRemoveCommand(
            'Ninja-build.Ninja',
            'ninja',
            'brew uninstall ninja',
            'sudo apt-get remove -y ninja-build'
        );
        await this.runRemove('Remove Ninja', cmd, 'ninja');
    }

    /** Returns the remove command string for the current platform. */
    private buildRemoveCommand(
        wingetPkg: string, chocoPkg: string,
        macCmd: string, linuxCmd: string
    ): string {
        if (process.platform === 'win32') {
            return (
                `if (Get-Command winget -ErrorAction SilentlyContinue) ` +
                `{ winget uninstall --id ${wingetPkg} -e } ` +
                `elseif (Get-Command choco -ErrorAction SilentlyContinue) ` +
                `{ choco uninstall ${chocoPkg} -y } ` +
                `else { Write-Host 'Neither winget nor chocolatey found.' -ForegroundColor Red }`
            );
        }
        return process.platform === 'darwin' ? macCmd : linuxCmd;
    }

    private async runRemove(terminalName: string, cmd: string, toolName: string): Promise<void> {
        const terminal = vscode.window.createTerminal(terminalName);
        terminal.show();
        terminal.sendText(cmd);

        const action = await vscode.window.showInformationMessage(
            `Removing ${toolName} in terminal. Click "Re-check Status" when done.`,
            'Re-check Status'
        );
        if (action === 'Re-check Status') {
            await this.checkAll();
        }
    }

    /** Returns the install command string for the current platform. */
    private buildInstallCommand(
        wingetPkg: string, chocoPkg: string,
        macCmd: string, linuxCmd: string
    ): string {
        if (process.platform === 'win32') {
            // PowerShell: try winget → choco → error message
            return (
                `if (Get-Command winget -ErrorAction SilentlyContinue) ` +
                `{ winget install --id ${wingetPkg} -e } ` +
                `elseif (Get-Command choco -ErrorAction SilentlyContinue) ` +
                `{ choco install ${chocoPkg} -y } ` +
                `else { Write-Host 'Neither winget nor chocolatey found.' ` +
                `'Install winget (App Installer from Microsoft Store) or chocolatey (chocolatey.org) first.' ` +
                `-ForegroundColor Red }`
            );
        }
        return process.platform === 'darwin' ? macCmd : linuxCmd;
    }

    private async runInstall(terminalName: string, cmd: string, toolName: string): Promise<void> {
        const terminal = vscode.window.createTerminal(terminalName);
        terminal.show();
        terminal.sendText(cmd);

        const action = await vscode.window.showInformationMessage(
            `Installing ${toolName} in terminal. Click "Re-check & Set PATH" when installation is complete.`,
            'Re-check & Set PATH'
        );
        if (action === 'Re-check & Set PATH') {
            await this.autoConfigurePath(toolName);
        }
    }

    // ── PATH helpers ─────────────────────────────────────────────────────────

    /** Find the bin directory for a tool, configure PATH, and update version fields directly. */
    private async autoConfigurePath(toolName: string): Promise<void> {
        const binDir = await this.findToolBinDir(toolName);
        if (!binDir) {
            vscode.window.showWarningMessage(
                `Could not locate ${toolName} installation directory. Please add it to PATH manually.`
            );
            return;
        }
        await this.addToPath(binDir);

        // Query version via full path — bypasses the stale process PATH
        const exe = process.platform === 'win32' ? `${toolName}.exe` : toolName;
        const version = await this.queryVersion(path.join(binDir, exe), ['--version']);
        if (toolName === 'arm-none-eabi-gcc') {
            this._armVersion = version;
        } else if (toolName === 'cmake') {
            this._cmakeVersion = version;
        } else if (toolName === 'ninja') {
            this._ninjaVersion = version;
        }
        this._checked = true;
        this._onDidChange.fire();

        vscode.window.showInformationMessage(
            `${toolName} ${version ?? ''} found at "${binDir}". ` +
            `Added to user PATH and VS Code terminal env. ` +
            `Please restart your terminal (or reload VS Code window) for the change to take effect.`
        );
    }

    /**
     * Returns the directory containing the tool executable.
     * First tries shell which/where; falls back to scanning known install paths.
     */
    private async findToolBinDir(toolName: string): Promise<string | undefined> {
        try {
            const whichCmd = process.platform === 'win32' ? 'where' : 'which';
            const { stdout } = await execFileAsync(whichCmd, [toolName], { shell: true });
            const first = stdout.trim().split('\n')[0].trim();
            if (first) { return path.dirname(first); }
        } catch { /* not in current PATH */ }

        return this.searchCommonPaths(toolName);
    }

    /** Search platform-specific default install locations. */
    private searchCommonPaths(toolName: string): string | undefined {
        const candidates: string[] = [];

        if (process.platform === 'win32') {
            if (toolName === 'arm-none-eabi-gcc') {
                for (const base of [
                    'C:\\Program Files (x86)\\Arm GNU Toolchain arm-none-eabi',
                    'C:\\Program Files\\Arm GNU Toolchain arm-none-eabi',
                ]) {
                    candidates.push(...this.scanVersionedBinDirs(base));
                }
            } else if (toolName === 'cmake') {
                candidates.push('C:\\Program Files\\CMake\\bin');
            } else if (toolName === 'ninja') {
                candidates.push(
                    'C:\\ProgramData\\chocolatey\\bin',
                    'C:\\Program Files\\CMake\\bin',
                );
            }
        } else if (process.platform === 'darwin') {
            candidates.push('/opt/homebrew/bin', '/usr/local/bin');
        } else {
            candidates.push('/usr/bin', '/usr/local/bin');
        }

        const exe = process.platform === 'win32' ? `${toolName}.exe` : toolName;
        return candidates.find(p => fs.existsSync(path.join(p, exe)));
    }

    /** List `<base>/<version>/bin` dirs, newest version first. */
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

    /**
     * 1. On Windows: permanently add binDir to the current user's PATH via PowerShell.
     * 2. On all platforms: append binDir to VS Code's terminal.integrated.env so
     *    new integrated terminals inherit it immediately (without restarting the OS).
     */
    private async addToPath(binDir: string): Promise<void> {
        if (process.platform === 'win32') {
            // Persist to HKCU via PowerShell (no elevation required)
            const ps = `
                $cur = [Environment]::GetEnvironmentVariable('PATH','User')
                if ($cur -notlike '*${binDir.replace(/\\/g, '\\\\')}*') {
                    [Environment]::SetEnvironmentVariable('PATH', $cur + ';${binDir.replace(/\\/g, '\\\\')}', 'User')
                }
            `;
            try {
                await execFileAsync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps]);
            } catch {
                // Non-fatal — VS Code env setting still works
            }
        }

        await this.addToVscodeTerminalEnv(binDir);
    }

    /** Append binDir to terminal.integrated.env.<platform> in workspace settings. */
    private async addToVscodeTerminalEnv(binDir: string): Promise<void> {
        const key = process.platform === 'win32' ? 'windows'
                  : process.platform === 'darwin'  ? 'osx'
                  : 'linux';
        const sep = process.platform === 'win32' ? ';' : ':';

        const cfg = vscode.workspace.getConfiguration('terminal.integrated.env');
        const env: Record<string, string> = { ...(cfg.get<Record<string, string>>(key) ?? {}) };
        const existing = env['PATH'] ?? '';

        if (existing.split(sep).includes(binDir)) { return; }  // already present

        env['PATH'] = existing ? `${existing}${sep}${binDir}` : binDir;
        await cfg.update(key, env, vscode.ConfigurationTarget.Workspace);
    }
}
