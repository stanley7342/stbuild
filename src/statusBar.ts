import * as vscode from 'vscode';
import { BuildStatus } from './buildManager';
import { ConfigManager } from './configManager';

export class StatusBarManager implements vscode.Disposable {
    private readonly buildItem: vscode.StatusBarItem;
    private readonly buildTypeItem: vscode.StatusBarItem;
    private readonly flashItem: vscode.StatusBarItem;
    private readonly serialItem: vscode.StatusBarItem;

    constructor(private readonly config: ConfigManager) {
        this.buildItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        this.buildItem.command = 'mcuBuild.build';
        this.setBuildStatus('idle');
        this.buildItem.show();

        this.buildTypeItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
        this.buildTypeItem.command = 'mcuBuild.selectBuildType';
        this.refreshBuildType();
        this.buildTypeItem.show();

        this.flashItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 98);
        this.flashItem.command = 'mcuBuild.flash';
        this.flashItem.text = '$(zap) Flash';
        this.flashItem.tooltip = 'Flash firmware (mcuBuild.flash)';
        this.flashItem.show();

        this.serialItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 97);
        this.serialItem.command = 'mcuBuild.openSerialMonitor';
        this.serialItem.text = '$(terminal) Serial';
        this.serialItem.tooltip = 'Open Serial Monitor';
        this.serialItem.show();
    }

    setBuildStatus(status: BuildStatus): void {
        const errorBg = new vscode.ThemeColor('statusBarItem.errorBackground');
        switch (status) {
            case 'idle':
                this.buildItem.text = '$(play) Build';
                this.buildItem.tooltip = 'Build project [F7]';
                this.buildItem.backgroundColor = undefined;
                break;
            case 'configuring':
                this.buildItem.text = '$(loading~spin) Configuring…';
                this.buildItem.tooltip = 'Running CMake configure…';
                this.buildItem.backgroundColor = undefined;
                break;
            case 'building':
                this.buildItem.text = '$(loading~spin) Building…';
                this.buildItem.tooltip = 'Building… (click to cancel)';
                this.buildItem.command = 'mcuBuild.cancelBuild';
                this.buildItem.backgroundColor = undefined;
                break;
            case 'success':
                this.buildItem.text = '$(check) Build OK';
                this.buildItem.tooltip = 'Build successful. Click to rebuild [F7]';
                this.buildItem.command = 'mcuBuild.build';
                this.buildItem.backgroundColor = undefined;
                break;
            case 'failed':
                this.buildItem.text = '$(error) Build Failed';
                this.buildItem.tooltip = 'Build failed. Click to retry [F7]';
                this.buildItem.command = 'mcuBuild.build';
                this.buildItem.backgroundColor = errorBg;
                break;
        }
    }

    refreshBuildType(): void {
        this.buildTypeItem.text = `$(symbol-enum) ${this.config.buildType}`;
        this.buildTypeItem.tooltip = `Build type: ${this.config.buildType} (click to change)`;
    }

    dispose(): void {
        this.buildItem.dispose();
        this.buildTypeItem.dispose();
        this.flashItem.dispose();
        this.serialItem.dispose();
    }
}
