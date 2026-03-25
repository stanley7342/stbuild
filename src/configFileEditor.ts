import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

interface ConfigEntry {
    type: 'bool' | 'string' | 'number' | 'comment' | 'blank';
    key?: string;
    value?: string;
    enabled?: boolean;   // for bool: y or not set
    raw: string;         // original line
}

function parseConfigFile(filePath: string): ConfigEntry[] {
    const lines = fs.readFileSync(filePath, 'utf8').split('\n');
    const entries: ConfigEntry[] = [];

    for (const raw of lines) {
        const trimmed = raw.trimEnd();

        // "# CONFIG_FOO is not set"
        const notSetMatch = trimmed.match(/^# (CONFIG_\S+) is not set$/);
        if (notSetMatch) {
            entries.push({ type: 'bool', key: notSetMatch[1], enabled: false, raw: trimmed });
            continue;
        }

        // "CONFIG_FOO=y"
        const boolMatch = trimmed.match(/^(CONFIG_\S+)=y$/);
        if (boolMatch) {
            entries.push({ type: 'bool', key: boolMatch[1], enabled: true, raw: trimmed });
            continue;
        }

        // "CONFIG_FOO="string""
        const strMatch = trimmed.match(/^(CONFIG_\S+)="(.*)"$/);
        if (strMatch) {
            entries.push({ type: 'string', key: strMatch[1], value: strMatch[2], raw: trimmed });
            continue;
        }

        // "CONFIG_FOO=123"
        const numMatch = trimmed.match(/^(CONFIG_\S+)=(-?\d+)$/);
        if (numMatch) {
            entries.push({ type: 'number', key: numMatch[1], value: numMatch[2], raw: trimmed });
            continue;
        }

        // blank or comment
        if (trimmed === '') {
            entries.push({ type: 'blank', raw: '' });
        } else {
            entries.push({ type: 'comment', raw: trimmed });
        }
    }

    return entries;
}

function serializeEntries(entries: ConfigEntry[]): string {
    return entries.map(e => {
        if (e.type === 'bool') {
            return e.enabled
                ? `${e.key}=y`
                : `# ${e.key} is not set`;
        }
        if (e.type === 'string') { return `${e.key}="${e.value}"`; }
        if (e.type === 'number') { return `${e.key}=${e.value}`; }
        return e.raw;
    }).join('\n');
}

export function openConfigFileEditor(
    context: vscode.ExtensionContext,
    filePath: string
): void {
    const title = path.basename(filePath);

    const panel = vscode.window.createWebviewPanel(
        'mcuConfigEditor',
        title,
        vscode.ViewColumn.One,
        { enableScripts: true, retainContextWhenHidden: true }
    );

    function refresh() {
        const entries = parseConfigFile(filePath);
        panel.webview.html = buildHtml(entries, title);
    }

    refresh();

    panel.webview.onDidReceiveMessage(msg => {
        if (msg.command === 'save') {
            const entries: ConfigEntry[] = msg.entries;
            fs.writeFileSync(filePath, serializeEntries(entries), 'utf8');
            vscode.window.showInformationMessage(`Saved ${title}`);
        }
    }, undefined, context.subscriptions);
}

function buildHtml(entries: ConfigEntry[], title: string): string {
    const rows = entries.map((e, i) => {
        if (e.type === 'blank') { return `<tr data-i="${i}" data-type="blank"><td colspan="2"></td></tr>`; }
        if (e.type === 'comment') {
            const text = e.raw.replace(/^#+\s*/, '');
            return `<tr data-i="${i}" data-type="comment"><td colspan="2" class="section">${escHtml(text)}</td></tr>`;
        }
        if (e.type === 'bool') {
            const checked = e.enabled ? 'checked' : '';
            return `<tr data-i="${i}" data-type="bool" data-key="${escHtml(e.key!)}">
              <td class="key">${escHtml(e.key!)}</td>
              <td><input type="checkbox" ${checked} onchange="onChange(${i},this)"></td>
            </tr>`;
        }
        if (e.type === 'string') {
            return `<tr data-i="${i}" data-type="string" data-key="${escHtml(e.key!)}">
              <td class="key">${escHtml(e.key!)}</td>
              <td><input type="text" value="${escHtml(e.value ?? '')}" oninput="onChange(${i},this)"></td>
            </tr>`;
        }
        if (e.type === 'number') {
            return `<tr data-i="${i}" data-type="number" data-key="${escHtml(e.key!)}">
              <td class="key">${escHtml(e.key!)}</td>
              <td><input type="number" value="${escHtml(e.value ?? '')}" oninput="onChange(${i},this)"></td>
            </tr>`;
        }
        return '';
    }).join('\n');

    const entriesJson = JSON.stringify(entries).replace(/</g, '\\u003c');

    return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 16px; }
  h2 { margin: 0 0 12px; font-size: 1.1em; color: var(--vscode-titleBar-activeForeground, inherit); }
  table { border-collapse: collapse; width: 100%; }
  td { padding: 4px 8px; vertical-align: middle; }
  td.key { color: var(--vscode-symbolIcon-variableForeground, #9cdcfe); font-family: monospace; width: 55%; word-break: break-all; }
  td.section { color: var(--vscode-descriptionForeground); font-style: italic; padding-top: 12px; font-size: 0.9em; }
  tr:hover td:not(.section) { background: var(--vscode-list-hoverBackground); }
  input[type="text"], input[type="number"] { background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, #555); padding: 2px 6px; width: 100%; box-sizing: border-box; font-family: monospace; }
  input[type="checkbox"] { width: 16px; height: 16px; cursor: pointer; }
  .toolbar { position: sticky; top: 0; background: var(--vscode-editor-background); padding: 8px 0; display: flex; gap: 8px; z-index: 10; border-bottom: 1px solid var(--vscode-panel-border); margin-bottom: 8px; }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 5px 14px; cursor: pointer; }
  button:hover { background: var(--vscode-button-hoverBackground); }
  .dirty { color: var(--vscode-editorWarning-foreground); font-size: 0.85em; align-self: center; }
</style>
</head>
<body>
<div class="toolbar">
  <button onclick="save()">Save</button>
  <span class="dirty" id="dirty" style="display:none">● unsaved changes</span>
</div>
<h2>${escHtml(title)}</h2>
<table id="tbl">${rows}</table>
<script>
  const vscode = acquireVsCodeApi();
  let entries = ${entriesJson};

  function onChange(i, el) {
    const e = entries[i];
    if (e.type === 'bool')   { e.enabled = el.checked; }
    if (e.type === 'string') { e.value = el.value; }
    if (e.type === 'number') { e.value = el.value; }
    document.getElementById('dirty').style.display = '';
  }

  function save() {
    vscode.postMessage({ command: 'save', entries });
    document.getElementById('dirty').style.display = 'none';
  }
</script>
</body>
</html>`;
}

function escHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
