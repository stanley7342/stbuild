import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { ConfigManager } from './configManager';

export type BuildStatus = 'idle' | 'configuring' | 'building' | 'success' | 'failed';

export class BuildManager implements vscode.Disposable {
    private currentProcess: cp.ChildProcess | null = null;
    private _status: BuildStatus = 'idle';
    cmakeSourceDir: string | undefined;

    private readonly _onStatusChanged = new vscode.EventEmitter<BuildStatus>();
    readonly onStatusChanged = this._onStatusChanged.event;

    constructor(
        private readonly config: ConfigManager,
        private readonly output: vscode.OutputChannel
    ) {}

    get status(): BuildStatus {
        return this._status;
    }

    private setStatus(status: BuildStatus): void {
        this._status = status;
        this._onStatusChanged.fire(status);
    }

    async build(onProgress?: (increment: number, message: string) => void): Promise<boolean> {
        const root = this.config.getWorkspaceRoot();
        if (!root) {
            vscode.window.showErrorMessage('不關我的事，哈哈!');
            return false;
        }

        const sourceDir = this.cmakeSourceDir ?? root;
        const buildDir = path.join(sourceDir, 'build');

        if (!fs.existsSync(path.join(sourceDir, 'CMakeLists.txt'))) {
            vscode.window.showErrorMessage(`史丹利測試: CMakeLists.txt not found in ${sourceDir}`);
            return false;
        }

        // ── Clear stale cache if source directory changed ─────────────────────
        const cacheFile = path.join(buildDir, 'CMakeCache.txt');
        if (fs.existsSync(cacheFile)) {
            const cacheContent = fs.readFileSync(cacheFile, 'utf8');
            const match = cacheContent.match(/^CMAKE_HOME_DIRECTORY:INTERNAL=(.+)$/m);
            if (match) {
                const cachedSource = match[1].trim().replace(/[\\/]/g, '/');
                const currentSource = root.replace(/[\\/]/g, '/');
                if (cachedSource !== currentSource) {
                    fs.unlinkSync(cacheFile);
                    this.output.appendLine(`[史丹利測試] Source changed (${cachedSource} → ${currentSource}), cleared CMakeCache.txt\n`);
                }
            }
        }

        // ── Configure ────────────────────────────────────────────────────────
        const configArgs = [
            '-S', '.',
            '-B', buildDir,
            '-G', 'Ninja',
            `-DCMAKE_BUILD_TYPE=${this.config.buildType}`,
            `-DCMAKE_MAKE_PROGRAM=${this.config.ninjaPath}`,
        ];
        if (this.config.configFile) {
            const relConfig = path.relative(root, this.config.configFile).replace(/\\/g, '/');
            configArgs.push(`-DCUSTOM_CONFIG_DIR=${relConfig}`);
        }
        if (this.config.toolchainFile) {
            configArgs.push(`-DCMAKE_TOOLCHAIN_FILE=${this.config.toolchainFile}`);
        }
        configArgs.push(...this.config.configureArgs);

        this.setStatus('configuring');
        this.output.show(true);
        this.output.appendLine(`\n[史丹利測試] ── Configure + Build ──────────────────────`);
        this.output.appendLine(`> cmake ${configArgs.join(' ')}\n`);

        const configured = await this.spawn(this.config.cmakePath, configArgs, root);
        if (!configured) {
            this.setStatus('failed');
            vscode.window.showErrorMessage('史丹利測試: Configure failed. See Output panel for details.');
            return false;
        }
        this.output.appendLine('\n[史丹利測試] Configure OK — building…\n');

        // ── Build ─────────────────────────────────────────────────────────────
        const buildArgs = ['--build', buildDir, '--clean-first', '--target', 'all', '--config', this.config.buildType];

        this.setStatus('building');
        this.output.appendLine(`> cmake ${buildArgs.join(' ')}\n`);

        const ok = await this.spawn(this.config.cmakePath, buildArgs, buildDir, onProgress);
        this.setStatus(ok ? 'success' : 'failed');

        if (ok) {
            this.output.appendLine('\n[史丹利測試] Build successful!\n');
            vscode.window.showInformationMessage('史丹利測試: Build successful!');
        } else {
            vscode.window.showErrorMessage('史丹利測試: Build failed. See Output panel for details.');
        }
        return ok;
    }

    async clean(): Promise<boolean> {
        const sourceDir = this.cmakeSourceDir ?? this.config.getWorkspaceRoot();
        const buildDir = path.join(sourceDir, 'build');
        if (!fs.existsSync(buildDir)) {
            this.output.appendLine('\n[史丹利測試] Nothing to clean (build directory does not exist).\n');
            return true;
        }

        const cleanArgs = ['--build', buildDir, '--target', 'clean'];
        this.output.show(true);
        this.output.appendLine(`\n[史丹利測試] ── Clean ────────────────────────`);
        this.output.appendLine(`> cmake ${cleanArgs.join(' ')}\n`);

        const ok = await this.spawn(this.config.cmakePath, cleanArgs, buildDir);
        if (ok) {
            this.output.appendLine('\n[史丹利測試] Clean successful.\n');
            vscode.window.showInformationMessage('史丹利測試: Clean successful.');
        }
        return ok;
    }

    async rebuild(onProgress?: (increment: number, message: string) => void): Promise<boolean> {
        await this.clean();
        return this.build(onProgress);
    }

    cancel(): void {
        if (this.currentProcess) {
            this.currentProcess.kill();
            this.currentProcess = null;
            this.setStatus('idle');
            this.output.appendLine('\n[史丹利測試] Build cancelled.\n');
        }
    }

    private spawn(
        command: string,
        args: string[],
        cwd: string,
        onProgress?: (increment: number, message: string) => void
    ): Promise<boolean> {
        return new Promise((resolve) => {
            this.currentProcess = cp.spawn(command, args, { cwd, shell: true });

            let lastPct = 0;
            let lineBuf = '';

            const parseLine = (line: string) => {
                this.output.appendLine(line);
                if (!onProgress) { return; }
                // Ninja progress: [x/y] Building C object .../foo.c.obj
                const m = line.match(/^\[(\d+)\/(\d+)\]\s+(.*)/);
                if (!m) { return; }
                const pct = Math.round((parseInt(m[1], 10) / parseInt(m[2], 10)) * 100);
                const file = path.basename(m[3].replace(/^.*\s/, '').replace(/\.obj$/, ''));
                const inc = Math.max(0, pct - lastPct);
                lastPct = pct;
                onProgress(inc, `[${m[1]}/${m[2]}] ${file}`);
            };

            const onData = (chunk: Buffer) => {
                const raw = (lineBuf + chunk.toString()).split('\n');
                lineBuf = raw.pop() ?? '';
                for (const line of raw) { parseLine(line.trimEnd()); }
            };

            this.currentProcess.stdout?.on('data', onData);
            this.currentProcess.stderr?.on('data', onData);
            this.currentProcess.on('close', (code) => {
                if (lineBuf) { parseLine(lineBuf); lineBuf = ''; }
                this.currentProcess = null;
                resolve(code === 0);
            });
            this.currentProcess.on('error', (err) => {
                this.output.appendLine(`[史丹利測試] Error spawning cmake: ${err.message}`);
                this.currentProcess = null;
                resolve(false);
            });
        });
    }

    dispose(): void {
        this._onStatusChanged.dispose();
        this.cancel();
    }
}
