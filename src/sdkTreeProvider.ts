import * as vscode from 'vscode';
import { SdkManager } from './sdkManager';

export class SdkTreeItem extends vscode.TreeItem {
    /** Tag name for SDK items */
    sdkTag?: string;

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

export class SdkTreeProvider implements vscode.TreeDataProvider<SdkTreeItem> {
    private readonly _onDidChangeTreeData = new vscode.EventEmitter<SdkTreeItem | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    constructor(private readonly sdk: SdkManager) {
        sdk.onDidChange(() => this._onDidChangeTreeData.fire(undefined));
    }

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: SdkTreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: SdkTreeItem): SdkTreeItem[] {
        if (!element) {
            return this.getRootItems();
        }

        const label = typeof element.label === 'string' ? element.label : '';
        switch (label) {
            case 'Available Versions':
                return this.getAvailableItems();
            default:
                return [];
        }
    }

    private getRootItems(): SdkTreeItem[] {
        const fetching = this.sdk.status === 'fetching';
        const availableItem = new SdkTreeItem(
            'Available Versions',
            vscode.TreeItemCollapsibleState.Expanded,
            undefined,
            fetching ? 'sync~spin' : 'versions',
            fetching ? 'Fetching...' : (this.sdk.tags.length > 0 ? `${this.sdk.tags.length} tags` : ''),
            'sdkAvailable'
        );

        return [availableItem];
    }

    private getAvailableItems(): SdkTreeItem[] {
        const fetching = this.sdk.status === 'fetching';
        const installing = this.sdk.status === 'installing';

        // Refresh button
        const refreshItem = new SdkTreeItem(
            fetching ? 'Fetching...' : 'Fetch / Refresh',
            vscode.TreeItemCollapsibleState.None,
            fetching ? undefined : 'mcuBuild.sdk.fetchTags',
            fetching ? 'sync~spin' : 'sync',
            undefined,
            'sdkFetchTags'
        );

        if (this.sdk.tags.length === 0) {
            return [refreshItem];
        }

        const tagItems = this.sdk.tags.map(tag => {
            const installed = this.sdk.installedSdks.some(s => s.tag === tag);
            let icon: string;
            let description: string;
            let commandId: string | undefined;
            let contextValue: string;

            if (installed) {
                icon = 'pass';
                description = 'installed';
                commandId = undefined;
                contextValue = 'sdkTagInstalled';
            } else if (installing) {
                icon = 'sync~spin';
                description = '';
                commandId = undefined;
                contextValue = 'sdkTag';
            } else {
                icon = 'cloud-download';
                description = '';
                commandId = 'mcuBuild.sdk.install';
                contextValue = 'sdkTag';
            }

            const item = new SdkTreeItem(
                tag,
                vscode.TreeItemCollapsibleState.None,
                commandId,
                icon,
                description,
                contextValue,
                commandId ? [tag] : undefined
            );
            item.sdkTag = tag;
            return item;
        });

        return [refreshItem, ...tagItems];
    }
}
