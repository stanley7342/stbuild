import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

interface ConfigEntry {
    type: 'bool' | 'string' | 'number' | 'comment' | 'blank';
    key?: string;
    value?: string;
    enabled?: boolean;
    raw: string;
}

interface Section {
    label: string;
    entries: { idx: number; entry: ConfigEntry }[];
}

function parseConfigFile(filePath: string): ConfigEntry[] {
    const lines = fs.readFileSync(filePath, 'utf8').split('\n');
    const entries: ConfigEntry[] = [];
    for (const raw of lines) {
        const trimmed = raw.trimEnd();
        const notSetMatch = trimmed.match(/^# (CONFIG_\S+) is not set$/);
        if (notSetMatch) { entries.push({ type: 'bool', key: notSetMatch[1], enabled: false, raw: trimmed }); continue; }
        const boolMatch = trimmed.match(/^(CONFIG_\S+)=y$/);
        if (boolMatch) { entries.push({ type: 'bool', key: boolMatch[1], enabled: true, raw: trimmed }); continue; }
        const strMatch = trimmed.match(/^(CONFIG_\S+)="(.*)"$/);
        if (strMatch) { entries.push({ type: 'string', key: strMatch[1], value: strMatch[2], raw: trimmed }); continue; }
        const numMatch = trimmed.match(/^(CONFIG_\S+)=(-?\d+)$/);
        if (numMatch) { entries.push({ type: 'number', key: numMatch[1], value: numMatch[2], raw: trimmed }); continue; }
        entries.push(trimmed === '' ? { type: 'blank', raw: '' } : { type: 'comment', raw: trimmed });
    }
    return entries;
}

function serializeEntries(entries: ConfigEntry[]): string {
    return entries.map(e => {
        if (e.type === 'bool')   { return e.enabled ? `${e.key}=y` : `# ${e.key} is not set`; }
        if (e.type === 'string') { return `${e.key}="${e.value}"`; }
        if (e.type === 'number') { return `${e.key}=${e.value}`; }
        return e.raw;
    }).join('\n');
}

function buildSections(entries: ConfigEntry[]): Section[] {
    const sections: Section[] = [];
    let current: Section | undefined;
    for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        if (e.type === 'comment') {
            if (current && current.entries.length > 0) { sections.push(current); }
            current = { label: e.raw.replace(/^#+\s*/, ''), entries: [] };
        } else if (e.type !== 'blank') {
            if (!current) { current = { label: 'General', entries: [] }; }
            current.entries.push({ idx: i, entry: e });
        }
    }
    if (current && current.entries.length > 0) { sections.push(current); }
    return sections;
}

function getWebviewHtml(
    webview: vscode.Webview,
    sections: Section[],
    fileName: string,
    dirty: boolean
): string {
    const sectionsJson = JSON.stringify(sections);
    return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    padding: 0;
  }
  #toolbar {
    position: sticky;
    top: 0;
    z-index: 10;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 16px;
    background: var(--vscode-titleBar-activeBackground, var(--vscode-editor-background));
    border-bottom: 1px solid var(--vscode-widget-border);
  }
  #filename {
    flex: 1;
    font-size: 12px;
    color: var(--vscode-descriptionForeground);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  #dirty-dot {
    width: 8px; height: 8px;
    border-radius: 50%;
    background: var(--vscode-notificationsWarningIcon-foreground);
    display: none;
    flex-shrink: 0;
  }
  #dirty-dot.visible { display: block; }
  button {
    padding: 4px 12px;
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: none;
    cursor: pointer;
    font-size: 12px;
    border-radius: 2px;
  }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button:disabled { opacity: 0.5; cursor: default; }
  #content { padding: 12px 16px; }
  .section { margin-bottom: 20px; }
  .section-header {
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--vscode-descriptionForeground);
    padding: 4px 0 6px;
    border-bottom: 1px solid var(--vscode-widget-border);
    margin-bottom: 2px;
    cursor: pointer;
    user-select: none;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .section-header .chevron { transition: transform 0.15s; font-size: 10px; }
  .section-header.collapsed .chevron { transform: rotate(-90deg); }
  .section-body { overflow: hidden; }
  .entry {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 5px 4px;
    border-bottom: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.1));
  }
  .entry:last-child { border-bottom: none; }
  .entry-key {
    flex: 1;
    font-size: 12px;
    font-family: var(--vscode-editor-font-family, monospace);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .entry-val { flex-shrink: 0; }
  /* Bool icon button */
  .bool-btn {
    font-size: 16px;
    line-height: 1;
    cursor: pointer;
    user-select: none;
    padding: 2px 4px;
    border-radius: 3px;
    border: none;
    background: transparent;
    transition: opacity 0.15s;
  }
  .bool-btn:hover { opacity: 0.75; }
  .bool-btn.enabled  { color: #3fb950; }
  .bool-btn.disabled { color: #f85149; }
  /* Text / number input */
  .val-input {
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent);
    padding: 2px 6px;
    font-size: 12px;
    font-family: var(--vscode-editor-font-family, monospace);
    width: 200px;
    border-radius: 2px;
    outline: none;
  }
  .val-input:focus { border-color: var(--vscode-focusBorder); }
  .no-file {
    padding: 40px 16px;
    text-align: center;
    color: var(--vscode-descriptionForeground);
  }
</style>
</head>
<body>
<div id="toolbar">
  <div id="dirty-dot" class="${dirty ? 'visible' : ''}"></div>
  <span id="filename">${fileName || 'No file loaded'}</span>
  <button id="saveBtn" ${!fileName ? 'disabled' : ''}>Save</button>
</div>
<div id="content"></div>
<script>
  const vscode = acquireVsCodeApi();
  let sections = ${sectionsJson};
  let dirty = ${dirty};

  function markDirty() {
    dirty = true;
    document.getElementById('dirty-dot').classList.add('visible');
  }

  function render() {
    const content = document.getElementById('content');
    if (!sections.length) {
      content.innerHTML = '<div class="no-file">No config file loaded.<br>Use "Open Config File" to load one.</div>';
      return;
    }
    content.innerHTML = '';
    sections.forEach((sec, si) => {
      const div = document.createElement('div');
      div.className = 'section';

      const hdr = document.createElement('div');
      hdr.className = 'section-header';
      hdr.innerHTML = '<span class="chevron">▾</span>' + escHtml(sec.label);
      const body = document.createElement('div');
      body.className = 'section-body';

      hdr.addEventListener('click', () => {
        hdr.classList.toggle('collapsed');
        body.style.display = hdr.classList.contains('collapsed') ? 'none' : '';
      });

      sec.entries.forEach(({ idx, entry }) => {
        const row = document.createElement('div');
        row.className = 'entry';

        const keyEl = document.createElement('div');
        keyEl.className = 'entry-key';
        keyEl.title = entry.key || '';
        keyEl.textContent = entry.key || '';

        const valEl = document.createElement('div');
        valEl.className = 'entry-val';

        if (entry.type === 'bool') {
          const btn = document.createElement('button');
          btn.className = 'bool-btn ' + (entry.enabled ? 'enabled' : 'disabled');
          btn.textContent = entry.enabled ? '✓' : '✗';
          btn.title = entry.enabled ? 'Enabled — click to disable' : 'Disabled — click to enable';
          btn.addEventListener('click', () => {
            entry.enabled = !entry.enabled;
            btn.className = 'bool-btn ' + (entry.enabled ? 'enabled' : 'disabled');
            btn.textContent = entry.enabled ? '✓' : '✗';
            btn.title = entry.enabled ? 'Enabled — click to disable' : 'Disabled — click to enable';
            markDirty();
            vscode.postMessage({ type: 'update', idx, field: 'enabled', value: entry.enabled });
          });
          valEl.appendChild(btn);
        } else {
          const inp = document.createElement('input');
          inp.className = 'val-input';
          inp.type = entry.type === 'number' ? 'number' : 'text';
          inp.value = entry.value || '';
          inp.addEventListener('input', () => {
            entry.value = inp.value;
            markDirty();
            vscode.postMessage({ type: 'update', idx, field: 'value', value: inp.value });
          });
          valEl.appendChild(inp);
        }

        row.appendChild(keyEl);
        row.appendChild(valEl);
        body.appendChild(row);
      });

      div.appendChild(hdr);
      div.appendChild(body);
      content.appendChild(div);
    });
  }

  function escHtml(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  document.getElementById('saveBtn').addEventListener('click', () => {
    vscode.postMessage({ type: 'save' });
    dirty = false;
    document.getElementById('dirty-dot').classList.remove('visible');
  });

  window.addEventListener('message', e => {
    const msg = e.data;
    if (msg.type === 'load') {
      sections = msg.sections;
      dirty = false;
      document.getElementById('dirty-dot').classList.remove('visible');
      document.getElementById('filename').textContent = msg.fileName || '';
      document.getElementById('saveBtn').disabled = !msg.fileName;
      render();
    }
  });

  render();
</script>
</body>
</html>`;
}

export class ConfigPanel {
    static currentPanel: ConfigPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private _filePath: string | undefined;
    private _entries: ConfigEntry[] = [];
    private _dirty = false;

    static open(context: vscode.ExtensionContext): ConfigPanel {
        if (ConfigPanel.currentPanel) {
            ConfigPanel.currentPanel._panel.reveal();
            return ConfigPanel.currentPanel;
        }
        const panel = vscode.window.createWebviewPanel(
            'mcuConfigEditor',
            'Config Editor',
            vscode.ViewColumn.One,
            { enableScripts: true, retainContextWhenHidden: true }
        );
        ConfigPanel.currentPanel = new ConfigPanel(panel, context);
        return ConfigPanel.currentPanel;
    }

    private constructor(panel: vscode.WebviewPanel, _context: vscode.ExtensionContext) {
        this._panel = panel;
        this._panel.onDidDispose(() => { ConfigPanel.currentPanel = undefined; });
        this._panel.webview.onDidReceiveMessage(msg => this._onMessage(msg));
        this._render();
    }

    load(filePath: string): void {
        this._filePath = filePath;
        this._entries = parseConfigFile(filePath);
        this._dirty = false;
        this._panel.title = path.basename(filePath);
        this._panel.reveal();
        this._sendLoad();
    }

    get dirty(): boolean { return this._dirty; }
    get fileName(): string { return this._filePath ? path.basename(this._filePath) : ''; }

    save(): boolean {
        if (!this._filePath) { return false; }
        try {
            fs.writeFileSync(this._filePath, serializeEntries(this._entries), 'utf8');
            this._dirty = false;
            return true;
        } catch { return false; }
    }

    private _onMessage(msg: { type: string; idx?: number; field?: string; value?: unknown }): void {
        if (msg.type === 'save') {
            const ok = this.save();
            if (ok) { vscode.window.showInformationMessage(`Saved ${this.fileName}`); }
            else    { vscode.window.showErrorMessage('Failed to save config file.'); }
        } else if (msg.type === 'update' && msg.idx !== undefined) {
            const e = this._entries[msg.idx];
            if (!e) { return; }
            if (msg.field === 'enabled') { e.enabled = msg.value as boolean; }
            else if (msg.field === 'value') { e.value = msg.value as string; }
            this._dirty = true;
        }
    }

    private _render(): void {
        const sections = this._filePath ? buildSections(this._entries) : [];
        this._panel.webview.html = getWebviewHtml(
            this._panel.webview,
            sections,
            this._filePath ? path.basename(this._filePath) : '',
            this._dirty
        );
    }

    private _sendLoad(): void {
        const sections = buildSections(this._entries);
        this._panel.webview.postMessage({
            type: 'load',
            sections,
            fileName: this._filePath ? path.basename(this._filePath) : '',
        });
    }

    dispose(): void {
        this._panel.dispose();
    }
}
