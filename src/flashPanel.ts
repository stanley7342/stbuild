import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

export class FlashPanel {
    private panel: vscode.WebviewPanel | undefined;
    private bridge: cp.ChildProcess | undefined;
    private bridgeBuf = '';
    private flashProc: cp.ChildProcess | undefined;

    /** Set by extension when sourceFolder is selected */
    sourceFolder: string | undefined;

    /** Set active BIN file from outside (e.g. Output Files tree) */
    setBinFile(filePath: string): void {
        this.postToWebview({ type: 'binSelected', path: filePath });
    }

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly output: vscode.OutputChannel
    ) {}

    open(): void {
        if (this.panel) {
            this.panel.reveal();
            // Re-send auto-detected bin in case build folder changed
            this.sendAutoBin();
            return;
        }

        this.panel = vscode.window.createWebviewPanel(
            'mcuFlashPanel',
            'Flash Firmware',
            vscode.ViewColumn.One,
            { enableScripts: true, retainContextWhenHidden: true }
        );

        this.panel.webview.html = this.buildHtml();

        this.panel.webview.onDidReceiveMessage(msg => this.handleMessage(msg));

        this.panel.onDidDispose(() => {
            this.bridge?.kill();
            this.bridge = undefined;
            this.flashProc?.kill();
            this.flashProc = undefined;
            this.panel = undefined;
        });

        // List ports + auto-detect bin once the panel is ready
        this.ensureBridge().then(() => {
            this.sendPortList();
            this.sendAutoBin();
        });
    }

    /** Scan build dir for .bin files and pre-fill the panel */
    private sendAutoBin(): void {
        const buildDir = this.sourceFolder
            ? path.join(this.sourceFolder, 'build')
            : undefined;
        if (!buildDir || !fs.existsSync(buildDir)) { return; }

        const bins = fs.readdirSync(buildDir)
            .filter(f => f.endsWith('.bin'))
            .map(f => path.join(buildDir, f));

        if (bins.length > 0) {
            this.postToWebview({ type: 'binSelected', path: bins[0] });
        }
    }

    // ── Bridge (reuse serialBridge.js for port listing) ──────────────────────

    private ensureBridge(): Promise<void> {
        if (this.bridge && !this.bridge.killed) { return Promise.resolve(); }
        return new Promise((resolve, reject) => {
            const extDir = this.context.extensionPath;
            const script = path.join(extDir, 'out', 'serialBridge.js');
            this.bridge = cp.spawn('node', [script, extDir], { stdio: ['pipe', 'pipe', 'pipe'] });
            this.bridgeBuf = '';
            this.bridge.stdout?.setEncoding('utf8');
            this.bridge.stdout?.on('data', (chunk: string) => {
                this.bridgeBuf += chunk;
                let nl: number;
                while ((nl = this.bridgeBuf.indexOf('\n')) !== -1) {
                    const line = this.bridgeBuf.slice(0, nl).trim();
                    this.bridgeBuf = this.bridgeBuf.slice(nl + 1);
                    if (!line) { continue; }
                    try { this.onBridgeMessage(JSON.parse(line)); } catch { /* ignore */ }
                }
            });
            this.bridge.stderr?.on('data', (d: Buffer) => {
                console.error('[flashPanel bridge]', d.toString());
            });
            this.bridge.on('error', err => reject(err));
            // Give bridge a moment to load serialport module
            setTimeout(() => resolve(), 300);
        });
    }

    private sendToBridge(obj: object): void {
        this.bridge?.stdin?.write(JSON.stringify(obj) + '\n');
    }

    private onBridgeMessage(msg: { type: string; ports?: { path: string; manufacturer: string }[] }): void {
        if (msg.type === 'portList') {
            const ports = (msg.ports ?? []).map(p => ({
                value: p.path,
                label: p.manufacturer ? `${p.path}  (${p.manufacturer})` : p.path,
            }));
            this.postToWebview({ type: 'portList', ports });
        }
    }

    private sendPortList(): void {
        this.ensureBridge().then(() => this.sendToBridge({ cmd: 'list' }));
    }

    // ── Webview message handler ────────────────────────────────────────────────

    private async handleMessage(msg: { type: string; port?: string; binFile?: string }): Promise<void> {
        switch (msg.type) {
            case 'listPorts':
                this.sendPortList();
                break;
            case 'browseBin': {
                const uris = await vscode.window.showOpenDialog({
                    canSelectFiles: true,
                    canSelectFolders: false,
                    canSelectMany: false,
                    openLabel: 'Select BIN file',
                    filters: { 'Binary files': ['bin'], 'All files': ['*'] },
                });
                if (uris?.[0]) {
                    this.postToWebview({ type: 'binSelected', path: uris[0].fsPath });
                }
                break;
            }
            case 'flash':
                await this.doFlash(msg.port ?? '', msg.binFile ?? '');
                break;
            case 'cancel':
                this.flashProc?.kill();
                break;
        }
    }

    // ── Flash execution ────────────────────────────────────────────────────────

    private async doFlash(port: string, binFile: string): Promise<void> {
        if (!port) {
            this.log('[Error] No COM port selected.', 'error');
            this.postToWebview({ type: 'flashDone', success: false });
            return;
        }
        if (!binFile || !fs.existsSync(binFile)) {
            this.log('[Error] BIN file not found: ' + binFile, 'error');
            this.postToWebview({ type: 'flashDone', success: false });
            return;
        }

        const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
        const cfg = vscode.workspace.getConfiguration('mcuBuild');
        const ispRelPath = cfg.get<string>('flash.ispToolPath', 'C:\\Users\\Stanley\\rex_hand_over\\isp_download_cmd_tool\\isp_dw_cmd.exe').trim().replace(/^["']|["']$/g, '');
        const ispTool = path.isAbsolute(ispRelPath) ? ispRelPath : path.join(root, ispRelPath);

        if (!fs.existsSync(ispTool)) {
            this.log(`[Error] ISP tool not found: ${ispTool}\nSet mcuBuild.flash.ispToolPath in settings.`, 'error');
            this.postToWebview({ type: 'flashDone', success: false });
            return;
        }

        const args = ['-p', port, '-a', binFile];
        this.log(`> ${ispTool} ${args.join(' ')}`, 'cmd');
        this.postToWebview({ type: 'flashStart' });

        this.flashProc = cp.spawn(ispTool, args, { cwd: root, shell: true });

        this.flashProc.stdout?.on('data', (d: Buffer) => {
            const t = d.toString();
            this.log(t, null);
            this.output.append(t);
        });
        this.flashProc.stderr?.on('data', (d: Buffer) => {
            const t = d.toString();
            this.log(t, null);
            this.output.append(t);
        });

        this.flashProc.on('close', (code) => {
            const success = code === 0;
            this.log(success ? '\n[Done] Flash successful!' : `\n[Error] Flash failed (exit code ${code}).`,
                success ? 'ok' : 'error');
            this.postToWebview({ type: 'flashDone', success });
            this.flashProc = undefined;
        });

        this.flashProc.on('error', (err) => {
            this.log(`[Error] ${err.message}`, 'error');
            this.postToWebview({ type: 'flashDone', success: false });
            this.flashProc = undefined;
        });
    }

    private log(text: string, style: 'error' | 'ok' | 'cmd' | null): void {
        this.postToWebview({ type: 'log', text, style });
    }

    private postToWebview(msg: object): void {
        this.panel?.webview.postMessage(msg);
    }

    // ── HTML ───────────────────────────────────────────────────────────────────

    private buildHtml(): string {
        return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Flash Firmware</title>
<style>
  *, *::before, *::after { box-sizing: border-box; }
  body {
    margin: 0; padding: 16px;
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    background: var(--vscode-editor-background);
    color: var(--vscode-editor-foreground);
    display: flex; flex-direction: column; height: 100vh; gap: 12px;
  }
  h2 { margin: 0 0 4px; font-size: 15px; }
  .row { display: flex; gap: 8px; align-items: center; }
  .label { min-width: 90px; font-size: 12px; color: var(--vscode-descriptionForeground); }
  select, input[type=text] {
    flex: 1; font-family: inherit; font-size: 13px;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, #555);
    padding: 4px 8px; border-radius: 3px;
  }
  button {
    font-family: inherit; font-size: 12px;
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: none; padding: 4px 12px; border-radius: 3px; cursor: pointer;
  }
  button:hover { filter: brightness(1.15); }
  button:disabled { opacity: 0.45; cursor: default; filter: none; }
  #flashBtn { font-size: 13px; padding: 6px 24px;
    background: var(--vscode-statusBarItem-remoteBackground, #16825d); }
  #cancelBtn {
    background: var(--vscode-statusBarItem-errorBackground, #c72e0f);
  }
  .divider { border: none; border-top: 1px solid var(--vscode-panel-border, #333); margin: 4px 0; }
  #statusText { font-size: 12px; color: var(--vscode-descriptionForeground); }
  /* Log */
  #logToggle {
    font-size: 12px; color: var(--vscode-descriptionForeground);
    cursor: pointer; user-select: none; display: flex; align-items: center; gap: 4px;
  }
  #logToggle:hover { color: var(--vscode-foreground); }
  #log {
    flex: 1; overflow-y: auto; display: none;
    font-family: var(--vscode-editor-font-family, 'Courier New', monospace);
    font-size: var(--vscode-editor-font-size, 12px);
    background: var(--vscode-terminal-background, #1e1e1e);
    color: var(--vscode-terminal-foreground, #cccccc);
    padding: 8px; border-radius: 3px; white-space: pre-wrap; word-break: break-all;
  }
  #log.visible { display: block; }
  .log-error { color: #f48771; }
  .log-ok    { color: #4ec9b0; }
  .log-cmd   { color: #dcdcaa; }
</style>
</head>
<body>
<h2>⚡ Flash Firmware (UART)</h2>
<hr class="divider">

<div class="row">
  <span class="label">COM Port</span>
  <select id="portSel"></select>
  <button id="refreshPortsBtn">↻</button>
</div>

<div class="row">
  <span class="label">BIN File</span>
  <input type="text" id="binPath" placeholder="Select a .bin file..." readonly>
  <button id="browseBtn">Browse…</button>
</div>

<hr class="divider">

<div class="row">
  <button id="flashBtn">Flash</button>
  <button id="cancelBtn" disabled>Cancel</button>
  <span id="statusText">Ready</span>
</div>

<div id="logToggle">▶ Output</div>
<div id="log"></div>

<script>
const vscode = acquireVsCodeApi();
const portSel  = document.getElementById('portSel');
const binPath  = document.getElementById('binPath');
const flashBtn = document.getElementById('flashBtn');
const cancelBtn = document.getElementById('cancelBtn');
const statusText = document.getElementById('statusText');
const log = document.getElementById('log');

// Init
vscode.postMessage({ type: 'listPorts' });

document.getElementById('refreshPortsBtn').addEventListener('click', () => {
  vscode.postMessage({ type: 'listPorts' });
});

document.getElementById('browseBtn').addEventListener('click', () => {
  vscode.postMessage({ type: 'browseBin' });
});

flashBtn.addEventListener('click', () => {
  const port = portSel.value;
  const binFile = binPath.value;
  log.innerHTML = '';
  statusText.textContent = 'Ready';
  vscode.postMessage({ type: 'flash', port, binFile });
});

cancelBtn.addEventListener('click', () => {
  vscode.postMessage({ type: 'cancel' });
});

document.getElementById('logToggle').addEventListener('click', () => {
  const visible = log.classList.toggle('visible');
  document.getElementById('logToggle').textContent = (visible ? '▼' : '▶') + ' Output';
});

window.addEventListener('message', ({ data: msg }) => {
  switch (msg.type) {
    case 'portList': {
      const cur = portSel.value;
      portSel.innerHTML = msg.ports.length
        ? msg.ports.map(p => \`<option value="\${p.value}">\${p.label}</option>\`).join('')
        : '<option value="">-- no ports --</option>';
      if (cur && msg.ports.some(p => p.value === cur)) { portSel.value = cur; }
      break;
    }
    case 'binSelected':
      binPath.value = msg.path;
      break;
    case 'flashStart':
      flashBtn.disabled = true;
      cancelBtn.disabled = false;
      statusText.textContent = 'Flashing…';
      log.innerHTML = '';
      log.classList.add('visible');
      document.getElementById('logToggle').textContent = '▼ Output';
      break;
    case 'flashDone':
      flashBtn.disabled = false;
      cancelBtn.disabled = true;
      statusText.textContent = msg.success ? 'Done ✓' : 'Failed ✗';
      break;
    case 'log': {
      const span = document.createElement('span');
      if (msg.style) { span.className = 'log-' + msg.style; }
      span.textContent = msg.text;
      log.appendChild(span);
      log.scrollTop = log.scrollHeight;
      break;
    }
  }
});
</script>
</body>
</html>`;
    }

    dispose(): void {
        this.bridge?.kill();
        this.flashProc?.kill();
        this.panel?.dispose();
    }
}
