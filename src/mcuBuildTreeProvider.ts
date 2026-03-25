import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ConfigManager } from './configManager';
import { ToolchainManager } from './toolchainManager';

export class McuBuildItem extends vscode.TreeItem {
    /** Set on directory items so getChildren knows which path to list */
    dirPath?: string;

    constructor(
        label: string,
        collapsibleState: vscode.TreeItemCollapsibleState,
        commandId?: string,
        iconId?: string,
        description?: string,
        contextValue?: string,
        commandArgs?: unknown[]
    ) {
        super(label, collapsibleState);
        if (commandId) {
            this.command = { command: commandId, title: label, arguments: commandArgs };
        }
        if (iconId) {
            this.iconPath = new vscode.ThemeIcon(iconId);
        }
        this.description = description;
        this.contextValue = contextValue ?? (commandId ? 'action' : 'group');
    }
}

export class McuBuildTreeProvider implements vscode.TreeDataProvider<McuBuildItem | undefined> {
    private _onDidChangeTreeData = new vscode.EventEmitter<McuBuildItem | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private _sourceFolder: string | undefined;
    private _cmakeSource: string | undefined;

    // Stable references so targeted refresh won't collapse these nodes
    private readonly _sourceFolderItem = new McuBuildItem(
        'Source Files', vscode.TreeItemCollapsibleState.Collapsed, undefined, 'folder-opened', 'not set'
    );

    constructor(
        private readonly config: ConfigManager,
        private readonly toolchain: ToolchainManager
    ) {}

    setCmakeSource(dir: string | undefined): void {
        this._cmakeSource = dir;
        this._onDidChangeTreeData.fire(undefined);
    }

    get sourceFolder(): string | undefined { return this._sourceFolder; }

    setSourceFolder(folder: string | undefined): void {
        this._sourceFolder = folder;
        this._sourceFolderItem.description = folder ? path.basename(folder) : 'not set';
        // Fire with the specific item → only its children are re-queried, expansion state preserved
        this._onDidChangeTreeData.fire(this._sourceFolderItem);
    }

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: McuBuildItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: McuBuildItem): McuBuildItem[] {
        if (!element) {
            // Update description on the stable item each render
            this._sourceFolderItem.description = this._sourceFolder ? path.basename(this._sourceFolder) : 'not set';
            return [
                new McuBuildItem('Build', vscode.TreeItemCollapsibleState.Expanded, undefined, 'tools'),
                new McuBuildItem('Output Files', vscode.TreeItemCollapsibleState.Expanded, undefined, 'package'),
                new McuBuildItem('Flash', vscode.TreeItemCollapsibleState.Expanded, undefined, 'zap'),
                new McuBuildItem('Serial Monitor', vscode.TreeItemCollapsibleState.Expanded, undefined, 'terminal'),
                new McuBuildItem('Toolchain', vscode.TreeItemCollapsibleState.Collapsed, undefined, 'server-environment'),
                this._sourceFolderItem,
            ];
        }

        switch (typeof element.label === 'string' ? element.label : '') {
            case 'Build':
                return [
                    new McuBuildItem('CMake Source', vscode.TreeItemCollapsibleState.None, 'mcuBuild.selectSourceFolder', 'root-folder', this._cmakeSource ? path.basename(this._cmakeSource) : 'workspace root', 'cmakeSource'),
                    new McuBuildItem('Config File', vscode.TreeItemCollapsibleState.None, this.config.configFile ? 'mcuBuild.openConfigFile' : 'mcuBuild.selectConfigFile', 'file-code', this.config.configFile ? path.basename(this.config.configFile) : 'not set', this.config.configFile ? 'configFileSet' : 'configFile'),
                    new McuBuildItem('Build', vscode.TreeItemCollapsibleState.None, 'mcuBuild.build', 'play', undefined, 'build'),
                    new McuBuildItem('Clean', vscode.TreeItemCollapsibleState.None, 'mcuBuild.clean', 'trash', undefined, 'clean'),
                    new McuBuildItem('Rebuild', vscode.TreeItemCollapsibleState.None, 'mcuBuild.rebuild', 'refresh', undefined, 'rebuild'),
                    new McuBuildItem('Build Type', vscode.TreeItemCollapsibleState.None, 'mcuBuild.selectBuildType', 'symbol-enum', this.config.buildType, 'buildType'),
                ];
            case 'Toolchain':
                return [
                    new McuBuildItem(
                        'ARM Cortex-M (arm-none-eabi-gcc)',
                        vscode.TreeItemCollapsibleState.None,
                        this.toolchain.armInstalled ? undefined : 'mcuBuild.installArmToolchain',
                        this.toolchain.armInstalled ? 'pass' : 'cloud-download',
                        this.toolchain.armInstalled ? `已安裝 ${this.toolchain.armStatus}` : this.toolchain.armStatus,
                        this.toolchain.armInstalled ? 'armToolchainOk' : 'armToolchain'
                    ),
                    new McuBuildItem(
                        'CMake',
                        vscode.TreeItemCollapsibleState.None,
                        this.toolchain.cmakeInstalled ? undefined : 'mcuBuild.installCmake',
                        this.toolchain.cmakeInstalled ? 'pass' : 'cloud-download',
                        this.toolchain.cmakeInstalled ? `已安裝 ${this.toolchain.cmakeStatus}` : this.toolchain.cmakeStatus,
                        this.toolchain.cmakeInstalled ? 'cmakeToolchainOk' : 'cmakeToolchain'
                    ),
                    new McuBuildItem(
                        'Ninja',
                        vscode.TreeItemCollapsibleState.None,
                        this.toolchain.ninjaInstalled ? undefined : 'mcuBuild.installNinja',
                        this.toolchain.ninjaInstalled ? 'pass' : 'cloud-download',
                        this.toolchain.ninjaInstalled ? `已安裝 ${this.toolchain.ninjaStatus}` : this.toolchain.ninjaStatus,
                        this.toolchain.ninjaInstalled ? 'ninjaToolchainOk' : 'ninjaToolchain'
                    ),
                    new McuBuildItem('Refresh Status', vscode.TreeItemCollapsibleState.None, 'mcuBuild.refreshToolchain', 'sync', undefined, 'refreshToolchain'),
                ];
            case 'Output Files':
                return this.listOutputFiles();
            case 'Flash':
                return [
                    new McuBuildItem('Flash Firmware', vscode.TreeItemCollapsibleState.None, 'mcuBuild.flash', 'zap', undefined, 'flash'),
                ];
            case 'Serial Monitor':
                return [
                    new McuBuildItem('Open Serial Monitor', vscode.TreeItemCollapsibleState.None, 'mcuBuild.openSerialMonitor', 'terminal', undefined, 'openSerial'),
                    new McuBuildItem('Select Port', vscode.TreeItemCollapsibleState.None, 'mcuBuild.selectSerialPort', 'plug', this.config.serialPort || 'not set', 'selectPort'),
                ];
            case 'Source Files':
                return [
                    new McuBuildItem('Select Folder…', vscode.TreeItemCollapsibleState.None, 'mcuBuild.selectSourceFolder', 'folder', undefined, 'selectSourceFolder'),
                    ...this.listDir(this._sourceFolder),
                ];
            default:
                // Subdirectory node — dirPath set when item was created
                if (element.dirPath) {
                    return this.listDir(element.dirPath);
                }
                return [];
        }
    }

    private listOutputFiles(): McuBuildItem[] {
        const sourceDir = this._cmakeSource ?? this.config.getWorkspaceRoot();
        const buildDir = sourceDir ? path.join(sourceDir, 'build') : undefined;

        if (!buildDir || !fs.existsSync(buildDir)) {
            return [new McuBuildItem('No build output', vscode.TreeItemCollapsibleState.None, undefined, 'info', undefined, 'outputEmpty')];
        }

        const items: McuBuildItem[] = [];
        try {
            for (const entry of fs.readdirSync(buildDir, { withFileTypes: true })) {
                if (entry.isFile() && path.extname(entry.name).toLowerCase() === '.bin') {
                    const filePath = path.join(buildDir, entry.name);
                    items.push(new McuBuildItem(
                        entry.name,
                        vscode.TreeItemCollapsibleState.None,
                        'mcuBuild.revealOutputFile',
                        'file-symlink-file',
                        undefined,
                        'outputFile',
                        [vscode.Uri.file(filePath)]
                    ));
                }
            }
        } catch { /* ignore */ }

        return items.length > 0
            ? items
            : [new McuBuildItem('No .bin found', vscode.TreeItemCollapsibleState.None, undefined, 'info', undefined, 'outputEmpty')];
    }

    private listDir(dir: string | undefined): McuBuildItem[] {
        if (!dir || !fs.existsSync(dir)) { return []; }
        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            // Folders first, then files, both sorted
            const dirs  = entries.filter(e => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name));
            const files = entries.filter(e => e.isFile()).sort((a, b) => a.name.localeCompare(b.name));

            const dirItems = dirs.map(e => {
                const item = new McuBuildItem(
                    e.name,
                    vscode.TreeItemCollapsibleState.Collapsed,
                    undefined,
                    'folder',
                    undefined,
                    'sourceDir'
                );
                item.dirPath = path.join(dir, e.name);
                return item;
            });

            const fileItems = files.map(e => {
                const filePath = path.join(dir, e.name);
                const ext = path.extname(e.name).toLowerCase();
                let icon = 'file';
                if (ext === '.h' || ext === '.hpp')    { icon = 'symbol-interface'; }
                else if (ext === '.c' || ext === '.cpp') { icon = 'file-code'; }
                else if (ext === '.s' || ext === '.asm') { icon = 'file-binary'; }
                return new McuBuildItem(
                    e.name,
                    vscode.TreeItemCollapsibleState.None,
                    'mcuBuild.openFile',
                    icon,
                    undefined,
                    'sourceFile',
                    [vscode.Uri.file(filePath)]
                );
            });

            return [...dirItems, ...fileItems];
        } catch {
            return [];
        }
    }
}
