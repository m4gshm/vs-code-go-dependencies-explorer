import path, { join } from 'path';
import {
    EventEmitter, Event, FileChangeEvent, FileSystemProvider,
    FileType, FileSystem, Uri, FilePermission, FileSystemError,
    Disposable,
} from 'vscode';
import { GoPackageProvider } from './goPackageProvider';
import { ROOT_MODULES, ROOT_MODULES_REPLACED, ROOT_STD_LIB, SCHEME } from './goDependenciesFsCommon';

export class GoDependenciesFileSystemProvider implements FileSystemProvider {
    private _emitter = new EventEmitter<FileChangeEvent[]>();
    readonly onDidChangeFile: Event<FileChangeEvent[]> = this._emitter.event;

    constructor(
        private readonly fs: FileSystem,
        private readonly toFsConv: (uri: Uri) => Uri | undefined,
    ) { }

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

export function newFsUriConverter(packageProvider: GoPackageProvider): FsUriConverter {
    return new FsUriConverter(packageProvider);
}

function toFsPath(code: string): string {
    return Uri.file(code).fsPath;
}

export class FsUriConverter {
    private modulesReplacedDirs: string[];
    private roots: Roots[];

    constructor(private readonly packageProvider: GoPackageProvider) {
        this.modulesReplacedDirs = [];
        const { stdLibPath, modulePath } = this.packageProvider.getPackagePaths();

        this.roots = [
            { code: ROOT_STD_LIB, codePath: toFsPath(ROOT_STD_LIB), pathPrefix: stdLibPath },
            { code: ROOT_MODULES, codePath: toFsPath(ROOT_MODULES), pathPrefix: modulePath },
            { code: ROOT_MODULES_REPLACED, codePath: toFsPath(ROOT_MODULES_REPLACED), pathPrefix: "" },
        ];

        packageProvider.onRequestPackages(dirs => {
            const [stdLibDirs, modulePath] = dirs;

            // this.roots = [
            //     { code: ROOT_STD_LIB, codePath: toFsPath(ROOT_STD_LIB), pathPrefix: stdLibDirs.root.path },
            //     { code: ROOT_MODULES, codePath: toFsPath(ROOT_MODULES), pathPrefix: modulePath.root.path },
            //     { code: ROOT_MODULES_REPLACED, codePath: toFsPath(ROOT_MODULES_REPLACED), pathPrefix: "" },
            // ];

            //update replaced modules;
            const rootReplaced = modulePath.rootReplaced;
            const replacedPrefixes = new Set(rootReplaced?.subdirs.map(subDir => subDir.path));

            const extPackagesReplacedDirs = Array.from(replacedPrefixes);
            const rootPath = rootReplaced?.path;
            if (rootPath) {
                extPackagesReplacedDirs.push(rootPath);
            }
            this.modulesReplacedDirs = extPackagesReplacedDirs;
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
                        return root;
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

    private foundReplaced(fsPath: string) {
        return this.modulesReplacedDirs.find(dir => {
            return fsPath.startsWith(dir);
        });
    }

    private getFirstNotEmptyPathPart(fsPath: string) {
        const p = fsPath.startsWith(path.sep) ? fsPath.substring(1) : fsPath;
        const delimInd = p.indexOf(path.sep);
        const part = delimInd > -1 ? p.substring(0, delimInd) : p;
        return part;
    }
}

interface Roots {
    code: string, codePath: string, pathPrefix: string;
}