import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ConfigManager, BuildType } from './configManager';
import { BuildManager } from './buildManager';
import { FlashManager } from './flashManager';
import { SerialMonitor } from './serialMonitor';
import { StatusBarManager } from './statusBar';
import { McuBuildTreeProvider } from './mcuBuildTreeProvider';
import { ToolchainManager } from './toolchainManager';
import { ConfigPanel } from './configPanel';
import { FlashPanel } from './flashPanel';
import { DebugManager } from './debugManager';
import { SdkManager } from './sdkManager';
import { SdkTreeItem, SdkTreeProvider } from './sdkTreeProvider';
import { DocsTreeProvider } from './docsTreeProvider';
import { SettingsPanel } from './settingsPanel';

export function activate(context: vscode.ExtensionContext): void {
    const output = vscode.window.createOutputChannel('史丹利測試');
    const config = new ConfigManager();
    const buildMgr = new BuildManager(config, output);
    const flashMgr = new FlashManager(config, output);
    const serial = new SerialMonitor(config, context);
    const statusBar = new StatusBarManager(config);

    const flashPanel = new FlashPanel(context, output);
    const toolchainMgr = new ToolchainManager();
    const debugMgr = new DebugManager(output);
    const treeProvider = new McuBuildTreeProvider(config, toolchainMgr, debugMgr);
    let configPanel: ConfigPanel | undefined;
    const sdkMgr = new SdkManager(output, context);
    const sdkTreeProvider = new SdkTreeProvider(sdkMgr);
    const docsTreeProvider = new DocsTreeProvider(context.extensionUri);
    const settingsPanel = new SettingsPanel(context, config, debugMgr, sdkMgr, (s) => {
        if (s.sourceFolder) {
            treeProvider.setSourceFolder(s.sourceFolder);
            buildMgr.cmakeSourceDir = treeProvider.cmakeSource ?? s.sourceFolder;
            treeProvider.setCmakeSource(treeProvider.cmakeSource ?? s.sourceFolder);
            flashPanel.sourceFolder = s.sourceFolder;
            debugMgr.sourceDir = s.sourceFolder;
        }
        if (s.chipName) { treeProvider.setChipName(s.chipName); }
        statusBar.refreshBuildType();
        treeProvider.refresh();
    });

    // Kill OpenOCD and return to extension view when the debug session stops
    context.subscriptions.push(
        vscode.debug.onDidTerminateDebugSession(() => {
            debugMgr.stopOpenOcd();
            vscode.commands.executeCommand('mcuBuildView.focus');
        })
    );
    // Refresh tree when toolchain status changes
    toolchainMgr.onDidChange(() => treeProvider.refresh(), null, context.subscriptions);
    // Poll CMSIS-DAP probe connection every 3 s, refresh tree on change
    debugMgr.startProbePolling(() => treeProvider.refresh());
    context.subscriptions.push({ dispose: () => debugMgr.stopProbePolling() });
    // Check toolchain status on activation
    toolchainMgr.checkAll();
    // Restore previously selected source folder, fall back to workspace root
    const savedSourceFolder =
        context.workspaceState.get<string>('mcuBuild.sourceFolder') ??
        config.getWorkspaceRoot();
    if (savedSourceFolder) {
        treeProvider.setSourceFolder(savedSourceFolder);
        buildMgr.cmakeSourceDir = treeProvider.cmakeSource ?? savedSourceFolder;
        treeProvider.setCmakeSource(treeProvider.cmakeSource ?? savedSourceFolder);
        flashPanel.sourceFolder = savedSourceFolder;
        debugMgr.sourceDir = savedSourceFolder;
        // Auto-detect config file from source folder
        const savedCandidates = fs.existsSync(savedSourceFolder)
            ? fs.readdirSync(savedSourceFolder).filter(f => f.endsWith('.config') || f === 'defconfig')
            : [];
        if (savedCandidates.length > 0 && !config.configFile) {
            config.configFile = path.join(savedSourceFolder, savedCandidates[0]);
        }
        treeProvider.refresh();
    }
    context.subscriptions.push(
        vscode.window.registerTreeDataProvider('mcuBuildView', treeProvider),
        vscode.window.registerTreeDataProvider('mcuSdkView', sdkTreeProvider),
        vscode.window.registerTreeDataProvider('mcuDocsView', docsTreeProvider)
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
        ['mcuBuild.clean',             async () => { await buildMgr.clean(); treeProvider.refresh(); }],
        ['mcuBuild.rebuild',           async () => {
            treeProvider.setCompiling(true);
            treeProvider.refresh();
            try {
                await vscode.window.withProgress(
                    { location: vscode.ProgressLocation.Notification, title: 'Compiling', cancellable: false },
                    (p) => buildMgr.rebuild((increment, message) => p.report({ increment, message }))
                );
            } finally {
                treeProvider.setCompiling(false);
                treeProvider.refresh();
            }
        }],
        ['mcuBuild.cancelBuild',       () => buildMgr.cancel()],
        ['mcuBuild.flash',             () => flashMgr.flash()],
        ['mcuBuild.openFlashPanel',    () => flashPanel.open()],
        ['mcuBuild.openSerialMonitor', () => serial.open()],
        ['mcuBuild.openFile',          (uri: unknown) => vscode.window.showTextDocument(uri as vscode.Uri)],
        ['mcuBuild.revealOutputFile',  (uri: unknown) => vscode.commands.executeCommand('revealFileInOS', uri as vscode.Uri)],
        ['mcuBuild.useAsFlashBin', (uri: unknown) => {
            flashPanel.setBinFile((uri as vscode.Uri).fsPath);
            flashPanel.open();
        }],
        ['mcuBuild.selectSourceFolder', async () => {
            const uris = await vscode.window.showOpenDialog({
                canSelectFiles: false,
                canSelectFolders: true,
                canSelectMany: false,
                openLabel: 'Select Source Folder',
                defaultUri: treeProvider.sourceFolder
                    ? vscode.Uri.file(treeProvider.sourceFolder)
                    : undefined,
            });
            if (uris?.[0]) {
                const folder = uris[0].fsPath;
                treeProvider.setSourceFolder(folder);
                buildMgr.cmakeSourceDir = treeProvider.cmakeSource ?? folder;
                treeProvider.setCmakeSource(treeProvider.cmakeSource ?? folder);
                flashPanel.sourceFolder = folder;
                debugMgr.sourceDir = folder;
                context.workspaceState.update('mcuBuild.sourceFolder', folder);

                // Auto-detect config file in the selected folder
                const candidates = fs.existsSync(folder)
                    ? fs.readdirSync(folder).filter(f => f.endsWith('.config') || f === 'defconfig')
                    : [];
                if (candidates.length > 0) {
                    config.configFile = path.join(folder, candidates[0]);
                }
                treeProvider.refresh();
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
                configPanel = ConfigPanel.open(context);
                configPanel.load(uris[0].fsPath);
            }
        }],
        ['mcuBuild.openConfigFile', () => {
            if (config.configFile) {
                configPanel = ConfigPanel.open(context);
                configPanel.load(config.configFile);
            } else {
                vscode.window.showWarningMessage('No config file selected. Please select a config file first.');
            }
        }],
        ['mcuBuild.selectChip', async () => {
            const chips = ['rf1301', 'rt581', 'rt582', 'rt583', 'rt584ha4', 'rt584h', 'rt584l'];
            const pick = await vscode.window.showQuickPick(
                chips.map(c => ({ label: c, description: c === config.chipName ? '(current)' : '' })),
                { placeHolder: 'Select chip name' }
            );
            if (!pick) { return; }
            const sourceDir = treeProvider.cmakeSource ?? config.getWorkspaceRoot();
            const cfgPath = path.join(sourceDir, `default-${pick.label}-evb.config`);
            if (fs.existsSync(cfgPath)) {
                config.chipName = pick.label;
                config.configFile = cfgPath;
                treeProvider.setChipName(pick.label);
                configPanel = ConfigPanel.open(context);
                configPanel.load(cfgPath);
            } else {
                vscode.window.showWarningMessage(`Config file not found: ${cfgPath}`);
            }
            treeProvider.refresh();
        }],
        ['mcuBuild.configSave', () => {
            const ok = configPanel?.save();
            if (ok) { vscode.window.showInformationMessage(`Saved ${configPanel?.fileName}`); }
            else    { vscode.window.showErrorMessage('Failed to save config file.'); }
        }],
        ['mcuBuild.configToggleBool', () => { /* handled in webview */ }],
        ['mcuBuild.configEditValue',  () => { /* handled in webview */ }],
        ['mcuBuild.clearConfigFile', () => { config.configFile = ''; }],
        // CMSIS-DAP Debug
        ['mcuBuild.startDebug',              () => debugMgr.startDebug()],
        ['mcuBuild.debug.selectElf',         async () => { await debugMgr.selectElf();       treeProvider.refresh(); }],
        ['mcuBuild.debug.selectInterface',   async () => { await debugMgr.selectInterface();  treeProvider.refresh(); }],
        ['mcuBuild.debug.selectTarget',      async () => { await debugMgr.selectTarget();     treeProvider.refresh(); }],
        ['mcuBuild.debug.selectOpenOcd',     async () => { await debugMgr.selectOpenOcd();    treeProvider.refresh(); }],
        ['mcuBuild.debug.selectGdb',         async () => {
            const val = await vscode.window.showInputBox({ prompt: 'GDB executable path', value: debugMgr.gdbPath });
            if (val !== undefined) { debugMgr.gdbPath = val; treeProvider.refresh(); }
        }],
        ['mcuBuild.debug.generateLaunch',    () => debugMgr.generateLaunchJson()],
        ['mcuBuild.debug.flashOpenOcd',      async () => {
            treeProvider.setFlashing(true);
            try {
                await vscode.window.withProgress(
                    { location: vscode.ProgressLocation.Notification, title: 'Downloading', cancellable: true },
                    async (p, token) => {
                        token.onCancellationRequested(() => debugMgr.cancelFlash());

                        let lastOverall = 0;
                        let sawErase = false;
                        p.report({ increment: 0, message: '0%' });

                        try {
                            await debugMgr.flashWithOpenOcd((phase, pct) => {
                                // Map erase → 0–50%, write → 50–100% (or 0–100% if no erase)
                                let overall: number;
                                let label: string;
                                if (phase === 'erase') {
                                    sawErase = true;
                                    overall = Math.round(pct / 2);
                                    label = `Erasing ${pct}%`;
                                } else {
                                    overall = sawErase ? 50 + Math.round(pct / 2) : pct;
                                    label = `Writing ${pct}%`;
                                }
                                if (overall > lastOverall) {
                                    p.report({ increment: overall - lastOverall, message: label });
                                    lastOverall = overall;
                                }
                            });
                        } catch (err: unknown) {
                            const msg = err instanceof Error ? err.message : String(err);
                            if (msg !== 'Cancelled') {
                                vscode.window.showErrorMessage(`Flash failed: ${msg}`);
                            }
                        }
                    }
                );
            } finally {
                treeProvider.setFlashing(false);
            }
        }],
        ['mcuBuild.installArmToolchain', () => toolchainMgr.installArmToolchain()],
        ['mcuBuild.installCmake',        () => toolchainMgr.installCmake()],
        ['mcuBuild.installNinja',        () => toolchainMgr.installNinja()],
        ['mcuBuild.removeArmToolchain',  () => toolchainMgr.removeArmToolchain()],
        ['mcuBuild.removeCmake',         () => toolchainMgr.removeCmake()],
        ['mcuBuild.removeNinja',         () => toolchainMgr.removeNinja()],
        ['mcuBuild.refreshToolchain',    () => toolchainMgr.checkAll()],
        // SDK Manager
        ['mcuBuild.sdk.fetchTags',     () => sdkMgr.fetchTags()],
        ['mcuBuild.sdk.install',       async (tag: unknown) => { await sdkMgr.installSdk(tag as string); }],
        ['mcuBuild.sdk.remove',        async (item: unknown) => {
            const tag = item instanceof SdkTreeItem ? item.sdkTag : undefined;
            if (tag) { await sdkMgr.removeSdk(tag); }
        }],
        ['mcuBuild.sdk.setInstallPath', async () => {
            const uris = await vscode.window.showOpenDialog({
                canSelectFiles: false,
                canSelectFolders: true,
                canSelectMany: false,
                openLabel: 'Select SDK Install Path',
                defaultUri: vscode.Uri.file(sdkMgr.installPath),
            });
            if (uris?.[0]) { sdkMgr.setInstallPath(uris[0].fsPath); }
        }],
        ['mcuBuild.sdk.openFolder',    (folderPath: unknown) => {
            vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(folderPath as string));
        }],
        ['mcuBuild.sdk.openAsWorkspace', (folderPath: unknown) => {
            vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(folderPath as string));
        }],
        ['mcuBuild.openSettings',            () => settingsPanel.open()],
        ['mcuBuild.openDocs', () => {
            vscode.commands.executeCommand('mcuDocsView.focus');
        }],
        ['mcuBuild.openDocsAt', async (uri: unknown, line: unknown) => {
            const doc = await vscode.workspace.openTextDocument(uri as vscode.Uri);
            await vscode.window.showTextDocument(doc, {
                preview: true,
                selection: new vscode.Range(line as number, 0, line as number, 0),
            });
            vscode.commands.executeCommand('markdown.showPreview', uri as vscode.Uri);
        }],
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
