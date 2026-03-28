import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ConfigManager } from './configManager';
import { ToolchainManager } from './toolchainManager';
import { DebugManager } from './debugManager';

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
    private _chipName: string | undefined;
    private _compiling = false;
    private _flashing = false;

    // Stable references so targeted refresh won't collapse these nodes
    private readonly _sourceFolderItem = new McuBuildItem(
        'Project', vscode.TreeItemCollapsibleState.Collapsed, 'mcuBuild.selectSourceFolder', 'folder-opened', 'not set'
    );

    constructor(
        private readonly config: ConfigManager,
        private readonly toolchain: ToolchainManager,
        private readonly debug?: DebugManager
    ) {
        this._chipName = config.chipName || undefined;
    }

    setCmakeSource(dir: string | undefined): void {
        this._cmakeSource = dir;
        this._onDidChangeTreeData.fire(undefined);
    }

    setCompiling(value: boolean): void {
        this._compiling = value;
        this._onDidChangeTreeData.fire(undefined);
    }

    setFlashing(value: boolean): void {
        this._flashing = value;
        this._onDidChangeTreeData.fire(undefined);
    }

    get sourceFolder(): string | undefined { return this._sourceFolder; }
    get cmakeSource(): string | undefined { return this._cmakeSource; }

    setChipName(name: string): void {
        this._chipName = name;
        this._onDidChangeTreeData.fire(undefined);
    }

    setSourceFolder(folder: string | undefined): void {
        this._sourceFolder = folder;
        this._sourceFolderItem.description = folder ? path.basename(folder) : 'not set';
        // Auto-detect CMakeLists.txt in the project folder
        if (folder && fs.existsSync(path.join(folder, 'CMakeLists.txt'))) {
            this._cmakeSource = folder;
        }
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
                this._sourceFolderItem,
                new McuBuildItem('Build', vscode.TreeItemCollapsibleState.Expanded, undefined, 'tools'),
                new McuBuildItem('Output Files', vscode.TreeItemCollapsibleState.Expanded, undefined, 'package'),
                new McuBuildItem('Flash', vscode.TreeItemCollapsibleState.Expanded, undefined, 'zap'),
                new McuBuildItem('Serial Monitor', vscode.TreeItemCollapsibleState.Expanded, undefined, 'terminal'),
                new McuBuildItem('Toolchain', vscode.TreeItemCollapsibleState.Collapsed, undefined, 'server-environment'),
                new McuBuildItem('CMSIS-DAP Debug', vscode.TreeItemCollapsibleState.Collapsed, undefined, 'debug-alt'),
            ];
        }

        switch (typeof element.label === 'string' ? element.label : '') {
            case 'Build':
                return [
                    new McuBuildItem('CMake Source', vscode.TreeItemCollapsibleState.None, 'mcuBuild.selectSourceFolder', 'root-folder', this._cmakeSource ?? 'workspace root', 'cmakeSource'),
                    new McuBuildItem('Chip Name', vscode.TreeItemCollapsibleState.None, 'mcuBuild.selectChip', 'chip', this._chipName || 'not set', 'chipName'),
                    new McuBuildItem('Build Type', vscode.TreeItemCollapsibleState.None, 'mcuBuild.selectBuildType', 'symbol-enum', this.config.buildType, 'buildType'),
                    (() => {
                        const item = new McuBuildItem(
                            this._compiling ? 'Compiling...' : 'Compile',
                            vscode.TreeItemCollapsibleState.None,
                            this._compiling ? undefined : 'mcuBuild.rebuild',
                            undefined,
                            undefined,
                            'build'
                        );
                        item.iconPath = this._compiling
                            ? new vscode.ThemeIcon('sync~spin')
                            : new vscode.ThemeIcon('play');
                        return item;
                    })(),
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
                    new McuBuildItem('Open Flash Panel (UART)', vscode.TreeItemCollapsibleState.None, 'mcuBuild.openFlashPanel', 'arrow-circle-down', undefined, 'openFlashPanel'),
                ];
            case 'Serial Monitor':
                return [
                    new McuBuildItem('Open Serial Monitor', vscode.TreeItemCollapsibleState.None, 'mcuBuild.openSerialMonitor', 'terminal', undefined, 'openSerial'),
                    new McuBuildItem('Select Port', vscode.TreeItemCollapsibleState.None, 'mcuBuild.selectSerialPort', 'plug', this.config.serialPort || 'not set', 'selectPort'),
                ];
            case 'Project':
                return this.listDir(this._sourceFolder);
            case 'CMSIS-DAP Debug': {
                const dbg = this.debug;
                const probe = dbg?.probe;
                const probeItem = probe?.connected
                    ? new McuBuildItem('Connected', vscode.TreeItemCollapsibleState.None, undefined, undefined, probe.name ?? 'CMSIS-DAP', 'probeConnected')
                    : new McuBuildItem('Not Connected', vscode.TreeItemCollapsibleState.None, undefined, undefined, undefined, 'probeDisconnected');
                probeItem.iconPath = probe?.connected
                    ? new vscode.ThemeIcon('debug-alt', new vscode.ThemeColor('testing.iconPassed'))
                    : new vscode.ThemeIcon('debug-disconnect', new vscode.ThemeColor('testing.iconFailed'));
                return [
                    probeItem,
                    new McuBuildItem('Start Debug', vscode.TreeItemCollapsibleState.None, 'mcuBuild.startDebug', 'debug-start', undefined, 'debugStart'),
                    (() => {
                        const item = new McuBuildItem(
                            this._flashing ? 'Flashing...' : 'Flash',
                            vscode.TreeItemCollapsibleState.None,
                            this._flashing ? undefined : 'mcuBuild.debug.flashOpenOcd',
                            undefined,
                            undefined,
                            'debugFlash'
                        );
                        item.iconPath = this._flashing
                            ? new vscode.ThemeIcon('sync~spin')
                            : new vscode.ThemeIcon('zap');
                        return item;
                    })(),
                    new McuBuildItem('ELF File', vscode.TreeItemCollapsibleState.None, 'mcuBuild.debug.selectElf', 'file-binary', dbg?.elfFile ? path.basename(dbg.elfFile) : 'not set', 'debugElf'),
                    new McuBuildItem('Interface', vscode.TreeItemCollapsibleState.None, 'mcuBuild.debug.selectInterface', 'plug', dbg?.interfaceCfg || 'not set', 'debugInterface'),
                    new McuBuildItem('Target Config', vscode.TreeItemCollapsibleState.None, 'mcuBuild.debug.selectTarget', 'settings', dbg?.targetCfg || 'not set', 'debugTarget'),
                    new McuBuildItem('GDB', vscode.TreeItemCollapsibleState.None, 'mcuBuild.debug.selectGdb', 'terminal', dbg?.gdbPath || 'arm-none-eabi-gdb', 'debugGdb'),
                    new McuBuildItem('OpenOCD', vscode.TreeItemCollapsibleState.None, 'mcuBuild.debug.selectOpenOcd', 'debug-disconnect', dbg ? path.basename(dbg.openocdPath) : 'auto-detect', 'debugOpenOcd'),
                    new McuBuildItem('Generate launch.json', vscode.TreeItemCollapsibleState.None, 'mcuBuild.debug.generateLaunch', 'file-code', undefined, 'debugGenLaunch'),
                ];
            }
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
            const newestByExt = (ext: string) => {
                const matched = fs.readdirSync(buildDir)
                    .filter(f => path.extname(f).toLowerCase() === ext)
                    .map(f => ({ f, mtime: fs.statSync(path.join(buildDir, f)).mtimeMs }))
                    .sort((a, b) => b.mtime - a.mtime);
                return matched.length > 0 ? matched[0].f : undefined;
            };

            for (const ext of ['.elf', '.bin']) {
                const name = newestByExt(ext);
                if (name) {
                    const filePath = path.join(buildDir, name);
                    const mtime = new Date(fs.statSync(filePath).mtime).toLocaleString();
                    items.push(new McuBuildItem(
                        name,
                        vscode.TreeItemCollapsibleState.None,
                        'mcuBuild.revealOutputFile',
                        ext === '.elf' ? 'file-binary' : 'file-symlink-file',
                        mtime,
                        'outputFile',
                        [vscode.Uri.file(filePath)]
                    ));
                }
            }
        } catch { /* ignore */ }

        return items.length > 0
            ? items
            : [new McuBuildItem('No output files', vscode.TreeItemCollapsibleState.None, undefined, 'info', undefined, 'outputEmpty')];
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
