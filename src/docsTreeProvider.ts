import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export class DocsTreeItem extends vscode.TreeItem {
    constructor(
        label: string,
        collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly docUri: vscode.Uri,
        public readonly lineNumber: number,
        iconId?: string
    ) {
        super(label, collapsibleState);
        this.command = {
            command: 'mcuBuild.openDocsAt',
            title: 'Open Documentation',
            arguments: [docUri, lineNumber],
        };
        if (iconId) {
            this.iconPath = new vscode.ThemeIcon(iconId);
        }
        this.contextValue = 'docsItem';
    }
}

interface HeadingNode {
    label: string;
    level: number;
    line: number;
    children: HeadingNode[];
}

function parseHeadings(filePath: string): HeadingNode[] {
    if (!fs.existsSync(filePath)) { return []; }
    const lines = fs.readFileSync(filePath, 'utf8').split('\n');
    const roots: HeadingNode[] = [];
    const stack: HeadingNode[] = [];

    lines.forEach((raw, idx) => {
        const m = raw.match(/^(#{1,3})\s+(.+)/);
        if (!m) { return; }
        const level = m[1].length;
        // Strip markdown link syntax and leading numbering for display
        const label = m[2]
            .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')  // [text](url) → text
            .replace(/^\d+\.\s+/, '')                  // leading "1. "
            .trim();

        const node: HeadingNode = { label, level, line: idx, children: [] };

        // Pop stack until we find a parent with lower level
        while (stack.length > 0 && stack[stack.length - 1].level >= level) {
            stack.pop();
        }
        if (stack.length === 0) {
            roots.push(node);
        } else {
            stack[stack.length - 1].children.push(node);
        }
        stack.push(node);
    });

    return roots;
}

export class DocsTreeProvider implements vscode.TreeDataProvider<DocsTreeItem> {
    private readonly _onDidChangeTreeData = new vscode.EventEmitter<DocsTreeItem | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private readonly docUri: vscode.Uri;
    private roots: HeadingNode[] = [];

    constructor(extensionUri: vscode.Uri) {
        this.docUri = vscode.Uri.joinPath(extensionUri, 'docs', 'USER_GUIDE.md');
        this.roots = parseHeadings(this.docUri.fsPath);
    }

    getTreeItem(element: DocsTreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: DocsTreeItem): DocsTreeItem[] {
        if (!element) {
            return this.roots.map(n => this.toItem(n));
        }
        // Find matching node by line number and return its children
        const node = this.findNode(this.roots, element.lineNumber);
        return node?.children.map(n => this.toItem(n)) ?? [];
    }

    private toItem(node: HeadingNode): DocsTreeItem {
        const collapsible = node.children.length > 0
            ? vscode.TreeItemCollapsibleState.Collapsed
            : vscode.TreeItemCollapsibleState.None;
        const icon = node.level === 1 ? 'book' : node.level === 2 ? 'list-unordered' : 'circle-small-filled';
        return new DocsTreeItem(node.label, collapsible, this.docUri, node.line, icon);
    }

    private findNode(nodes: HeadingNode[], line: number): HeadingNode | undefined {
        for (const n of nodes) {
            if (n.line === line) { return n; }
            const found = this.findNode(n.children, line);
            if (found) { return found; }
        }
        return undefined;
    }
}
