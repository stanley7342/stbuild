import * as vscode from 'vscode';

export type BuildType = 'Debug' | 'Release' | 'RelWithDebInfo' | 'MinSizeRel';
export type FlashTool = 'openocd' | 'esptool' | 'custom';

export class ConfigManager {
    private get cfg() {
        return vscode.workspace.getConfiguration('mcuBuild');
    }

    getWorkspaceRoot(): string {
        return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
    }

    get buildDirectory(): string {
        const raw = this.cfg.get<string>('cmake.buildDirectory', '${workspaceFolder}/build');
        return raw.replace('${workspaceFolder}', this.getWorkspaceRoot());
    }

    get buildType(): BuildType {
        return this.cfg.get<BuildType>('cmake.buildType', 'Debug');
    }

    set buildType(value: BuildType) {
        this.cfg.update('cmake.buildType', value, vscode.ConfigurationTarget.Workspace);
    }

    get cmakePath(): string {
        return this.cfg.get<string>('cmake.cmakePath', 'cmake');
    }

    set cmakePath(value: string) {
        this.cfg.update('cmake.cmakePath', value, vscode.ConfigurationTarget.Workspace);
    }

    get ninjaPath(): string {
        return this.cfg.get<string>('cmake.ninjaPath', 'ninja');
    }

    set ninjaPath(value: string) {
        this.cfg.update('cmake.ninjaPath', value, vscode.ConfigurationTarget.Workspace);
    }

    get toolchainFile(): string {
        return this.cfg.get<string>('cmake.toolchainFile', '');
    }

    get configFile(): string {
        return this.cfg.get<string>('cmake.configFile', '');
    }

    set configFile(value: string) {
        this.cfg.update('cmake.configFile', value, vscode.ConfigurationTarget.Workspace);
    }

    get chipName(): string {
        return this.cfg.get<string>('cmake.chipName', '');
    }

    set chipName(value: string) {
        this.cfg.update('cmake.chipName', value, vscode.ConfigurationTarget.Workspace);
    }

    get generator(): string {
        return this.cfg.get<string>('cmake.generator', '');
    }

    get configureArgs(): string[] {
        return this.cfg.get<string[]>('cmake.configureArgs', []);
    }

    get buildArgs(): string[] {
        return this.cfg.get<string[]>('cmake.buildArgs', []);
    }

    get flashTool(): FlashTool {
        return this.cfg.get<FlashTool>('flash.tool', 'openocd');
    }

    get openocdPath(): string {
        return this.cfg.get<string>('flash.openocdPath', 'openocd');
    }

    get openocdInterface(): string {
        return this.cfg.get<string>('flash.openocdInterface', 'interface/stlink.cfg');
    }

    get openocdTarget(): string {
        return this.cfg.get<string>('flash.openocdTarget', 'target/stm32f4x.cfg');
    }

    get binaryPath(): string {
        return this.cfg.get<string>('flash.binaryPath', '');
    }

    set binaryPath(value: string) {
        this.cfg.update('flash.binaryPath', value, vscode.ConfigurationTarget.Workspace);
    }

    get customFlashCommand(): string {
        return this.cfg.get<string>('flash.customCommand', '');
    }

    get serialPort(): string {
        return this.cfg.get<string>('serial.port', '');
    }

    set serialPort(value: string) {
        this.cfg.update('serial.port', value, vscode.ConfigurationTarget.Workspace);
    }

    get serialBaudRate(): number {
        return this.cfg.get<number>('serial.baudRate', 115200);
    }
}
