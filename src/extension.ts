import * as vscode from 'vscode';
import { ConfigManager, BuildType } from './configManager';
import { BuildManager } from './buildManager';
import { FlashManager } from './flashManager';
import { SerialMonitor } from './serialMonitor';
import { StatusBarManager } from './statusBar';
import { McuBuildTreeProvider } from './mcuBuildTreeProvider';
import { ToolchainManager } from './toolchainManager';
import { openConfigFileEditor } from './configFileEditor';
import { FlashPanel } from './flashPanel';

export function activate(context: vscode.ExtensionContext): void {
    const output = vscode.window.createOutputChannel('史丹利測試');
    const config = new ConfigManager();
    const buildMgr = new BuildManager(config, output);
    const flashMgr = new FlashManager(config, output);
    const serial = new SerialMonitor(config, context);
    const statusBar = new StatusBarManager(config);

    const flashPanel = new FlashPanel(context);
    const toolchainMgr = new ToolchainManager();
    const treeProvider = new McuBuildTreeProvider(config, toolchainMgr);

    // Refresh tree when toolchain status changes
    toolchainMgr.onDidChange(() => treeProvider.refresh(), null, context.subscriptions);
    // Check toolchain status on activation
    toolchainMgr.checkAll();
    // Restore previously selected source folder
    const savedSourceFolder = context.workspaceState.get<string>('mcuBuild.sourceFolder');
    if (savedSourceFolder) { treeProvider.setSourceFolder(savedSourceFolder); }
    // CMake source dir follows sourceFolder
    if (savedSourceFolder) { buildMgr.cmakeSourceDir = savedSourceFolder; treeProvider.setCmakeSource(savedSourceFolder); flashPanel.sourceFolder = savedSourceFolder; }
    context.subscriptions.push(
        vscode.window.registerTreeDataProvider('mcuBuildView', treeProvider)
    );

    // Keep status bar in sync with build state
    buildMgr.onStatusChanged(s => {
        statusBar.setBuildStatus(s);
        if (s === 'success' || s === 'failed') { treeProvider.refresh(); }
    }, null, context.subscriptions);

    // Keep build-type badge and tree in sync with settings
    vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('mcuBuild.cmake.buildType') || e.affectsConfiguration('mcuBuild.serial.port')) {
            statusBar.refreshBuildType();
            treeProvider.refresh();
        }
        if (e.affectsConfiguration('mcuBuild.cmake.configFile')) {
            treeProvider.refresh();
        }
    }, null, context.subscriptions);

    const cmds: [string, (...args: unknown[]) => unknown][] = [
        ['mcuBuild.build',             () => buildMgr.build()],
        ['mcuBuild.clean',             () => buildMgr.clean()],
        ['mcuBuild.rebuild',           () => buildMgr.rebuild()],
        ['mcuBuild.cancelBuild',       () => buildMgr.cancel()],
        ['mcuBuild.flash',             () => flashMgr.flash()],
        ['mcuBuild.openFlashPanel',    () => flashPanel.open()],
        ['mcuBuild.openSerialMonitor', () => serial.open()],
        ['mcuBuild.openFile',          (uri: unknown) => vscode.window.showTextDocument(uri as vscode.Uri)],
        ['mcuBuild.revealOutputFile',  (uri: unknown) => vscode.commands.executeCommand('revealFileInOS', uri as vscode.Uri)],
        ['mcuBuild.selectSourceFolder', async () => {
            const uris = await vscode.window.showOpenDialog({
                canSelectFiles: false,
                canSelectFolders: true,
                canSelectMany: false,
                openLabel: 'Select Source Folder',
            });
            if (uris?.[0]) {
                const folder = uris[0].fsPath;
                treeProvider.setSourceFolder(folder);
                buildMgr.cmakeSourceDir = folder;
                treeProvider.setCmakeSource(folder);
                flashPanel.sourceFolder = folder;
                context.workspaceState.update('mcuBuild.sourceFolder', folder);
            }
        }],
        ['mcuBuild.selectSerialPort',    () => serial.selectPort()],
        ['mcuBuild.selectConfigFile', async () => {
            const uris = await vscode.window.showOpenDialog({
                canSelectFiles: true,
                canSelectFolders: false,
                canSelectMany: false,
                openLabel: 'Select Config File',
                filters: { 'Config files': ['config', 'cmake', 'txt'], 'All files': ['*'] },
            });
            if (uris?.[0]) {
                config.configFile = uris[0].fsPath;
            }
        }],
        ['mcuBuild.openConfigFile', () => {
            if (config.configFile) {
                openConfigFileEditor(context, config.configFile);
            } else {
                vscode.window.showWarningMessage('No config file selected. Please select a config file first.');
            }
        }],
        ['mcuBuild.clearConfigFile', () => { config.configFile = ''; }],
        ['mcuBuild.installArmToolchain', () => toolchainMgr.installArmToolchain()],
        ['mcuBuild.installCmake',        () => toolchainMgr.installCmake()],
        ['mcuBuild.installNinja',        () => toolchainMgr.installNinja()],
        ['mcuBuild.removeArmToolchain',  () => toolchainMgr.removeArmToolchain()],
        ['mcuBuild.removeCmake',         () => toolchainMgr.removeCmake()],
        ['mcuBuild.removeNinja',         () => toolchainMgr.removeNinja()],
        ['mcuBuild.refreshToolchain',    () => toolchainMgr.checkAll()],
        ['mcuBuild.selectBuildType',   async () => {
            const types: BuildType[] = ['Debug', 'Release', 'RelWithDebInfo', 'MinSizeRel'];
            const pick = await vscode.window.showQuickPick(
                types.map(t => ({ label: t, description: t === config.buildType ? '(current)' : '' })),
                { placeHolder: 'Select CMake build type' }
            );
            if (pick) {
                config.buildType = pick.label;
                statusBar.refreshBuildType();
            }
        }],
    ];

    for (const [id, handler] of cmds) {
        context.subscriptions.push(vscode.commands.registerCommand(id, handler));
    }

    context.subscriptions.push(output, buildMgr, statusBar, { dispose: () => serial.dispose() }, { dispose: () => flashPanel.dispose() });
}

export function deactivate(): void {}
