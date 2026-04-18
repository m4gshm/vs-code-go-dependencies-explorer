import { TreeItem, TreeItemCollapsibleState, Uri } from "vscode";
import { Directory } from "./directory";
import { GoPackageDirectoriesProvider } from "./goPackageDirectoriesProvider";
import { join } from 'path';
import { SCHEME } from "./goDependenciesFsCommon";

export class GoDirectoriesProvider {
    private _stdLibRootDir!: GoDirItem;
    private _stdLibDirs: Map<string, GoDirItem> = new Map();
    private _modulesRootDir!: GoDirItem;
    private _modulesDirs: Map<string, GoDirItem> = new Map();
    private _replacedRootDir!: GoDirItem | undefined;
    private _replacedDirs: Map<string, GoDirItem> = new Map();

    constructor(private readonly goPackDirProvider: GoPackageDirectoriesProvider) { }

    get rootDirs(): GoDirItem[] {
        return [this._stdLibRootDir, this._modulesRootDir, this._replacedRootDir].filter(d => d !== undefined);
    }

    findDir(path: string) {
        return this._stdLibDirs.get(path) || this._modulesDirs.get(path) || this._replacedDirs.get(path);
    }

    async refresh() {
        const convertToGoDirs = (flatDirs: Map<string, Directory>) => new Map(Array.from(flatDirs.entries())
            .map(([fullPath, dir]) => [fullPath, newGoDirItem(dir)]));

        const [std, modules] = await this.goPackDirProvider.getGoPackages();

        this._stdLibRootDir = newGoDirItem(std.root);
        this._stdLibDirs = convertToGoDirs(std.flatDirs);

        this._modulesRootDir = newGoDirItem(modules.root);
        this._modulesDirs = convertToGoDirs(modules.flatDirs);

        this._replacedRootDir = modules.rootReplaced ? newGoDirItem(modules.rootReplaced) : undefined;
        this._replacedDirs = convertToGoDirs(modules.flatReplaced);
    }
}

export class GoDirItem extends TreeItem {
    constructor(
        public readonly dir: Directory,
        public children: TreeItem[] | undefined = undefined
    ) {
        super(dir.label, TreeItemCollapsibleState.Collapsed);
        this.id = dir.path;
        this.collapsibleState = TreeItemCollapsibleState.Collapsed;
        this.tooltip = dir.label;
    }
}

export class FileItem extends TreeItem {
    constructor(
        public readonly fileName: string,
        public readonly filePath: string,
    ) {
        super(fileName);
        const fillFilePath = join(filePath, fileName);
        this.id = fillFilePath;
        this.resourceUri = dependencyUri(fillFilePath);
        this.tooltip = fileName;
    }
}

export function newGoDirItem(dir: Directory) {
    return new GoDirItem(dir);
}

export function dependencyUri(path: string) {
    function replaceUriScheme(newScheme: string, uri: Uri) {
        if (newScheme && uri.scheme !== newScheme) {
            return Uri.from({
                scheme: newScheme,
                authority: uri.authority,
                path: uri.path,
                query: uri.query,
                fragment: uri.fragment,
            });
        }
        return uri;
    }
    return replaceUriScheme(SCHEME, Uri.file(path));
}