import { Event, Uri } from 'vscode';

export interface GitExtension {
    getAPI(version: 1): GitAPI;
}

export interface GitAPI {
    readonly onDidOpenRepository: Event<Repository>;
}

export interface Repository {
    readonly rootUri: Uri;
}
