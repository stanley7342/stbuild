import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';

export interface ProbeInfo {
    connected: boolean;
    name?: string;   // friendly name
    iceId?: string;  // USB serial / ICE ID
}

export class DebugManager {
    /** Set to the selected Source Files folder so flash/debug use its build/ subdir */
    sourceDir: string | undefined;

    private _probe: ProbeInfo = { connected: false };
    private _probeTimer: ReturnType<typeof setInterval> | undefined;
    private _openocdTerminal: vscode.Terminal | undefined;
    private _flashProc: import('child_process').ChildProcess | undefined;

    constructor(private readonly output: vscode.OutputChannel) {
        this.pollProbe();
    }

    get probe(): ProbeInfo { return this._probe; }

    /** Start periodic CMSIS-DAP probe detection (every 3 s) */
    startProbePolling(onChanged: () => void): void {
        if (this._probeTimer) { return; }
        this._probeTimer = setInterval(async () => {
            const prev = this._probe.connected;
            this._probe = await this.detectProbe();
            if (this._probe.connected !== prev) {
                if (this._probe.connected) {
                    this.output.appendLine(`[CMSIS-DAP] ID: ${this._probe.iceId ?? 'Unknown'}`)
                } else {
                    this.output.appendLine(`[CMSIS-DAP] Disconnected`);
                }
                onChanged();
            }
        }, 3000);
    }

    stopProbePolling(): void {
        if (this._probeTimer) { clearInterval(this._probeTimer); this._probeTimer = undefined; }
    }

    private async pollProbe(): Promise<void> {
        this._probe = await this.detectProbe();
    }

    /** Detect connected CMSIS-DAP / DAPLink device via platform-specific command */
    private detectProbe(): Promise<ProbeInfo> {
        return new Promise(resolve => {
            let cmd: string;
            if (process.platform === 'win32') {
                // Return JSON with FriendlyName and InstanceId (contains USB serial as last segment)
                cmd = `powershell -NoProfile -Command "` +
                    `$d = Get-PnpDevice -Status OK | Where-Object { $_.FriendlyName -match 'CMSIS-DAP|DAPLink|CMSIS_DAP|USB JTAG' } | Select-Object -First 1; ` +
                    `if ($d) { Write-Output ($d.FriendlyName + '|' + $d.InstanceId) } else { exit 1 }"`;
            } else if (process.platform === 'darwin') {
                cmd = `system_profiler SPUSBDataType 2>/dev/null | grep -i -A4 'cmsis-dap\\|daplink' | head -8`;
            } else {
                cmd = `lsusb -v 2>/dev/null | grep -i -A5 'cmsis-dap\\|daplink' | head -12`;
            }

            exec(cmd, { timeout: 4000 }, (err, stdout) => {
                const out = stdout.trim();
                if (!err && out.length > 0) {
                    if (process.platform === 'win32') {
                        const [name, instanceId] = out.split('|');
                        // InstanceId format: USB\VID_xxxx&PID_xxxx\<serial>
                        const iceId = instanceId?.split('\\').pop()?.trim();
                        resolve({ connected: true, name: name?.trim(), iceId });
                    } else if (process.platform === 'darwin') {
                        const nameLine = out.split('\n')[0].trim();
                        const serialMatch = out.match(/Serial Number:\s*(.+)/i);
                        resolve({ connected: true, name: nameLine, iceId: serialMatch?.[1]?.trim() });
                    } else {
                        const nameLine = out.split('\n')[0].trim();
                        const serialMatch = out.match(/iSerial\s+\d+\s+(\S+)/i);
                        resolve({ connected: true, name: nameLine, iceId: serialMatch?.[1]?.trim() });
                    }
                } else {
                    resolve({ connected: false });
                }
            });
        });
    }

    private get cfg() {
        return vscode.workspace.getConfiguration('mcuBuild.debug');
    }

    get elfFile(): string     { return this.cfg.get<string>('elfFile', ''); }
    get gdbPath(): string     { return this.cfg.get<string>('gdbPath', 'arm-none-eabi-gdb'); }
    /** Resolved OpenOCD path: setting → workspace auto-detect → system PATH fallback */
    get openocdPath(): string {
        const manual = this.cfg.get<string>('openocdPath', '');
        if (manual) { return manual; }
        return this.detectWorkspaceOpenOcd() ?? 'openocd';
    }
    get interfaceCfg(): string { return this.cfg.get<string>('interfaceCfg', '') || this.detectScriptPath('interface/cmsis-dap.cfg'); }
    get targetCfg(): string   { return this.cfg.get<string>('targetCfg', '') || this.detectScriptPath('target/rt584.cfg'); }
    get gdbPort(): number     { return this.cfg.get<number>('gdbPort', 50000); }
    get device(): string      { return this.cfg.get<string>('device', 'RT584L'); }

    /** Find openocd_rt58x.sh in the workspace */
    private detectOpenOcdScript(): string | undefined {
        const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!ws) { return undefined; }
        const candidates = [
            path.join(ws, 'tools', 'Debugger', 'OpenOCD', 'script', 'openocd_rt58x.sh'),
            path.join(ws, 'tools', 'Debugger', 'openocd_rt58x.sh'),
            path.join(ws, 'openocd_rt58x.sh'),
        ];
        return candidates.find(p => fs.existsSync(p));
    }

    /**
     * Map device/SoC name to OpenOCD target cfg, mirroring openocd_rt58x.sh logic.
     * rt581/rt582/rt583 → target/rt58x.cfg
     * rt584l/rt584h/rt584ha4/rf1301 → target/rt584.cfg (default)
     */
    private socToTargetCfg(device: string): string {
        const soc = device.toLowerCase();
        if (soc === 'rt581' || soc === 'rt582' || soc === 'rt583') {
            return 'target/rt58x.cfg';
        }
        return 'target/rt584.cfg';
    }

    /** Search workspace for OpenOCD executable under known SDK paths */
    private detectWorkspaceOpenOcd(): string | undefined {
        const platDir = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux';
        const exe = process.platform === 'win32' ? 'openocd.exe' : 'openocd';
        const searchRoots = [
            this.sourceDir,
            vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
        ].filter((r): r is string => Boolean(r));
        for (const root of searchRoots) {
            const candidates = [
                path.join(root, 'tools', 'Debugger', 'OpenOCD', 'bin', platDir, exe),
                path.join(root, 'tools', 'Debugger', 'OpenOCD', 'bin', exe),
                path.join(root, 'toolchain', 'openocd', 'bin', exe),
                path.join(root, 'tools', 'openocd', exe),
            ];
            const found = candidates.find(p => fs.existsSync(p));
            if (found) { return found; }
        }
        return undefined;
    }

    /** Given the OpenOCD exe path, find its adjacent script/scripts directory */
    private detectOpenOcdScriptDir(openocdExe: string): string | undefined {
        // e.g. .../OpenOCD/bin/win/openocd.exe → .../OpenOCD/script
        let dir = path.dirname(openocdExe);          // bin/win
        for (let i = 0; i < 3; i++) {
            dir = path.dirname(dir);
            for (const name of ['script', 'scripts', 'share/openocd/scripts']) {
                const candidate = path.join(dir, name);
                if (fs.existsSync(candidate)) { return candidate; }
            }
        }
        return undefined;
    }

    /** Resolve an OpenOCD script path: prefer workspace SDK scripts dir */
    private detectScriptPath(relative: string): string {
        const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (ws) {
            const sdkScript = path.join(ws, 'tools', 'Debugger', 'OpenOCD', 'script', relative);
            if (fs.existsSync(sdkScript)) { return sdkScript; }
        }
        return relative;
    }

    set elfFile(v: string)    { this.cfg.update('elfFile', v, vscode.ConfigurationTarget.Workspace); }
    set gdbPath(v: string)    { this.cfg.update('gdbPath', v, vscode.ConfigurationTarget.Workspace); }
    set openocdPath(v: string) { this.cfg.update('openocdPath', v, vscode.ConfigurationTarget.Workspace); }
    set interfaceCfg(v: string) { this.cfg.update('interfaceCfg', v, vscode.ConfigurationTarget.Workspace); }
    set targetCfg(v: string)  { this.cfg.update('targetCfg', v, vscode.ConfigurationTarget.Workspace); }
    set device(v: string)     { this.cfg.update('device', v, vscode.ConfigurationTarget.Workspace); }

    /** Auto-detect the most recently modified .elf file from the given build directory */
    autoDetectElf(buildDir: string): string | undefined {
        if (!fs.existsSync(buildDir)) { return undefined; }
        try {
            const files = fs.readdirSync(buildDir)
                .filter(f => f.toLowerCase().endsWith('.elf'))
                .map(f => ({ f, mtime: fs.statSync(path.join(buildDir, f)).mtimeMs }))
                .sort((a, b) => b.mtime - a.mtime);
            return files.length > 0 ? path.join(buildDir, files[0].f) : undefined;
        } catch { return undefined; }
    }

    /** Build a cortex-debug configuration that connects to the already-running OpenOCD server */
    private buildLaunchConfig(workspaceFolder: string, elf: string): vscode.DebugConfiguration {
        const gdbPort = this.gdbPort;
        return {
            type: 'cortex-debug',
            request: 'attach',
            name: 'CMSIS-DAP Debug',
            servertype: 'external',
            gdbTarget: `localhost:${gdbPort}`,
            executable: elf,
            gdbPath: this.gdbPath,
            device: this.device,
            cwd: workspaceFolder,
            showDevDebugOutput: 'both',
            // Reset and halt the target before GDB starts the session.
            // Without this, cortex-debug gets "debug reason 8 (UNDEFINED) - target needs reset"
            // because the CPU is running (not halted) when we attach.
            overrideAttachCommands: [
                'monitor reset halt',
                'monitor halt',
            ],
            postAttachCommands: [
                'set mem inaccessible-by-default off',
                'set remotetimeout 10',
            ],
        };
    }

    /** Open a terminal running openocd for the current device/SoC.
     *  Windows: calls openocd.exe directly (the .sh uses a Linux binary + sudo).
     *  Linux/Mac: runs openocd_rt58x.sh via bash.
     */
    private startOpenOcdTerminal(scriptFile: string): void {
        const soc = this.device.toLowerCase();
        this._openocdTerminal?.dispose();
        this._openocdTerminal = undefined;

        let cmd: string;
        if (process.platform === 'win32') {
            // On Windows, replicate the script using openocd.exe (the .sh uses a Linux binary + sudo)
            const openocdExe = this.openocdPath;   // auto-detects bin/win/openocd.exe
            let scriptDir = this.detectOpenOcdScriptDir(openocdExe);
            if (!scriptDir) { scriptDir = path.dirname(scriptFile); }
            const targetCfg = this.socToTargetCfg(this.device);
            const gdbPort = this.gdbPort;
            cmd = `& "${openocdExe}" -s "${scriptDir}" -f interface/cmsis-dap.cfg -f "${targetCfg}" -c "gdb_port ${gdbPort}; tcl_port ${gdbPort + 1}; telnet_port ${gdbPort + 2}"`;
        } else {
            // Linux / macOS: run the script directly
            cmd = `bash "${scriptFile}" ${soc}`;
        }

        this.output.appendLine(`[史丹利測試] Terminal cmd: ${cmd}`);
        const term = vscode.window.createTerminal({ name: 'OpenOCD (RT58x)' });
        this._openocdTerminal = term;
        term.sendText(cmd, true);
        term.show(false);   // show but don't steal focus
    }

    /** Cancel a running flashWithOpenOcd() call by killing the child process */
    cancelFlash(): void {
        if (this._flashProc) {
            this._flashProc.kill();
            this._flashProc = undefined;
            this.output.appendLine('[史丹利測試] Flash cancelled by user.');
        }
    }

    /** Kill the running OpenOCD terminal (called when debug session terminates) */
    stopOpenOcd(): void {
        if (this._openocdTerminal) {
            this._openocdTerminal.sendText('\x03');   // Ctrl+C — interrupt the process
            this._openocdTerminal.dispose();
            this._openocdTerminal = undefined;
            this.output.appendLine('[史丹利測試] OpenOCD terminated.');
        }
    }

    /** Flash firmware to target using OpenOCD's "program … verify reset exit" command */
    async flashWithOpenOcd(onPhaseProgress?: (phase: 'erase' | 'flash', pct: number) => void): Promise<void> {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders?.length) { vscode.window.showErrorMessage('No workspace folder open.'); return; }
        const wsPath = folders[0].uri.fsPath;

        // Always use the newest ELF from the source folder's build/ directory
        const searchRoot = this.sourceDir ?? wsPath;
        let elf: string | undefined;
        for (const candidate of ['build', 'out']) {
            const detected = this.autoDetectElf(path.join(searchRoot, candidate));
            if (detected) { elf = detected; break; }
        }
        if (!elf) {
            const pick = await vscode.window.showWarningMessage(
                'No ELF file found in build/ or out/. Build the project first.',
                'Select ELF…', 'Cancel'
            );
            if (pick === 'Select ELF…') {
                await this.selectElf();
                elf = this.elfFile;
            }
            if (!elf) { return; }
        }

        const mtime = fs.statSync(elf).mtime.toLocaleString();
        vscode.window.showInformationMessage(`Flashing: ${path.basename(elf)}  (${mtime})`);

        const openocdExe = this.openocdPath;
        let scriptDir = this.detectOpenOcdScriptDir(openocdExe);
        const scriptFile = this.detectOpenOcdScript();
        if (!scriptDir && scriptFile) { scriptDir = path.dirname(scriptFile); }
        const targetCfg = this.socToTargetCfg(this.device);
        const elfForOcd = elf.replace(/\\/g, '/');

        this.output.appendLine(`[史丹利測試] ── Flash with OpenOCD ───────────────`);
        this.output.appendLine(`[史丹利測試] ELF    : ${elf}`);
        this.output.appendLine(`[史丹利測試] OpenOCD: ${openocdExe}`);
        this.output.appendLine(`[史丹利測試] Target : ${targetCfg}`);
        this.output.show(false);

        // Run OpenOCD as a tracked child process so callers can await completion
        await new Promise<void>((resolve, reject) => {
            const args: string[] = [
                ...(scriptDir ? ['-s', scriptDir] : []),
                '-f', 'interface/cmsis-dap.cfg',
                '-f', targetCfg,
                '-c', `program {${elfForOcd}} verify reset exit`,
            ];
            const proc = require('child_process').spawn(openocdExe, args, { stdio: 'pipe' });
            this._flashProc = proc;

            // Phase-aware progress: erase 0-100% and write 0-100% tracked separately
            let currentPhase: 'erase' | 'write' | 'none' = 'none';
            let erasePct = 0, writePct = 0;
            const reportErase = (pct: number) => {
                if (!onPhaseProgress || pct <= erasePct) { return; }
                onPhaseProgress('erase', pct);
                erasePct = pct;
            };
            const reportWrite = (pct: number) => {
                if (!onPhaseProgress || pct <= writePct) { return; }
                onPhaseProgress('flash', pct);
                writePct = pct;
            };

            // Line buffer: collapse \r-overwritten progress lines into a single output line
            let lineBuf = '';
            let lastOutputLine = '';
            const flushLine = (raw: string) => {
                const noTrailingCr = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
                const lastCr = noTrailingCr.lastIndexOf('\r');
                const line = lastCr >= 0 ? noTrailingCr.slice(lastCr + 1) : noTrailingCr;
                if (!line) { return; }
                if (line === lastOutputLine) { return; }
                lastOutputLine = line;
                this.output.appendLine(line);
            };
            const onData = (d: Buffer) => {
                const raw = d.toString();
                // Detect phase from context lines
                if (/Erasing sectors/i.test(raw))  { currentPhase = 'erase'; }
                if (/Writing block of/i.test(raw)) { currentPhase = 'write'; }
                // Use the last percentage in this chunk (most recent update)
                const allPcts = [...raw.matchAll(/(\d+)%/g)];
                if (allPcts.length > 0) {
                    const pct = parseInt(allPcts[allPcts.length - 1][1], 10);
                    if (currentPhase === 'erase')      { reportErase(pct); }
                    else if (currentPhase === 'write') { reportWrite(pct); }
                }
                // Split on \n; buffer incomplete last line across chunks
                const parts = (lineBuf + raw).split('\n');
                lineBuf = parts.pop() ?? '';
                for (const part of parts) { flushLine(part); }
            };
            proc.stdout?.on('data', onData);
            proc.stderr?.on('data', onData);
            proc.on('close', (code: number | null, signal: string | null) => {
                this._flashProc = undefined;
                if (lineBuf) { flushLine(lineBuf); lineBuf = ''; }
                if (signal) {
                    // Killed by cancelFlash()
                    reject(new Error('Cancelled'));
                } else if (code === 0) {
                    reportWrite(100);
                    this.output.appendLine(`[史丹利測試] Flash done ✓`);
                    vscode.window.showInformationMessage(`Flash done ✓  ${path.basename(elf!)}`);
                    resolve();
                } else {
                    this.output.appendLine(`[史丹利測試] Flash failed (exit ${code})`);
                    reject(new Error(`Flash failed (exit ${code})`));
                }
            });
            proc.on('error', (err: Error) => {
                this._flashProc = undefined;
                this.output.appendLine(`[史丹利測試] Flash error: ${err.message}`);
                reject(err);
            });
        });
    }

    /** Start a debug session */
    async startDebug(): Promise<void> {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders?.length) {
            vscode.window.showErrorMessage('No workspace folder open.');
            return;
        }
        const workspaceFolder = folders[0];
        const wsPath = workspaceFolder.uri.fsPath;

        // Resolve ELF from source folder's build/ directory
        const searchRoot = this.sourceDir ?? wsPath;
        let elf = this.elfFile && fs.existsSync(this.elfFile) ? this.elfFile : undefined;
        if (!elf) {
            for (const candidate of ['build', 'out']) {
                const detected = this.autoDetectElf(path.join(searchRoot, candidate));
                if (detected) { elf = detected; break; }
            }
        }
        if (!elf || !fs.existsSync(elf)) {
            const pick = await vscode.window.showWarningMessage(
                `ELF file not found: ${elf || '(none)'}\nBuild the project first or set the ELF path manually.`,
                'Select ELF…', 'Start Anyway'
            );
            if (pick === 'Select ELF…') {
                await this.selectElf();
                elf = this.elfFile;
                if (!elf) { return; }
            } else if (pick !== 'Start Anyway') {
                return;
            }
        }

        // Find and launch openocd_rt58x.sh in a terminal
        const scriptFile = this.detectOpenOcdScript();
        if (!scriptFile) {
            vscode.window.showErrorMessage(
                'openocd_rt58x.sh not found in workspace. Expected at tools/Debugger/OpenOCD/script/openocd_rt58x.sh'
            );
            return;
        }

        this.output.appendLine(`\n[史丹利測試] ── CMSIS-DAP Debug (cortex-debug) ───`);
        this.output.appendLine(`[史丹利測試] SoC    : ${this.device}`);
        this.output.appendLine(`[史丹利測試] Script : ${scriptFile}`);
        this.output.appendLine(`[史丹利測試] ELF    : ${elf}`);
        this.output.appendLine(`[史丹利測試] GDB    : ${this.gdbPath}`);
        this.output.appendLine(`[史丹利測試] Port   : ${this.gdbPort}`);
        this.output.appendLine(`[史丹利測試] Starting OpenOCD via openocd_rt58x.sh...`);

        this.startOpenOcdTerminal(scriptFile);

        // Give OpenOCD a moment to initialise before GDB connects
        await new Promise<void>(r => setTimeout(r, 2500));

        const cfg = this.buildLaunchConfig(wsPath, elf || '${workspaceFolder}/build/firmware.elf');
        const started = await vscode.debug.startDebugging(workspaceFolder, cfg);
        if (!started) {
            vscode.window.showErrorMessage(
                'Failed to start debug session. Make sure the C/C++ extension (ms-vscode.cpptools) is installed.'
            );
        }
    }

    /** Write / update .vscode/launch.json */
    async generateLaunchJson(): Promise<void> {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders?.length) { vscode.window.showErrorMessage('No workspace folder open.'); return; }
        const wsFolder = folders[0].uri.fsPath;
        const vscodeDir = path.join(wsFolder, '.vscode');
        const launchPath = path.join(vscodeDir, 'launch.json');

        fs.mkdirSync(vscodeDir, { recursive: true });

        let json: { version: string; configurations: vscode.DebugConfiguration[] } = {
            version: '0.2.0', configurations: [],
        };
        if (fs.existsSync(launchPath)) {
            try { json = JSON.parse(fs.readFileSync(launchPath, 'utf8')); } catch { /* use default */ }
        }

        const elfForJson = this.elfFile || '${workspaceFolder}/build/firmware.elf';
        const newCfg = this.buildLaunchConfig(wsFolder, elfForJson);
        const idx = json.configurations.findIndex(c => c.name === newCfg.name);
        if (idx >= 0) { json.configurations[idx] = newCfg; }
        else { json.configurations.push(newCfg); }

        fs.writeFileSync(launchPath, JSON.stringify(json, null, 4), 'utf8');
        const doc = await vscode.workspace.openTextDocument(launchPath);
        await vscode.window.showTextDocument(doc);
        vscode.window.showInformationMessage('launch.json updated with CMSIS-DAP config.');
    }

    async selectElf(): Promise<void> {
        const buildDir = this.sourceDir ? path.join(this.sourceDir, 'build') : undefined;
        const uris = await vscode.window.showOpenDialog({
            canSelectFiles: true, canSelectFolders: false, canSelectMany: false,
            openLabel: 'Select ELF File',
            filters: { 'ELF files': ['elf', 'out', 'axf'], 'All files': ['*'] },
            defaultUri: buildDir ? vscode.Uri.file(buildDir) : undefined,
        });
        if (uris?.[0]) { this.elfFile = uris[0].fsPath; }
    }

    async selectInterface(): Promise<void> {
        const pick = await vscode.window.showQuickPick([
            { label: 'CMSIS-DAP',  detail: 'interface/cmsis-dap.cfg' },
            { label: 'CMSIS-DAP v2', detail: 'interface/cmsis-dap-v2.cfg' },
            { label: 'J-Link',     detail: 'interface/jlink.cfg' },
            { label: 'ST-Link v2', detail: 'interface/stlink-v2.cfg' },
            { label: 'ST-Link v3', detail: 'interface/stlink.cfg' },
            { label: 'Custom…',    detail: '' },
        ], { placeHolder: 'Select debug interface' });
        if (!pick) { return; }
        if (pick.label === 'Custom…') {
            const val = await vscode.window.showInputBox({ prompt: 'Enter interface config path', value: this.interfaceCfg });
            if (val !== undefined) { this.interfaceCfg = val; }
        } else {
            this.interfaceCfg = pick.detail;
        }
    }

    async selectOpenOcd(): Promise<void> {
        const detected = this.detectWorkspaceOpenOcd();
        const current = this.cfg.get<string>('openocdPath', '');
        const items: vscode.QuickPickItem[] = [
            {
                label: '$(search) Auto-detect',
                description: detected ?? 'not found in workspace',
                detail: 'Search workspace first, fallback to system PATH',
            },
            {
                label: '$(folder) Browse…',
                description: 'Select OpenOCD executable manually',
            },
        ];
        if (current) {
            items.unshift({
                label: '$(debug-disconnect) Current: ' + path.basename(current),
                description: current,
                detail: 'Keep current manual setting',
            });
        }
        const pick = await vscode.window.showQuickPick(items, {
            title: 'Select OpenOCD',
            placeHolder: detected
                ? `Auto-detected: ${detected}`
                : 'No OpenOCD found in workspace — will use system PATH',
        });
        if (!pick) { return; }
        if (pick.label.includes('Auto-detect')) {
            // Clear manual setting → auto-detect will take over
            await this.cfg.update('openocdPath', '', vscode.ConfigurationTarget.Workspace);
        } else if (pick.label.includes('Browse')) {
            const uris = await vscode.window.showOpenDialog({
                canSelectFiles: true, canSelectFolders: false, canSelectMany: false,
                openLabel: 'Select OpenOCD',
                filters: { 'Executable': ['exe', ''], 'All files': ['*'] },
            });
            if (uris?.[0]) {
                await this.cfg.update('openocdPath', uris[0].fsPath, vscode.ConfigurationTarget.Workspace);
            }
        }
    }

    async selectTarget(): Promise<void> {
        const val = await vscode.window.showInputBox({
            prompt: 'Enter OpenOCD target config path',
            value: this.targetCfg,
            placeHolder: 'e.g. target/rt584.cfg',
        });
        if (val !== undefined) { this.targetCfg = val; }
    }
}
