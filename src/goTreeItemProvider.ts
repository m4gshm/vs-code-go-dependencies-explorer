import { TreeItem, TreeItemCollapsibleState, Uri } from "vscode";
import { PathElement, flat } from "./pathTree";
import { GoPackageProvider } from "./goPackageProvider";
import { join } from 'path';

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
        const convertToGoDirs = (flatDirs: Map<string, PathElement>) => new Map(Array.from(flatDirs.entries())
            .map(([fullPath, dir]) => [fullPath, newGoDirItem(dir)]));

        const [std, modules] = await this.packageProvider.getPackages();

        this._stdLibRootDir = newGoDirItem(std.root, 'Standard library');
        this._stdLibDirs = convertToGoDirs(flat([std.root]));

        const root = modules.root;
        if (root) {
            this._modulesRootDir = newGoDirItem(root, 'External packages');
            this._modulesDirs = convertToGoDirs(flat([root]));
        }

        const rootReplaced = modules.rootReplaced;
        this._replacedRootDir = rootReplaced ? newGoDirItem(rootReplaced) : undefined;
        const flatReplaced = rootReplaced ? flat([rootReplaced]) : new Map<string, PathElement>();
        this._replacedDirs = convertToGoDirs(flatReplaced);
    }
}

export class GoDirItem extends TreeItem {
    constructor(
        public readonly dir: PathElement,
        label: string | undefined = undefined,
        public children: TreeItem[] | undefined = undefined
    ) {
        super(label || dir.name, TreeItemCollapsibleState.Collapsed);
        this.id = dir.path;
        this.collapsibleState = TreeItemCollapsibleState.Collapsed;
        this.tooltip = dir.name;
        this.contextValue = 'goDir';
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
        //just file to render mime icon but prevent file name colorizing by Git extension 
        this.resourceUri = Uri.file(fileName);
        this.tooltip = fileName;
        this.contextValue = 'goFile';
    }
}

export function newGoDirItem(dir: PathElement, label: string | undefined = undefined) {
    return new GoDirItem(dir, label);
}
