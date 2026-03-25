import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import { ConfigManager } from './configManager';

interface PortInfo {
    path: string;
    manufacturer?: string;
    pnpId?: string;
}

export class SerialMonitor implements vscode.Disposable {
    private panel: vscode.WebviewPanel | undefined;
    private bridge: cp.ChildProcess | undefined;
    private bridgeBuf = '';
    private connected = false;

    constructor(
        private readonly config: ConfigManager,
        private readonly context: vscode.ExtensionContext
    ) {}

    async open(): Promise<void> {
        if (this.panel) {
            this.panel.reveal(vscode.ViewColumn.Two);
            return;
        }

        this.panel = vscode.window.createWebviewPanel(
            'mcuSerialMonitor',
            'Serial Monitor',
            vscode.ViewColumn.Two,
            { enableScripts: true, retainContextWhenHidden: true }
        );

        this.panel.webview.html = this.buildHtml(
            this.config.serialPort,
            this.config.serialBaudRate
        );

        this.panel.webview.onDidReceiveMessage(async (msg) => {
            switch (msg.type) {
                case 'connect':
                    this.connectPort(msg.port as string, msg.baudRate as number);
                    break;
                case 'disconnect':
                    this.disconnectPort();
                    break;
                case 'send':
                    this.writeData(msg.data as string);
                    break;
                case 'listPorts':
                    this.sendPortList();
                    break;
            }
        }, undefined, this.context.subscriptions);

        this.panel.onDidDispose(() => {
            this.disconnectPort();
            this.panel = undefined;
        }, undefined, this.context.subscriptions);

        this.sendPortList();
    }

    async selectPort(): Promise<string | undefined> {
        const ports = await this.listPorts();
        const MANUAL = '$(edit)  Enter port manually…';

        const items: vscode.QuickPickItem[] = [
            ...ports.map(p => ({ label: p.path, description: p.manufacturer ?? p.pnpId ?? '' })),
            { label: MANUAL, description: '' },
        ];

        const pick = await vscode.window.showQuickPick(items, {
            placeHolder: ports.length > 0 ? 'Select serial port' : 'No ports detected — enter manually',
        });
        if (!pick) { return undefined; }

        let portPath: string | undefined;
        if (pick.label === MANUAL) {
            portPath = await vscode.window.showInputBox({
                prompt: 'Enter serial port path',
                placeHolder: process.platform === 'win32' ? 'e.g. COM3' : 'e.g. /dev/ttyUSB0',
                value: this.config.serialPort,
            });
        } else {
            portPath = pick.label;
        }

        if (portPath) {
            this.config.serialPort = portPath;
        }
        return portPath;
    }

    private ensureBridge(): void {
        if (this.bridge && !this.bridge.killed) { return; }

        const extDir = this.context.extensionPath;
        const scriptPath = path.join(extDir, 'out', 'serialBridge.js');

        this.bridge = cp.spawn('node', [scriptPath, extDir], { stdio: ['pipe', 'pipe', 'pipe'] });
        this.bridgeBuf = '';

        this.bridge.stdout?.setEncoding('utf8');
        this.bridge.stdout?.on('data', (chunk: string) => {
            this.bridgeBuf += chunk;
            let nl: number;
            while ((nl = this.bridgeBuf.indexOf('\n')) !== -1) {
                const line = this.bridgeBuf.slice(0, nl).trim();
                this.bridgeBuf = this.bridgeBuf.slice(nl + 1);
                if (!line) { continue; }
                try {
                    const msg = JSON.parse(line);
                    if (msg.type === 'connected') { this.connected = true; }
                    if (msg.type === 'disconnected') { this.connected = false; }
                    this.postToWebview(msg);
                } catch { /* ignore */ }
            }
        });

        this.bridge.stderr?.on('data', (chunk: Buffer) => {
            this.postToWebview({ type: 'error', message: chunk.toString() });
        });
    }

    private sendToBridge(msg: object): void {
        this.ensureBridge();
        this.bridge?.stdin?.write(JSON.stringify(msg) + '\n');
    }

    private connectPort(portPath: string, baudRate: number): void {
        this.sendToBridge({ cmd: 'open', path: portPath, baudRate });
    }

    private disconnectPort(): void {
        if (this.connected) { this.sendToBridge({ cmd: 'close' }); }
    }

    private writeData(data: string): void {
        if (this.connected) { this.sendToBridge({ cmd: 'write', data }); }
    }

    private sendPortList(): void {
        this.ensureBridge();
        this.sendToBridge({ cmd: 'list' });
    }

    private listPorts(): Promise<PortInfo[]> {
        return new Promise((resolve) => {
            this.ensureBridge();
            const onPortList = (msg: { type: string; ports?: PortInfo[] }) => {
                if (msg.type === 'portList') { resolve(msg.ports ?? []); }
            };
            // Temporarily intercept next portList message
            const origPost = this.postToWebview.bind(this);
            this.postToWebview = (msg: unknown) => {
                const m = msg as { type: string; ports?: PortInfo[] };
                if (m.type === 'portList') {
                    this.postToWebview = origPost;
                    onPortList(m);
                } else {
                    origPost(msg);
                }
            };
            this.sendToBridge({ cmd: 'list' });
        });
    }

    private postToWebview(message: unknown): void {
        this.panel?.webview.postMessage(message);
    }

    private buildHtml(initialPort: string, initialBaud: number): string {
        const baudRates = [1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600];
        const baudOptions = baudRates
            .map(b => `<option value="${b}"${b === initialBaud ? ' selected' : ''}>${b}</option>`)
            .join('');

        return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Serial Monitor</title>
<style>
  *, *::before, *::after { box-sizing: border-box; }
  body {
    margin: 0; padding: 8px;
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    background: var(--vscode-editor-background);
    color: var(--vscode-editor-foreground);
    display: flex; flex-direction: column; height: 100vh; gap: 6px;
  }
  .toolbar { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  select, input[type="text"], button {
    font-family: inherit; font-size: 12px;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, #555);
    padding: 3px 8px; border-radius: 3px;
  }
  button {
    cursor: pointer;
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: none;
  }
  button:hover { filter: brightness(1.15); }
  #connectBtn.danger { background: var(--vscode-statusBarItem-errorBackground, #c72e0f); }
  .badge {
    font-size: 11px; padding: 2px 8px; border-radius: 10px;
    background: var(--vscode-badge-background);
    color: var(--vscode-badge-foreground);
  }
  .badge.ok { background: #2ea043; color: #fff; }
  #terminal {
    flex: 1; overflow-y: auto; outline: none; cursor: text;
    font-family: var(--vscode-editor-font-family, 'Courier New', monospace);
    font-size: var(--vscode-editor-font-size, 13px);
    background: var(--vscode-terminal-background, #1e1e1e);
    color: var(--vscode-terminal-foreground, #cccccc);
    padding: 8px; border-radius: 3px;
    white-space: pre-wrap; word-break: break-all;
  }
  #terminal:focus { outline: 1px solid var(--vscode-focusBorder, #007fd4); }
  #cursor {
    display: inline-block; width: 0.55em; height: 1.1em;
    background: var(--vscode-terminal-foreground, #cccccc);
    vertical-align: text-bottom;
    animation: blink 1s step-end infinite;
  }
  #terminal:not(:focus) #cursor { animation: none; opacity: 0.4; }
  @keyframes blink { 50% { opacity: 0; } }
  label { font-size: 12px; display: flex; align-items: center; gap: 3px; }
</style>
</head>
<body>
<div class="toolbar">
  <select id="portSel" title="Serial port"></select>
  <input id="portManual" type="text" placeholder="or type port…" style="width:110px" title="Manual port entry"/>
  <select id="baudSel" title="Baud rate">${baudOptions}</select>
  <button id="connectBtn">Connect</button>
  <button id="clearBtn">Clear</button>
  <label><input type="checkbox" id="autoScrollChk" checked> Auto-scroll</label>
  <label><input type="checkbox" id="timestampChk"> Timestamp</label>
  <label><input type="checkbox" id="localEchoChk" checked> Local echo</label>
  <select id="eolSel" title="Line ending">
    <option value="crlf">CR+LF</option>
    <option value="lf">LF</option>
    <option value="cr">CR</option>
    <option value="none">None</option>
  </select>
  <span id="badge" class="badge">Disconnected</span>
</div>
<div id="terminal" tabindex="0"><span id="content"></span><span id="cursor"> </span></div>
<script>
const vscode = acquireVsCodeApi();
let connected = false;
let dataBuf = '';

const portSel    = document.getElementById('portSel');
const portManual = document.getElementById('portManual');
const badge      = document.getElementById('badge');
const terminal   = document.getElementById('terminal');
const content    = document.getElementById('content');
const connectBtn = document.getElementById('connectBtn');

${initialPort ? `portSel.innerHTML = '<option value="${initialPort}">${initialPort}</option>';` : ''}

// Wire up buttons via addEventListener (avoids CSP issues with inline onclick)
connectBtn.addEventListener('click', toggleConnect);
document.getElementById('clearBtn').addEventListener('click', clearTerminal);

// portManual hides the select while typing
portManual.addEventListener('input', () => {
  portSel.value = '';
  portSel.style.display = portManual.value ? 'none' : '';
});
portManual.addEventListener('focus', () => { portSel.style.display = 'none'; });
portManual.addEventListener('blur',  () => { if (!portManual.value) portSel.style.display = ''; });

// Focus terminal on click
terminal.addEventListener('click', () => terminal.focus());

// Map eolSel option value → actual bytes
function getEol() {
  switch (document.getElementById('eolSel').value) {
    case 'crlf': return '\\r\\n';
    case 'lf':   return '\\n';
    case 'cr':   return '\\r';
    default:     return '';
  }
}

// TeraTerm style: every keypress sends immediately
terminal.addEventListener('keydown', e => {
  if (e.altKey || e.metaKey) { return; }
  if (e.ctrlKey) {
    if (e.key === 'c' || e.key === 'a') { return; } // allow copy / select-all
    e.preventDefault();
    if (e.key.length === 1) {
      const code = e.key.toUpperCase().charCodeAt(0) - 64;
      if (code > 0 && code < 32) { sendChar(String.fromCharCode(code)); }
    }
    return;
  }
  e.preventDefault();

  const echo = document.getElementById('localEchoChk').checked;
  if (e.key === 'Enter') {
    sendChar(getEol() || '\\r\\n');
    if (echo) { appendRaw('\\n', '#dcdcaa'); }
  } else if (e.key === 'Backspace') {
    sendChar('\\x08');
    if (echo) { echoBackspace(); }
  } else if (e.key === 'Tab') {
    sendChar('\\t');
    if (echo) { appendRaw('\\t', '#dcdcaa'); }
  } else if (e.key === 'Escape')     { sendChar('\\x1b'); }
  else if (e.key === 'Delete')       { sendChar('\\x7f'); }
  else if (e.key === 'ArrowUp')      { sendChar('\\x1b[A'); }
  else if (e.key === 'ArrowDown')    { sendChar('\\x1b[B'); }
  else if (e.key === 'ArrowRight')   { sendChar('\\x1b[C'); }
  else if (e.key === 'ArrowLeft')    { sendChar('\\x1b[D'); }
  else if (e.key.length === 1) {
    sendChar(e.key);
    if (echo) { appendRaw(e.key, '#dcdcaa'); }
  }
});

function echoBackspace() {
  // Walk backwards through child spans to remove the last visible character,
  // but never cross a newline boundary.
  let node = content.lastChild;
  while (node) {
    const t = node.textContent;
    if (t.length > 0) {
      const last = t[t.length - 1];
      if (last === '\\n') { return; } // do not delete past a newline
      node.textContent = t.slice(0, -1);
      if (node.textContent.length === 0) { content.removeChild(node); }
      return;
    }
    const prev = node.previousSibling;
    content.removeChild(node);
    node = prev;
  }
}

function sendChar(data) {
  if (!connected) { return; }
  vscode.postMessage({ type: 'send', data });
}

// Init — request port list
vscode.postMessage({ type: 'listPorts' });

window.addEventListener('message', ({ data: msg }) => {
  switch (msg.type) {
    case 'portList': {
      const cur = portSel.value;
      portSel.innerHTML = msg.ports.length
        ? msg.ports.map(p => \`<option value="\${p.path}">\${p.path}\${p.manufacturer ? ' — ' + p.manufacturer : ''}</option>\`).join('')
        : '<option value="">-- no ports --</option>';
      if (cur && [...portSel.options].some(o => o.value === cur)) portSel.value = cur;
      break;
    }
    case 'connected':
      connected = true;
      badge.textContent = \`\${msg.port} @ \${msg.baudRate}\`;
      badge.className = 'badge ok';
      connectBtn.textContent = 'Disconnect';
      connectBtn.classList.add('danger');
      appendLine('[Connected to ' + msg.port + ' @ ' + msg.baudRate + ' baud]\\n', '#4ec9b0');
      terminal.focus();
      break;
    case 'disconnected':
      connected = false;
      badge.textContent = 'Disconnected';
      badge.className = 'badge';
      connectBtn.textContent = 'Connect';
      connectBtn.classList.remove('danger');
      appendLine('[Disconnected]\\n', '#f48771');
      break;
    case 'data':
      appendData(msg.text);
      break;
    case 'error':
      appendLine('[Error: ' + msg.message + ']\\n', '#f48771');
      break;
  }
});

function toggleConnect() {
  if (connected) {
    vscode.postMessage({ type: 'disconnect' });
  } else {
    const port = portManual.value.trim() || portSel.value;
    const baudRate = parseInt(document.getElementById('baudSel').value, 10);
    if (!port) { appendLine('[No port selected]\\n', '#f48771'); return; }
    vscode.postMessage({ type: 'connect', port, baudRate });
  }
}

function appendData(text) {
  if (!document.getElementById('timestampChk').checked) {
    appendRaw(text, null);
    return;
  }
  dataBuf += text;
  const lines = dataBuf.split('\\n');
  dataBuf = lines.pop();
  for (const line of lines) {
    appendRaw('[' + new Date().toLocaleTimeString() + '] ' + line + '\\n', null);
  }
  if (dataBuf.length > 0) { appendRaw(dataBuf, null); dataBuf = ''; }
}

function appendLine(text, color) {
  const ts = document.getElementById('timestampChk').checked;
  appendRaw(ts ? ('[' + new Date().toLocaleTimeString() + '] ' + text) : text, color);
}

function appendRaw(text, color) {
  const span = document.createElement('span');
  if (color) { span.style.color = color; }
  span.textContent = text;
  content.appendChild(span);
  if (document.getElementById('autoScrollChk').checked) {
    terminal.scrollTop = terminal.scrollHeight;
  }
}

function clearTerminal() {
  content.innerHTML = '';
  dataBuf = '';
}
</script>
</body>
</html>`;
    }

    dispose(): void {
        this.disconnectPort();
        this.bridge?.kill();
        this.panel?.dispose();
    }
}
