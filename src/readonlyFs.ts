import vscode from 'vscode';

export const SCHEME = 'go-dep-file-ro';

export class ReadonlyFileSystemProvider implements vscode.FileSystemProvider {
    constructor(
        private readonly fs: vscode.FileSystem,
    ) {
    }

    async stat(uri: vscode.Uri) {
        return await this.fs.stat(uri).then(stat => ({
            type: stat.type,
            ctime: stat.ctime,
            mtime: stat.mtime,
            size: stat.size,
            permissions: vscode.FilePermission.Readonly,
        }));
    }

    async readDirectory(uri: vscode.Uri) {
        return await this.fs.readDirectory(uri);
    }

    async readFile(uri: vscode.Uri) {
        return await this.fs.readFile(uri);
    }

    writeFile(uri: vscode.Uri, content: Uint8Array, options: { create: boolean, overwrite: boolean }): void {
        throw vscode.FileSystemError.NoPermissions(uri);
    }

    rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: { overwrite: boolean }): void {
        throw vscode.FileSystemError.NoPermissions(oldUri);
    }

    delete(uri: vscode.Uri): void {
        throw vscode.FileSystemError.NoPermissions(uri);
    }

    createDirectory(uri: vscode.Uri): void {
        throw vscode.FileSystemError.NoPermissions(uri);
    }

    private _emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();

    readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> = this._emitter.event;

    watch(_resource: vscode.Uri): vscode.Disposable {
        // ignore, fires for all changes...
        return new vscode.Disposable(() => { });
    }
}