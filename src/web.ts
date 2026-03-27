/**
 * Web extension entry point.
 * Features that require Node.js (build, flash, serial monitor, toolchain install)
 * are replaced with stubs that show an informational message.
 * Config editing and tree navigation work via vscode.workspace.fs.
 */
import * as vscode from 'vscode';
import { ConfigManager, BuildType } from './configManager';
import { McuBuildTreeProvider } from './mcuBuildTreeProvider';
import { ConfigFileTreeProvider, ConfigTreeItem } from './configTreeProvider';
import { ToolchainManager } from './toolchainManager';

const DESKTOP_ONLY = 'This feature requires VS Code Desktop.';

function desktopOnly() {
    vscode.window.showInformationMessage(DESKTOP_ONLY);
}

export function activate(context: vscode.ExtensionContext): void {
    const config = new ConfigManager();
    const toolchainMgr = new ToolchainManager();
    const treeProvider = new McuBuildTreeProvider(config, toolchainMgr);
    const configTreeProvider = new ConfigFileTreeProvider();

    toolchainMgr.onDidChange(() => treeProvider.refresh(), null, context.subscriptions);
    toolchainMgr.checkAll();

    context.subscriptions.push(
        vscode.window.registerTreeDataProvider('mcuBuildView', treeProvider)
    );

    const configTreeView = vscode.window.createTreeView('mcuConfigTreeView', {
        treeDataProvider: configTreeProvider,
        showCollapseAll: false,
    });
    context.subscriptions.push(configTreeView);

    // Keep tree in sync with settings
    vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('mcuBuild.cmake.buildType') ||
            e.affectsConfiguration('mcuBuild.serial.port') ||
            e.affectsConfiguration('mcuBuild.cmake.configFile')) {
            treeProvider.refresh();
        }
    }, null, context.subscriptions);

    const cmds: [string, (...args: unknown[]) => unknown][] = [
        // Desktop-only features
        ['mcuBuild.build',             desktopOnly],
        ['mcuBuild.clean',             desktopOnly],
        ['mcuBuild.rebuild',           desktopOnly],
        ['mcuBuild.cancelBuild',       desktopOnly],
        ['mcuBuild.flash',             desktopOnly],
        ['mcuBuild.openFlashPanel',    desktopOnly],
        ['mcuBuild.openSerialMonitor', desktopOnly],
        ['mcuBuild.installArmToolchain', desktopOnly],
        ['mcuBuild.installCmake',        desktopOnly],
        ['mcuBuild.installNinja',        desktopOnly],
        ['mcuBuild.removeArmToolchain',  desktopOnly],
        ['mcuBuild.removeCmake',         desktopOnly],
        ['mcuBuild.removeNinja',         desktopOnly],
        ['mcuBuild.refreshToolchain',    () => toolchainMgr.checkAll()],
        ['mcuBuild.revealOutputFile',    desktopOnly],
        ['mcuBuild.useAsFlashBin',       desktopOnly],

        // Web-compatible features
        ['mcuBuild.openFile', (uri: unknown) =>
            vscode.window.showTextDocument(uri as vscode.Uri)],
        ['mcuBuild.selectBuildType', async () => {
            const types: BuildType[] = ['Debug', 'Release', 'RelWithDebInfo', 'MinSizeRel'];
            const pick = await vscode.window.showQuickPick(
                types.map(t => ({ label: t, description: t === config.buildType ? '(current)' : '' })),
                { placeHolder: 'Select CMake build type' }
            );
            if (pick) { config.buildType = pick.label; }
        }],
        ['mcuBuild.selectSerialPort', async () => {
            const port = await vscode.window.showInputBox({ prompt: 'Enter serial port (e.g. COM3)', value: config.serialPort });
            if (port !== undefined) { config.serialPort = port; treeProvider.refresh(); }
        }],
        ['mcuBuild.selectSourceFolder', async () => {
            const uris = await vscode.window.showOpenDialog({
                canSelectFiles: false, canSelectFolders: true, canSelectMany: false,
                openLabel: 'Select Source Folder',
            });
            if (uris?.[0]) {
                const folder = uris[0].fsPath;
                treeProvider.setSourceFolder(folder);
                treeProvider.setCmakeSource(folder);
                context.workspaceState.update('mcuBuild.sourceFolder', folder);
                treeProvider.refresh();
            }
        }],
        ['mcuBuild.selectConfigFile', async () => {
            const uris = await vscode.window.showOpenDialog({
                canSelectFiles: true, canSelectFolders: false, canSelectMany: false,
                openLabel: 'Select Config File',
                filters: { 'Config files': ['config', 'cmake', 'txt'], 'All files': ['*'] },
            });
            if (uris?.[0]) {
                config.configFile = uris[0].fsPath;
                configTreeProvider.load(uris[0].fsPath);
                vscode.commands.executeCommand('mcuConfigTreeView.focus');
            }
        }],
        ['mcuBuild.openConfigFile', () => {
            if (config.configFile) {
                configTreeProvider.load(config.configFile);
                vscode.commands.executeCommand('mcuConfigTreeView.focus');
            } else {
                vscode.window.showWarningMessage('No config file selected.');
            }
        }],
        ['mcuBuild.configSave', () => {
            const ok = configTreeProvider.save();
            if (ok) { vscode.window.showInformationMessage(`Saved ${configTreeProvider.fileName}`); }
            else    { vscode.window.showErrorMessage('Failed to save config file.'); }
        }],
        ['mcuBuild.configToggleBool', (item: unknown) => configTreeProvider.toggleBool(item as ConfigTreeItem)],
        ['mcuBuild.configEditValue',  (item: unknown) => configTreeProvider.editValue(item as ConfigTreeItem)],
        ['mcuBuild.clearConfigFile',  () => { config.configFile = ''; treeProvider.refresh(); }],
    ];

    for (const [id, handler] of cmds) {
        context.subscriptions.push(vscode.commands.registerCommand(id, handler));
    }

    // Restore source folder
    const saved = context.workspaceState.get<string>('mcuBuild.sourceFolder');
    if (saved) {
        treeProvider.setSourceFolder(saved);
        treeProvider.setCmakeSource(saved);
        if (config.configFile) { configTreeProvider.load(config.configFile); }
        treeProvider.refresh();
    }
}

export function deactivate(): void {}
