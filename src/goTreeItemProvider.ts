import { TreeItem, TreeItemCollapsibleState, Uri } from "vscode";
import { Directory, flat } from "./directory";
import { GoPackageProvider } from "./goPackageProvider";
import { join } from 'path';
import { ROOT_STD_LIB, SCHEME } from "./goDependenciesFsCommon";

export class GoTreeItemProvider {
    private _stdLibRootDir!: GoDirItem;
    private _stdLibDirs: Map<string, GoDirItem> = new Map();
    private _modulesRootDir!: GoDirItem;
    private _modulesDirs: Map<string, GoDirItem> = new Map();
    private _replacedRootDir!: GoDirItem | undefined;
    private _replacedDirs: Map<string, GoDirItem> = new Map();

    static async new(packageProvider: GoPackageProvider) {
        const p = new GoTreeItemProvider(packageProvider);
        await p.refresh();
        return p;
    }

    private constructor(private readonly packageProvider: GoPackageProvider) { }

    get rootDirs(): GoDirItem[] {
        return [this._stdLibRootDir, this._modulesRootDir, this._replacedRootDir].filter(d => d !== undefined);
    }

    findDir(path: string) {
        return this._stdLibDirs.get(path) || this._modulesDirs.get(path) || this._replacedDirs.get(path);
    }

    async refresh() {
        const convertToGoDirs = (flatDirs: Map<string, Directory>) => new Map(Array.from(flatDirs.entries())
            .map(([fullPath, dir]) => [fullPath, newGoDirItem(dir)]));

        const [std, modules] = await this.packageProvider.getPackages();

        this._stdLibRootDir = newGoDirItem(std.root, ROOT_STD_LIB);
        this._stdLibDirs = convertToGoDirs(flat([std.root]));

        this._modulesRootDir = newGoDirItem(modules.root);
        this._modulesDirs = convertToGoDirs(flat([modules.root]));

        const rootReplaced = modules.rootReplaced;
        this._replacedRootDir = rootReplaced ? newGoDirItem(rootReplaced) : undefined;
        const flatReplaced = rootReplaced ? flat([rootReplaced]) : new Map<string, Directory>();
        this._replacedDirs = convertToGoDirs(flatReplaced);
    }
}

export class GoDirItem extends TreeItem {
    constructor(
        public readonly dir: Directory,
        label: string | undefined = undefined,
        public children: TreeItem[] | undefined = undefined
    ) {
        super(label || dir.name, TreeItemCollapsibleState.Collapsed);
        this.id = dir.path;
        this.collapsibleState = TreeItemCollapsibleState.Collapsed;
        this.tooltip = dir.name;
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

export function newGoDirItem(dir: Directory, label: string | undefined = undefined) {
    return new GoDirItem(dir, label);
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