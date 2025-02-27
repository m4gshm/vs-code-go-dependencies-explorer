import { join } from 'path';
import {
    EventEmitter, Event, FileChangeEvent, FileSystemProvider,
    FileType, FileSystem, Uri, FilePermission, FileSystemError,
    Disposable
} from 'vscode';
import wu from 'wu';

export const SCHEME = 'go-dep-file';
export const ROOT_STD_LIB = 'StdLib';
export const ROOT_EXT_PACK = 'ExtPack';

export interface RootDir {
    code: string,
    prefixPath: string
}

export class GoDepFileSystemProvider implements FileSystemProvider {

    private _emitter = new EventEmitter<FileChangeEvent[]>();
    readonly onDidChangeFile: Event<FileChangeEvent[]> = this._emitter.event;

    constructor(
        private readonly fs: FileSystem,
        private readonly toFsConv: (uri: Uri) => Uri | undefined,
    ) {
    }

    async stat(uri: Uri) {
        const fsUri = this.toFsConv(uri);
        return await this.fs.stat(fsUri || uri).then(stat => ({
            type: stat.type,
            ctime: stat.ctime,
            mtime: stat.mtime,
            size: stat.size,
            permissions: FilePermission.Readonly,
        }));
    }

    async readDirectory(uri: Uri): Promise<[string, FileType][]> {
        return await this.fs.readDirectory(this.toFsConv(uri) || uri);
    }

    async readFile(uri: Uri): Promise<Uint8Array<ArrayBufferLike>> {
        return await this.fs.readFile(this.toFsConv(uri) || uri);
    }

    writeFile(uri: Uri, content: Uint8Array, options: { create: boolean, overwrite: boolean }): void {
        throw FileSystemError.NoPermissions(uri);
    }

    rename(oldUri: Uri, newUri: Uri, options: { overwrite: boolean }): void {
        throw FileSystemError.NoPermissions(oldUri);
    }

    delete(uri: Uri): void {
        throw FileSystemError.NoPermissions(uri);
    }

    createDirectory(uri: Uri): void {
        throw FileSystemError.NoPermissions(uri);
    }

    copy(uri: Uri): void {
        throw FileSystemError.NoPermissions(uri);
    }

    watch(_resource: Uri): Disposable {
        // ignore, fires for all changes...
        return new Disposable(() => { });
    }
}

export function newFsUriConverter(stdLibDir: string, extPackagesDir: string): FsUriConverter {
    const strRoot: RootDir = { code: ROOT_STD_LIB, prefixPath: stdLibDir };
    const extPackRoot: RootDir = { code: ROOT_EXT_PACK, prefixPath: extPackagesDir };
    const roots = [strRoot, extPackRoot];
    const rootMap = new Map(roots.map(r => {
        const u = Uri.file(r.code);
        return [u.fsPath, r.prefixPath];
    }));
    return {
        toFsUri: (uri: Uri) => {
            if (uri.scheme === SCHEME) {
                const found: [string, string] | undefined = wu(rootMap.entries()).find(([code, _]) => {
                    return uri.fsPath.startsWith(code);
                });
                if (found) {
                    const [code, prefix] = found;
                    const suffix = uri.fsPath.substring(code.length, uri.fsPath.length);
                    const path = join(prefix, suffix);
                    const r = Uri.file(path);
                    return r;
                }
            }
            return undefined;
        },
        toDepUri: (uri: Uri) => {
            if (uri.scheme === 'file') {
                const found: [string, string] | undefined = wu(rootMap.entries()).find(([code, prefix]) => {
                    return uri.fsPath.startsWith(prefix);
                });
                if (found) {
                    const [code, prefix] = found;
                    const suffix = uri.fsPath.substring(prefix.length, uri.fsPath.length);
                    const path = join(code, suffix);
                    const r = Uri.file(path);
                    return r;
                }
            }
            return undefined;
        },
    };
}

export interface FsUriConverter {
    readonly toFsUri: (uri: Uri) => Uri | undefined;
    readonly toDepUri: (uri: Uri) => Uri | undefined;
}
