import * as vscode from 'vscode';
import { ConfigManager, BuildType } from './configManager';
import { DebugManager } from './debugManager';
import { SdkManager } from './sdkManager';

export interface SettingsData {
    sourceFolder: string;
    configFile: string;
    chipName: string;
    buildType: string;
    elfFile: string;
    gdbPath: string;
    openocdPath: string;
    interfaceCfg: string;
    targetCfg: string;
    flashPort: string;
    flashBinFile: string;
    serialPort: string;
    serialBaudRate: string;
    sdkInstallPath: string;
}

export class SettingsPanel {
    private _panel: vscode.WebviewPanel | undefined;

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly config: ConfigManager,
        private readonly debugMgr: DebugManager,
        private readonly sdkMgr: SdkManager,
        private readonly onApply: (data: SettingsData) => void
    ) {}

    open(): void {
        if (this._panel) { this._panel.reveal(); return; }

        this._panel = vscode.window.createWebviewPanel(
            'mcuSettings', 'Settings',
            vscode.ViewColumn.One,
            { enableScripts: true, retainContextWhenHidden: true }
        );

        this._panel.webview.html = this.buildHtml(this.readAll());
        this._panel.webview.onDidReceiveMessage(msg => this.handleMessage(msg));
        this._panel.onDidDispose(() => { this._panel = undefined; });
    }

    /** Push current values into an already-open panel (e.g. after external change) */
    refresh(): void {
        if (this._panel) {
            this._panel.webview.postMessage({ type: 'load', data: this.readAll() });
        }
    }

    private readAll(): SettingsData {
        const dbg = vscode.workspace.getConfiguration('mcuBuild.debug');
        return {
            sourceFolder:   this.context.workspaceState.get<string>('mcuBuild.sourceFolder') ?? '',
            configFile:     this.config.configFile,
            chipName:       this.config.chipName,
            buildType:      this.config.buildType,
            elfFile:        dbg.get<string>('elfFile', ''),
            gdbPath:        dbg.get<string>('gdbPath', ''),
            openocdPath:    dbg.get<string>('openocdPath', ''),
            interfaceCfg:   dbg.get<string>('interfaceCfg', ''),
            targetCfg:      dbg.get<string>('targetCfg', ''),
            flashPort:      this.context.workspaceState.get<string>('mcuFlash.port') ?? '',
            flashBinFile:   this.context.workspaceState.get<string>('mcuFlash.binFile') ?? '',
            serialPort:     this.config.serialPort,
            serialBaudRate: String(this.config.serialBaudRate),
            sdkInstallPath: this.sdkMgr.installPath,
        };
    }

    private async handleMessage(msg: { type: string; key?: string; data?: SettingsData }): Promise<void> {
        if (msg.type === 'save' && msg.data) {
            await this.applyAll(msg.data);
            this._panel?.webview.postMessage({ type: 'saved' });
            return;
        }
        if (msg.type === 'browse' && msg.key) {
            const folderKeys = ['sourceFolder', 'sdkInstallPath'];
            const isFolder = folderKeys.includes(msg.key);
            const currentSource = this.context.workspaceState.get<string>('mcuBuild.sourceFolder');
            // ELF files live in build/; everything else defaults to the source folder
            const defaultPath = msg.key === 'elfFile' && currentSource
                ? require('path').join(currentSource, 'build')
                : currentSource;
            const defaultUri = defaultPath ? vscode.Uri.file(defaultPath) : undefined;
            const uris = await vscode.window.showOpenDialog({
                canSelectFiles: !isFolder,
                canSelectFolders: isFolder,
                canSelectMany: false,
                openLabel: isFolder ? 'Select Folder' : 'Select File',
                defaultUri,
            });
            if (uris?.[0]) {
                this._panel?.webview.postMessage({
                    type: 'fieldUpdated', key: msg.key, value: uris[0].fsPath,
                });
            }
        }
    }

    private async applyAll(s: SettingsData): Promise<void> {
        const ws = vscode.ConfigurationTarget.Workspace;
        const dbg = vscode.workspace.getConfiguration('mcuBuild.debug');

        // Project
        await this.context.workspaceState.update('mcuBuild.sourceFolder', s.sourceFolder || undefined);
        this.config.configFile  = s.configFile;
        this.config.chipName    = s.chipName;
        this.config.buildType   = s.buildType as BuildType;
        // Debug
        await dbg.update('elfFile',      s.elfFile,      ws);
        await dbg.update('gdbPath',      s.gdbPath,      ws);
        await dbg.update('openocdPath',  s.openocdPath,  ws);
        await dbg.update('interfaceCfg', s.interfaceCfg, ws);
        await dbg.update('targetCfg',    s.targetCfg,    ws);
        // Flash UART
        await this.context.workspaceState.update('mcuFlash.port',    s.flashPort    || undefined);
        await this.context.workspaceState.update('mcuFlash.binFile', s.flashBinFile || undefined);
        // Serial
        this.config.serialPort = s.serialPort;
        const baud = parseInt(s.serialBaudRate, 10);
        if (!isNaN(baud)) {
            vscode.workspace.getConfiguration('mcuBuild').update('serial.baudRate', baud, ws);
        }
        // SDK
        if (s.sdkInstallPath && s.sdkInstallPath !== this.sdkMgr.installPath) {
            this.sdkMgr.setInstallPath(s.sdkInstallPath);
        }

        this.onApply(s);
    }

    // ── HTML ──────────────────────────────────────────────────────────────────

    private buildHtml(d: SettingsData): string {
        const esc = (v: string) => v
            .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

        const chips = ['rf1301','rt581','rt582','rt583','rt584ha4','rt584h','rt584l'];
        const buildTypes = ['Debug','Release','RelWithDebInfo','MinSizeRel'];
        const baudRates = [9600,19200,38400,57600,115200,230400,460800,921600,1000000,2000000];

        const opts = (values: (string|number)[], current: string) =>
            values.map(v => `<option value="${v}"${String(v)===String(current)?' selected':''}>${v}</option>`).join('');

        const row = (label: string, id: string, value: string, placeholder: string, browseKey?: string) => `
        <div class="row">
            <label for="${id}">${label}</label>
            <input type="text" id="${id}" value="${esc(value)}" placeholder="${esc(placeholder)}">
            ${browseKey
                ? `<button class="browse" data-key="${browseKey}">Browse…</button>`
                : '<span></span>'}
        </div>`;

        const selRow = (label: string, id: string, optHtml: string) => `
        <div class="row">
            <label for="${id}">${label}</label>
            <select id="${id}">${optHtml}</select>
            <span></span>
        </div>`;

        return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
*,*::before,*::after { box-sizing: border-box; }
body {
    margin: 0; padding: 0 0 32px;
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    background: var(--vscode-editor-background);
    color: var(--vscode-editor-foreground);
}
.toolbar {
    position: sticky; top: 0; z-index: 10;
    display: flex; align-items: center; gap: 10px;
    padding: 8px 16px;
    background: var(--vscode-editor-background);
    border-bottom: 1px solid var(--vscode-panel-border, #333);
}
.toolbar h2 { margin: 0; font-size: 14px; flex: 1; }
#saveBtn {
    font-family: inherit; font-size: 12px; padding: 4px 16px;
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: none; border-radius: 3px; cursor: pointer;
}
#saveBtn:hover { filter: brightness(1.15); }
#feedback { font-size: 12px; color: #4ec9b0; min-width: 60px; text-align: right; }
.content { padding: 4px 16px; }
.section { margin: 12px 0 16px; }
.section-title {
    font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--vscode-descriptionForeground);
    padding: 4px 0 8px;
    border-bottom: 1px solid var(--vscode-panel-border, #333);
    margin-bottom: 6px;
}
.row {
    display: grid;
    grid-template-columns: 150px 1fr auto;
    gap: 6px; align-items: center;
    padding: 3px 0;
}
.row label { font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
input[type=text], select {
    font-family: inherit; font-size: 12px;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, #555);
    padding: 3px 7px; border-radius: 2px; outline: none; width: 100%;
}
input[type=text]:focus, select:focus { border-color: var(--vscode-focusBorder, #007fd4); }
button.browse {
    font-family: inherit; font-size: 11px; white-space: nowrap;
    background: var(--vscode-button-secondaryBackground, #3c3c3c);
    color: var(--vscode-button-secondaryForeground, #ccc);
    border: none; padding: 3px 10px; border-radius: 2px; cursor: pointer;
}
button.browse:hover { filter: brightness(1.15); }
</style>
</head>
<body>
<div class="toolbar">
    <h2>Settings</h2>
    <span id="feedback"></span>
    <button id="saveBtn">Save All</button>
</div>
<div class="content">

<div class="section">
    <div class="section-title">Project</div>
    ${row('Source Folder', 'sourceFolder', d.sourceFolder, 'e.g. C:\\\\project', 'sourceFolder')}
    ${row('Config File',   'configFile',   d.configFile,   'auto-detect',        'configFile')}
    ${selRow('Chip Name',  'chipName',
        `<option value="">-- not set --</option>${opts(chips, d.chipName)}`)}
    ${selRow('Build Type', 'buildType', opts(buildTypes, d.buildType))}
</div>

<div class="section">
    <div class="section-title">CMSIS-DAP Debug</div>
    ${row('ELF File',        'elfFile',      d.elfFile,      'auto-detect from build/', 'elfFile')}
    ${row('GDB Path',        'gdbPath',      d.gdbPath,      'arm-none-eabi-gdb',       'gdbPath')}
    ${row('OpenOCD Path',    'openocdPath',  d.openocdPath,  'auto-detect',             'openocdPath')}
    ${row('Interface Config','interfaceCfg', d.interfaceCfg, 'interface/cmsis-dap.cfg')}
    ${row('Target Config',   'targetCfg',    d.targetCfg,    'target/rt584.cfg')}
</div>

<div class="section">
    <div class="section-title">Flash (UART)</div>
    ${row('COM Port', 'flashPort',    d.flashPort,    'e.g. COM3')}
    ${row('BIN File', 'flashBinFile', d.flashBinFile, 'auto-detect from build/', 'flashBinFile')}
</div>

<div class="section">
    <div class="section-title">Serial Monitor</div>
    ${row('Port', 'serialPort', d.serialPort, 'e.g. COM3')}
    ${selRow('Baud Rate', 'serialBaudRate', opts(baudRates, d.serialBaudRate))}
</div>

<div class="section">
    <div class="section-title">SDK</div>
    ${row('Install Path', 'sdkInstallPath', d.sdkInstallPath, 'e.g. C:\\\\', 'sdkInstallPath')}
</div>

</div>
<script>
const vscode = acquireVsCodeApi();
const FIELDS = ['sourceFolder','configFile','chipName','buildType',
                'elfFile','gdbPath','openocdPath','interfaceCfg','targetCfg',
                'flashPort','flashBinFile','serialPort','serialBaudRate','sdkInstallPath'];
const feedback = document.getElementById('feedback');

function gather() {
    const d = {};
    for (const id of FIELDS) { d[id] = document.getElementById(id).value; }
    return d;
}

document.getElementById('saveBtn').addEventListener('click', () => {
    vscode.postMessage({ type: 'save', data: gather() });
});

document.querySelectorAll('button.browse').forEach(btn => {
    btn.addEventListener('click', () => {
        vscode.postMessage({ type: 'browse', key: btn.dataset.key });
    });
});

window.addEventListener('message', ({ data: msg }) => {
    switch (msg.type) {
        case 'saved':
            feedback.textContent = '✓ Saved';
            setTimeout(() => { feedback.textContent = ''; }, 2000);
            break;
        case 'fieldUpdated': {
            const el = document.getElementById(msg.key);
            if (el) { el.value = msg.value; }
            break;
        }
        case 'load':
            for (const [k, v] of Object.entries(msg.data)) {
                const el = document.getElementById(k);
                if (el) { el.value = String(v); }
            }
            break;
    }
});
</script>
</body>
</html>`;
    }
}
