import * as vscode from 'vscode';
import * as fs from 'fs';

interface ConfigEntry {
    type: 'bool' | 'string' | 'number' | 'comment' | 'blank';
    key?: string;
    value?: string;
    enabled?: boolean;
    raw: string;
}

function parseConfigFile(filePath: string): ConfigEntry[] {
    const lines = fs.readFileSync(filePath, 'utf8').split('\n');
    const entries: ConfigEntry[] = [];
    for (const raw of lines) {
        const trimmed = raw.trimEnd();
        const notSetMatch = trimmed.match(/^# (CONFIG_\S+) is not set$/);
        if (notSetMatch) {
            entries.push({ type: 'bool', key: notSetMatch[1], enabled: false, raw: trimmed });
            continue;
        }
        const boolMatch = trimmed.match(/^(CONFIG_\S+)=y$/);
        if (boolMatch) {
            entries.push({ type: 'bool', key: boolMatch[1], enabled: true, raw: trimmed });
            continue;
        }
        const strMatch = trimmed.match(/^(CONFIG_\S+)="(.*)"$/);
        if (strMatch) {
            entries.push({ type: 'string', key: strMatch[1], value: strMatch[2], raw: trimmed });
            continue;
        }
        const numMatch = trimmed.match(/^(CONFIG_\S+)=(-?\d+)$/);
        if (numMatch) {
            entries.push({ type: 'number', key: numMatch[1], value: numMatch[2], raw: trimmed });
            continue;
        }
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

export class ConfigTreeItem extends vscode.TreeItem {
    entryIndex: number;
    childIndices?: number[];

    constructor(label: string, collapsibleState: vscode.TreeItemCollapsibleState, entryIndex: number) {
        super(label, collapsibleState);
        this.entryIndex = entryIndex;
    }
}

export class ConfigFileTreeProvider implements vscode.TreeDataProvider<ConfigTreeItem> {
    private readonly _onDidChange = new vscode.EventEmitter<ConfigTreeItem | undefined>();
    readonly onDidChangeTreeData = this._onDidChange.event;

    private filePath: string | undefined;
    private entries: ConfigEntry[] = [];
    private sections: { label: string; commentIndex: number; childIndices: number[] }[] = [];
    private _dirty = false;

    get dirty(): boolean { return this._dirty; }
    get fileName(): string { return this.filePath ? require('path').basename(this.filePath) : ''; }

    load(filePath: string): void {
        this.filePath = filePath;
        this.entries = parseConfigFile(filePath);
        this._dirty = false;
        this._buildSections();
        this._onDidChange.fire(undefined);
    }

    private _buildSections(): void {
        this.sections = [];
        let current: { label: string; commentIndex: number; childIndices: number[] } | undefined;
        for (let i = 0; i < this.entries.length; i++) {
            const e = this.entries[i];
            if (e.type === 'comment') {
                if (current && current.childIndices.length > 0) { this.sections.push(current); }
                current = { label: e.raw.replace(/^#+\s*/, ''), commentIndex: i, childIndices: [] };
            } else if (e.type !== 'blank') {
                if (!current) { current = { label: '(General)', commentIndex: -1, childIndices: [] }; }
                current.childIndices.push(i);
            }
        }
        if (current && current.childIndices.length > 0) { this.sections.push(current); }
    }

    save(): boolean {
        if (!this.filePath) { return false; }
        try {
            fs.writeFileSync(this.filePath, serializeEntries(this.entries), 'utf8');
            this._dirty = false;
            this._onDidChange.fire(undefined);
            return true;
        } catch { return false; }
    }

    toggleBool(item: ConfigTreeItem): void {
        const e = this.entries[item.entryIndex];
        if (e?.type === 'bool') {
            e.enabled = !e.enabled;
            this._dirty = true;
            this._onDidChange.fire(undefined);
        }
    }

    async editValue(item: ConfigTreeItem): Promise<void> {
        const e = this.entries[item.entryIndex];
        if (!e || (e.type !== 'string' && e.type !== 'number')) { return; }
        const result = await vscode.window.showInputBox({
            title: `Edit ${e.key}`,
            value: e.value ?? '',
            validateInput: e.type === 'number'
                ? v => (v !== '' && isNaN(Number(v))) ? 'Must be a number' : undefined
                : undefined,
        });
        if (result !== undefined) {
            e.value = result;
            this._dirty = true;
            this._onDidChange.fire(undefined);
        }
    }

    getTreeItem(element: ConfigTreeItem): vscode.TreeItem { return element; }

    getChildren(element?: ConfigTreeItem): ConfigTreeItem[] {
        if (!this.filePath) { return []; }

        if (!element) {
            if (this.sections.length === 0) {
                const empty = new ConfigTreeItem('No config entries', vscode.TreeItemCollapsibleState.None, -1);
                empty.iconPath = new vscode.ThemeIcon('info');
                return [empty];
            }
            return this.sections.map(sec => {
                const item = new ConfigTreeItem(sec.label, vscode.TreeItemCollapsibleState.Expanded, sec.commentIndex);
                item.childIndices = sec.childIndices;
                item.iconPath = new vscode.ThemeIcon('symbol-namespace', new vscode.ThemeColor('charts.purple'));
                item.contextValue = 'configSection';
                return item;
            });
        }

        if (element.childIndices) {
            return element.childIndices.map(idx => this._makeEntryItem(idx));
        }
        return [];
    }

    private _makeEntryItem(idx: number): ConfigTreeItem {
        const e = this.entries[idx];
        const item = new ConfigTreeItem(e.key!, vscode.TreeItemCollapsibleState.None, idx);

        if (e.type === 'bool') {
            item.iconPath = new vscode.ThemeIcon(
                e.enabled ? 'check' : 'close',
                new vscode.ThemeColor(e.enabled ? 'charts.green' : 'charts.red')
            );
            item.description = e.enabled ? 'enabled' : 'disabled';
            item.command = { command: 'mcuBuild.configToggleBool', title: 'Toggle', arguments: [item] };
            item.contextValue = 'configBool';
        } else if (e.type === 'string') {
            item.iconPath = new vscode.ThemeIcon('symbol-string', new vscode.ThemeColor('charts.blue'));
            item.description = `"${e.value}"`;
            item.command = { command: 'mcuBuild.configEditValue', title: 'Edit', arguments: [item] };
            item.contextValue = 'configString';
        } else {
            item.iconPath = new vscode.ThemeIcon('symbol-number', new vscode.ThemeColor('charts.yellow'));
            item.description = e.value ?? '';
            item.command = { command: 'mcuBuild.configEditValue', title: 'Edit', arguments: [item] };
            item.contextValue = 'configNumber';
        }
        return item;
    }
}
