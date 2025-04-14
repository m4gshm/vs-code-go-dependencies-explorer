import path, { join } from 'path';
import {
    EventEmitter, Event, FileChangeEvent, FileSystemProvider,
    FileType, FileSystem, Uri, FilePermission, FileSystemError,
    Disposable
} from 'vscode';
import { GoPackageDirectoriesProvider } from './goPackageDirectoriesProvider';

export const SCHEME = 'go-dep-file';
export const ROOT_STD_LIB = 'StdLib';
export const ROOT_EXT_PACK = 'ExtPack';
export const ROOT_EXT_PACK_REPLACED = 'ExtPackReplaced';

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

export function newFsUriConverter(stdLibDir: string, extPackagesDir: string, goPackDirProvider: GoPackageDirectoriesProvider): FsUriConverter {
    return new FsUriConverter(stdLibDir, extPackagesDir, goPackDirProvider);
}

export class FsUriConverter {
    private readonly roots: {
        code: string,
        codePath: string,
        pathPrefix: string
    }[];

    private extPackagesReplacedDirs: string[];

    private toFsPath(code: string): string {
        return Uri.file(code).fsPath;
    }

    constructor(stdLibDir: string, extPackagesDir: string, goPackDirProvider: GoPackageDirectoriesProvider) {
        this.roots = [
            { code: ROOT_STD_LIB, codePath: this.toFsPath(ROOT_STD_LIB), pathPrefix: stdLibDir },
            { code: ROOT_EXT_PACK, codePath: this.toFsPath(ROOT_EXT_PACK), pathPrefix: extPackagesDir },
            { code: ROOT_EXT_PACK_REPLACED, codePath: this.toFsPath(ROOT_EXT_PACK_REPLACED), pathPrefix: "" },
        ];
        this.extPackagesReplacedDirs = [];

        goPackDirProvider.onRequestPackages(e => {
            const replacedPrefixes = new Set(e.rootReplaced?.subdirs.map(subDir => {
                return subDir.path;
            }));

            this.extPackagesReplacedDirs = Array.from(replacedPrefixes);
            //log
        });
    }

    toFsUri(uri: Uri) {
        if (uri.scheme === SCHEME) {
            const fsPath = uri.fsPath;
            if (this.foundReplaced(fsPath)) {
                return Uri.file(fsPath);
            }
            const found = this.roots.find(r => {
                const root = this.getFirstNotEmptyPathPart(fsPath);
                return root === r.code;
            });
            if (found) {
                const suffix = found.codePath.length > 0 ? fsPath.substring(found.codePath.length, fsPath.length) : fsPath;
                const path = found.pathPrefix ? join(found.pathPrefix, suffix) : suffix;
                return Uri.file(path);
            }
        }
        return undefined;
    }

    private foundReplaced(fsPath: string) {
        return this.extPackagesReplacedDirs.find(dir => {
            return fsPath.startsWith(dir);
        });
    }

    toDepUri(uri: Uri) {
        if (uri.scheme === 'file') {
            const fsPath = uri.fsPath;
            if (this.foundReplaced(fsPath)) {
                return Uri.file(fsPath);
            }
            const found = this.roots.map(root => {
                const pathPrefix = root.pathPrefix;
                if (pathPrefix) {
                    const matched = fsPath.startsWith(pathPrefix);
                    if (matched) {
                        return root; //{ code: root.code, codePath: root.codePath, pathPrefix: pathPrefix };
                    }
                }
                return undefined;
            }).find(pair => pair !== undefined);
            if (found) {
                const path = fsPath.substring(found.pathPrefix.length, fsPath.length);
                const fullPath = found.codePath.length > 0 ? join(found.codePath, path) : path;
                return Uri.file(fullPath);
            }
        }
        return undefined;
    }

    private getFirstNotEmptyPathPart(fsPath: string) {
        const p = fsPath.startsWith(path.sep) ? fsPath.substring(1) : fsPath;
        const delimInd = p.indexOf(path.sep);
        const part = delimInd > -1 ? p.substring(0, delimInd) : p;
        return part;
    }
}
