import vscode from 'vscode';
import * as fs from 'fs';
import { Directory } from './dir';
import { sep, parse } from 'path';

export class GoDependenciesFS implements vscode.FileSystemProvider {

    private readonly dirs: Directory[];
    private readonly flatDirs: Map<string, Directory>;
    private readonly listFiles: (path: string) => fs.Dirent[];

    constructor(dirs: Directory[], listFiles: (path: string) => fs.Dirent[]) {
        this.dirs = dirs;
        let flat = new Map((dirs.flatMap(d => [...d.flatDirs().entries()])));
        this.flatDirs = flat;
        this.listFiles = listFiles;
    }

    stat(uri: vscode.Uri): vscode.FileStat {
        let dir = this.flatDirs.get(uri.path);
        if (dir) {
            return {
                type: vscode.FileType.Directory,
                ctime: 0,
                mtime: 0,
                size: 0,
            };
        } else {
            let path = parse(uri.path);
            dir = this.flatDirs.get(path.dir);
            if (dir?.path) {
                let files = new Set(this.listFiles(dir.path).map(f => f.name));
                if (files.has(path.name + path.ext)) {
                    let stat = fs.statSync(uri.path);
                    return {
                        type: stat.isSymbolicLink() ? vscode.FileType.SymbolicLink
                            : stat.isDirectory() ? vscode.FileType.Directory : vscode.FileType.File,
                        ctime: stat.ctimeMs,
                        mtime: stat.mtimeMs,
                        size: stat.size,
                    };
                }

            }
        }
        throw vscode.FileSystemError.FileNotFound(uri);
    }

    readDirectory(uri: vscode.Uri): [string, vscode.FileType][] {
        let dir = this.flatDirs.get(uri.path);
        let subdirs: [string, vscode.FileType][] = dir ? dir.subdirs.map(subdir => {
            return [subdir.name, vscode.FileType.Directory];
        }) : [];

        let path = dir?.path;
        if (path) {
            return subdirs.concat(this.listFiles(path).map(file => [file.name, vscode.FileType.File]));
        } else {
            return subdirs;
        }
    }

    readFile(uri: vscode.Uri): Uint8Array {
        return fs.readFileSync(uri.path);
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


export class File implements vscode.FileStat {

    type: vscode.FileType;
    ctime: number;
    mtime: number;
    size: number;

    name: string;
    data?: Uint8Array;

    constructor(name: string) {
        this.type = vscode.FileType.File;
        this.ctime = Date.now();
        this.mtime = Date.now();
        this.size = 0;
        this.name = name;
    }
}

export class Dir implements vscode.FileStat {
    readonly type: vscode.FileType;
    readonly ctime: number;
    readonly mtime: number;
    readonly size: number;

    readonly name: string;

    constructor(name: string) {
        this.type = vscode.FileType.Directory;
        this.ctime = Date.now();
        this.mtime = Date.now();
        this.size = 0;
        this.name = name;
    }
}

export type Entry = File | Directory;


